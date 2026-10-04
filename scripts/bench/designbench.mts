/**
 * The architect's designs, measured (phase D, D.1): the real prompt (designSystem with Minecraft's block list and
 * the survival note from designs.ts, a brief like the mayor's, the site lines as siteRoom writes them) N times per model
 * and case, each design checked as the brain checks it (validateDesign with the block list and states, then in survival:
 * obtainable and easy materials, no workstations, the cost budget) with one retry, and described: footprint, layers,
 * roof shape read from the layers, materials, blocks, gather units (Materials.plan: logs, cobblestone, sand... summed)
 * and seconds. OLD=1 uses the prompt and checks of before D.1 (the sandbox's prompt, the 9x9 cap) for comparison.
 * Usage: node_modules/.bin/tsx scripts/bench/designbench.mts [model ...]   (default ollama gpt-oss:120b-cloud)
 * Env: N (samples per case, default 10), CASES (comma list of case names), OLLAMA_URL, PEEK=1 (print every design),
 * OUT (a JSON file for every design, to compare runs). Since D.2 the architect also has submit_style (the building
 * generator, as design() offers it); STYLES=0 offers submit_design alone (the D.1 setup, with the style note still in
 * the prompt: for the D.1 prompt itself, bench the old code from git archive).
 */
import fs from 'node:fs';
import minecraftData from 'minecraft-data';
import { DESIGN_SURVIVAL, DESIGN_SYSTEM, DESIGN_TOOL, HOUSE_UNITS, LANDMARK_UNITS, MAX_SMELTS, designSystem, isLandmark, validateDesign } from '../../server/src/designs';
import { layoutBuildings, type Design } from '../../server/src/village';
import { STYLE_TOOL, fitSmelts, generateDesign, normalizeStyle, type BuildingStyle } from '../../server/src/buildingGen';
import { smallerStyle } from '../../server/src/tieredBrain';
import { Materials, designBill, designBlockList, hardToGather } from '../../server/src/mineflayer/mcMaterials';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const N = Number(process.env.N ?? 10);
const OLD = !!process.env.OLD;
// The 9x9 cap before D.1 (tieredBrain.ts SURVIVAL_MAX)
const SURVIVAL_MAX = 9;
const reg = minecraftData('26.1');
const materials = new Materials(reg);
// mcWorld.ts isPlaceable: states must be the block's own
const isPlaceable = (block: string) => {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(block.trim());
  if (!m) return false;
  const b = reg.blocksByName[m[1]];
  if (!b || !reg.itemsByName[m[1]]) return false;
  if (m[2] === undefined) return true;
  const states = (b.states ?? []) as Array<{ name: string; type: string; values?: string[] }>;
  return m[2].split(',').every((p) => {
    const [k, v] = p.split('=').map((t) => t.trim());
    const st = states.find((x) => x.name === k);
    if (!st || v === undefined) return false;
    return st.type === 'enum' ? !!st.values?.includes(v) : st.type === 'bool' ? v === 'true' || v === 'false' : /^\d+$/.test(v);
  });
};
/** What a design costs as mcWorld.materialTasks counts it (with a crafting table, and a furnace when it smelts). */
function cost(d: Design) {
  const bill = designBill(d);
  let plan = materials.plan(bill);
  plan = materials.plan({ ...bill, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
  return { plan, units: Object.values(plan.gather).reduce((t, q) => t + q, 0) + 1, smelts: plan.fuel.smelts };
}

// The site line as tieredBrain's siteRoom writes it for a 32x32 site (Minevale7's); before D.1 capped at 9x9
const fits: Array<[number, number]> = [];
for (let n = 1; n <= 4; n++) {
  let best = 0;
  for (let f = 3; f <= 15; f++) {
    const l = layoutBuildings(0, 0, Array.from({ length: n }, () => ({ name: 'b', width: f, depth: f })), 2, 1);
    if (Math.max(l.width, l.depth) <= 32) best = f;
  }
  if (best >= 5) fits.push([n, OLD ? Math.min(best, SURVIVAL_MAX) : best]);
}
const SITE = `The village site is 32x32 of level ground; it holds, with streets: ${fits.map(([n, f]) => `${n} building${n > 1 ? 's' : ''} of up to ${f}x${f}`).join(', or ')}. Designs already drawn take their share of it. Size this one so the objective fits if it can, but never smaller than 5x5: what does not fit goes on a second site.`;
const VILLAGE = 'It is for the village Benchvale (objective: two matching cottages and a meeting hall).';
const CASES: Record<string, { name: string; brief: string; survival: boolean; existing?: string }> = {
  cottage: { name: 'cottage', survival: true, brief: 'A small cottage for two villagers, one of two matching cottages: oak planks walls, oak log corners, glass windows, about 7x7.' },
  hall: { name: 'meeting_hall', survival: true, brief: 'A larger meeting hall for the whole village: cobblestone base, oak planks and logs, windows, about 9x9.', existing: 'cottage (7x7, a small oak cottage with log corners and glass windows)' },
  cottage_creative: { name: 'cottage', survival: false, brief: 'A small cozy cottage for two villagers: oak planks walls, oak log corners, cobblestone floor, glass windows, about 7x7.' },
  hall_creative: { name: 'meeting_hall', survival: false, brief: 'A meeting hall for the whole village: stone bricks and spruce, large windows, about 11x11.' },
};

function userPrompt(c: (typeof CASES)[string]): string {
  return [
    `Design a building named "${c.name}". Brief: ${c.brief}`,
    VILLAGE,
    c.existing ? `Existing designs (make this one distinct): ${c.existing}` : '',
    c.survival ? DESIGN_SURVIVAL : '',
    c.survival ? SITE : '',
  ].filter(Boolean).join('\n');
}

async function chat(model: string, system: string, user: string) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false, think: false, keep_alive: '30m',
      options: { num_ctx: 8192, temperature: 0.4 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      tools: (OLD || process.env.STYLES === '0' ? [DESIGN_TOOL] : [STYLE_TOOL, DESIGN_TOOL]).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    }),
    signal: AbortSignal.timeout(300000),
  });
  const d = (await res.json()) as any;
  if (d.error) throw new Error(d.error);
  const calls = (d.message?.tool_calls ?? []).map((c: any) => ({ name: c.function.name, input: typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments) : c.function.arguments }));
  return { ms: Date.now() - t0, calls };
}

/** The brain's checks on a design (tieredBrain design()). */
function check(input: Record<string, unknown>, name: string, survival: boolean, brief: string, style?: BuildingStyle) {
  const { design, errors } = validateDesign({ ...input, name }, 'bench', OLD ? { isPlaceable } : { isPlaceable, blocks: designBlockList(survival), states: true });
  if (style && errors.length) console.log(`    GENERATOR BUG: ${errors.join('; ')} -- ${JSON.stringify(style)}`);
  if (design && survival) {
    const c = cost(design);
    const hard = hardToGather(c.plan.gather);
    if (c.plan.problems.length || hard.length) errors.push(`these blocks cannot be had here: ${[...c.plan.problems, ...hard].join('; ')}; use other materials`);
    const stations = [...new Set(Object.values(design.palette).map((b) => b.replace(/\[.*$/, '')).filter((b) => /^(furnace|blast_furnace|smoker|crafting_table|chest|barrel|anvil)$/.test(b)))];
    if (stations.length) errors.push(`leave out the ${stations.join(', ')}: workstations and containers are not part of a building here`);
    if (OLD) {
      if (Math.max(design.width, design.depth) > SURVIVAL_MAX) errors.push(`it is ${design.width}x${design.depth}; buildings here are at most ${SURVIVAL_MAX}x${SURVIVAL_MAX} (every block is gathered by hand); draw it smaller`);
    } else {
      // tieredBrain.ts design(): a landmark by its name
      const landmark = isLandmark(design.name);
      const budget = landmark ? LANDMARK_UNITS : HOUSE_UNITS;
      if (c.units > budget) errors.push(`it needs ${c.units} blocks gathered by hand (logs, cobblestone, sand...); here a ${landmark ? 'landmark' : 'house'} may need at most ${budget}: ${style ? smallerStyle(style, budget, (d) => cost(d).units) : 'make it smaller, lower or plainer (planks and logs go furthest; a flat floor of "_" keeps the prepared ground)'}`);
      if (c.smelts > MAX_SMELTS) errors.push(`it needs ${c.smelts} furnace runs (glass, stone, stone bricks); at most ${MAX_SMELTS}: use fewer of them${style ? ' (stone and stone bricks are smelted from cobblestone and glass from sand: cobblestone or planks, and panes or open windows, need none or few)' : ''}`);
    }
  }
  return { design, errors };
}

/**
 * The roof read from the layers: "stairs" when any stair block is placed in the top third; "pitched" when the top
 * layers' filled area shrinks inward layer by layer over two or more layers (a stepped or gabled roof of full blocks or
 * slabs); "flat" otherwise. "open" when the top layer covers under half the footprint's inside.
 */
function roofShape(d: Design): string {
  const filled = (l: string[]) => l.reduce((s, r) => s + [...r].filter((c) => c !== '.' && c !== '_' && d.palette[c] !== 'air').length, 0);
  const top = d.layers.length - 1;
  const from = Math.max(1, Math.floor((d.layers.length * 2) / 3));
  for (let li = from; li <= top; li++) if (d.layers[li].some((r) => [...r].some((c) => /_stairs/.test(d.palette[c] ?? '')))) return 'stairs';
  const counts = d.layers.map(filled);
  let shrink = 0;
  for (let li = top; li > 0 && counts[li] < counts[li - 1] && counts[li] > 0; li--) shrink++;
  if (shrink >= 2) return 'pitched';
  if (counts[top] < 0.5 * (d.width - 2) * (d.depth - 2)) return 'open';
  return 'flat';
}

const models = process.argv.slice(2).length ? process.argv.slice(2) : ['gpt-oss:120b-cloud'];
const cases = (process.env.CASES ? process.env.CASES.split(',') : Object.keys(CASES)).filter((c) => CASES[c]);
const all: unknown[] = [];
for (const model of models) {
  console.log(`\n=== ${model}  (${N} per case)`);
  for (const cn of cases) {
    const c = CASES[cn];
    const rows: Array<{ ok: boolean; tries: number; s: number; d?: Design; roof?: string; gather?: number; logs?: number; cobble?: number; mats?: string[]; err?: string; via?: string; style?: BuildingStyle }> = [];
    for (let k = 0; k < N; k++) {
      let user = userPrompt(c), s = 0, tries = 0, last: string[] = [];
      let out: (typeof rows)[number] | null = null;
      // tieredBrain.ts DESIGN_TRIES (2 before D.1)
      for (let attempt = 0; attempt < (OLD ? 2 : 3) && !out; attempt++) {
        tries++;
        try {
          const r = await chat(model, OLD ? DESIGN_SYSTEM : designSystem(designBlockList(c.survival), true), user);
          s += r.ms / 1000;
          const call = r.calls.find((x: any) => x.name === 'submit_design' || x.name === 'submit_style');
          // A style is drawn by code first (tieredBrain.ts design())
          let input = call?.input, style: BuildingStyle | undefined, refused: string[] = [];
          if (call?.name === 'submit_style') {
            const n = normalizeStyle({ ...call.input, name: c.name });
            // tieredBrain.ts design(): furnace runs fitted by code in survival
            if (n.style) style = c.survival && !OLD ? fitSmelts(n.style, (st) => cost(generateDesign(st)).smelts, MAX_SMELTS).style : n.style;
            if (style) input = { ...generateDesign(style) };
            else refused = n.errors;
          }
          const { design, errors } = !call ? { design: undefined, errors: ['no submit_style or submit_design call was made'] } : refused.length ? { design: undefined, errors: refused } : check(input, c.name, c.survival, c.brief, style);
          if (design && !errors.length) {
            const g = cost(design).plan.gather;
            const sum = (re: RegExp) => Object.entries(g).filter(([n]) => re.test(n)).reduce((t, [, q]) => t + q, 0);
            out = { ok: true, tries, s, d: design, via: style ? 'style' : 'layers', style, roof: style ? `${style.roof}${style.overhang ? '+overhang' : ''}` : roofShape(design), gather: Object.values(g).reduce((t, q) => t + q, 0), logs: sum(/log|stem/), cobble: sum(/cobblestone|^stone$/), mats: [...new Set(Object.values(design.palette))].sort() };
          } else {
            last = errors;
            if (process.env.TRIES) console.log(`    try ${tries} (${call?.name ?? 'no call'}) refused: ${errors.join(' | ').slice(0, 400)}`);
            user +=`\n\nYour previous design had problems; fix them and submit again:\n- ${errors.join('\n- ')}`;
          }
        } catch (e) {
          last = [(e as Error).message];
        }
      }
      out ??= { ok: false, tries, s, err: last.slice(0, 2).join('; ') };
      rows.push(out);
      all.push({ model, case: cn, ...out, d: out.d ? { width: out.d.width, depth: out.d.depth, height: out.d.height, blocks: out.d.blocks, palette: out.d.palette, layers: out.d.layers, description: out.d.description } : undefined });
      const d = out.d;
      console.log(`  ${cn} #${k + 1}: ${out.ok ? `${out.via}: ${d!.width}x${d!.depth}x${d!.height}, ${d!.blocks} blocks, roof ${out.roof}, gather ${out.gather} (logs ${out.logs}, cobble ${out.cobble}), ${out.mats!.join(' ')}` : `INVALID: ${out.err}`}  [${out.s.toFixed(1)} s, ${out.tries} tr${out.tries > 1 ? 'ies' : 'y'}]`);
      if (process.env.PEEK && d) console.log(d.layers.map((l, i) => `    L${i}: ${l.join(' | ')}`).join('\n'));
    }
    const ok = rows.filter((r) => r.ok);
    const mean = (f: (r: (typeof rows)[number]) => number) => (ok.length ? ok.reduce((t, r) => t + f(r), 0) / ok.length : 0);
    const roofs: Record<string, number> = {};
    for (const r of ok) roofs[r.roof!] = (roofs[r.roof!] ?? 0) + 1;
    console.log(`  ${cn}: valid ${ok.length}/${rows.length} (${rows.filter((r) => r.ok && r.tries > 1).length} after a retry; ${ok.filter((r) => r.via === 'style').length} by style); roofs ${JSON.stringify(roofs)}; mean ${mean((r) => r.d!.blocks).toFixed(0)} blocks, gather ${mean((r) => r.gather!).toFixed(0)}, ${mean((r) => r.d!.width * r.d!.depth).toFixed(0)} cells of footprint, ${mean((r) => r.d!.height).toFixed(1)} layers; ${(rows.reduce((t, r) => t + r.s, 0) / rows.length).toFixed(1)} s a design`);
  }
}
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(all, null, 1));

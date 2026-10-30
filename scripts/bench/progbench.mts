/**
 * progbench (#175, brief runs/2026-10-29/planning/brief_houseprog.md): members describe the house they want in words, a
 * model writes it as a program against the house library (server/src/houseProgram.ts, LIBRARY_DOC), and code runs,
 * compiles and fits it. ~30 descriptions in members' voices across the five families, some plain, some asking for what
 * #174's generator cannot do (a tower, a courtyard, a bay window, a long hall) or what the library lacks (a balcony, a
 * cellar, a spire), N samples each.
 * Counts: replies with code; programs that run (clean, and with unknown names stubbed); houses that fit and pass
 * validateDesign (rain, solid roof, door), the box, 12 layers, HOUSE_UNITS and 32 smelts after code's cuts; the
 * description's features present in the program's spec (asked) and in the house built (after the cuts); unknown
 * functions invented; units against #174's character draws for the same members; latency and tokens.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/progbench.mts
 * Env: MODEL (default qwen3.8:27b), OLLAMA (default http://127.0.0.1:11436, the pinned local planner server), N (samples,
 *   default 3), TEMP (default 0.7), ONLY (description ids, comma-separated), PEEK=1 (each program and its result),
 *   REPORT=FILE.jsonl (the report again from a run's rows, no calls), REPLAY=FILE.jsonl (the run's replies again through
 *   today's library: new rows, no calls), DESIGNS=1 (also write each built design as JSON
 *   beside the rows, for scripts/render_design.py).
 *   THINK (the reasoning level for gpt-oss, default medium as the design kind; false for other models).
 * gpt-oss cloud: MODEL=gpt-oss:120b-cloud OLLAMA=http://127.0.0.1:11434.
 * Writes rows to runs/<date>/bench/progbench-<ts>.jsonl and the summary beside it (.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import minecraftData from 'minecraft-data';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.MC_TIME_SCALE = '1';
const P = await import('../../server/src/houseProgram');
const H = await import('../../server/src/houseStyle');
const { V2_LIMITS } = await import('../../server/src/buildingGen');
const { HOUSE_UNITS, MAX_SMELTS, validateDesign } = await import('../../server/src/designs');
const { NAME_POOL } = await import('../../server/src/agentNames');
const { Materials, designBill } = await import('../../server/src/mineflayer/mcMaterials');
type Design = import('../../server/src/village').Design;
type HouseSpec = import('../../server/src/houseProgram').HouseSpec;

const reg = minecraftData('26.1');
const materials = new Materials(reg);
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
const costs = new Map<string, { units: number; smelts: number }>();
const cost = (d: Design) => {
  const k = JSON.stringify([d.layers, d.palette]);
  let c = costs.get(k);
  if (!c) {
    const b = designBill(d);
    let plan = materials.plan(b);
    plan = materials.plan({ ...b, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
    c = { units: Object.values(plan.gather).reduce((t, q) => t + q, 0) + 1, smelts: plan.fuel.smelts };
    costs.set(k, c);
  }
  return c;
};
const bill = { units: (d: Design) => cost(d).units, smelts: (d: Design) => cost(d).smelts };
function problems(d: Design): string[] {
  const p: string[] = [];
  const { errors } = validateDesign({ ...d, layers: d.layers.map((l) => [...l]), palette: { ...d.palette } }, 'bench', { isPlaceable, states: true });
  p.push(...errors);
  if (d.width > V2_LIMITS.maxBox || d.depth > V2_LIMITS.maxBox) p.push(`box ${d.width}x${d.depth}`);
  if (d.height > V2_LIMITS.maxLayers) p.push(`${d.height} layers`);
  const c = cost(d);
  if (c.units > HOUSE_UNITS) p.push(`${c.units} units`);
  if (c.smelts > MAX_SMELTS) p.push(`${c.smelts} smelts`);
  return p;
}

/** Features a description asks for, read off a spec. */
const FEATURES: Record<string, (s: HouseSpec) => boolean> = {
  storeys2: (s) => s.body.storeys === 2,
  tower: (s) => s.towers.length > 0,
  wing: (s) => s.wings.length > 0,
  courtyard: (s) => s.wings.length === 2 && s.wings[0].side === s.wings[1].side,
  bay: (s) => s.bays.length > 0,
  porch: (s) => s.porch,
  chimney: (s) => !!s.chimney,
  shutters: (s) => s.shutters,
  small: (s) => s.body.width * s.body.depth <= 35 && s.body.storeys === 1 && !s.wings.length && !s.towers.length,
  long: (s) => Math.max(s.body.width, s.body.depth) >= 9 && Math.max(s.body.width, s.body.depth) >= 1.6 * Math.min(s.body.width, s.body.depth),
  big: (s) => s.body.width * s.body.depth >= 49 || (s.body.width * s.body.depth >= 35 && (s.body.storeys === 2 || s.wings.length > 0)),
  timber: (s) => s.frame === 'timber',
  wide_windows: (s) => s.windows === 'wide',
  few_windows: (s) => s.windows === 'single' || s.windows === 'none',
  'walls:cobblestone': (s) => s.walls === 'cobblestone',
  'walls:stone': (s) => s.walls === 'stone_bricks' || s.walls === 'cobblestone',
  'walls:logs': (s) => s.walls === 'logs',
  'walls:sandstone': (s) => s.walls === 'sandstone',
  'roof:hip': (s) => s.roof === 'hip',
  'roof:flat': (s) => s.roof === 'flat',
  'roof:gable': (s) => s.roof === 'gable',
  'roof:stone': (s) => s.roof_material !== 'planks',
  'base:stone': (s) => s.base !== 'none',
};

interface Desc { id: string; family: string; text: string; want: string[]; beyond?: string }
// (members' voices; `beyond` names what the library has no piece for)
const DESCS: Desc[] = [
  { id: 'plain_cottage', family: 'plains', text: 'Nothing fancy. A small cottage I can keep warm, with a chimney.', want: ['small', 'chimney'] },
  { id: 'tall_house', family: 'plains', text: 'I want to look out over the fields: two floors, big windows upstairs.', want: ['storeys2', 'wide_windows'] },
  { id: 'watchtower', family: 'plains', text: 'A house with a tower on it so I can see who is coming up the road.', want: ['tower'] },
  { id: 'courtyard', family: 'plains', text: 'Two wings around a little courtyard in front, like a farmstead.', want: ['courtyard'] },
  { id: 'bay_reader', family: 'plains', text: 'I read a lot. A bay window by my chair, and a porch to sit on in the evening.', want: ['bay', 'porch'] },
  { id: 'long_hall', family: 'taiga', text: 'A long hall, like the old longhouses, low and narrow, logs for walls.', want: ['long', 'walls:logs'] },
  { id: 'stone_keep', family: 'taiga', text: 'Thick stone walls and a stone roof. I do not want to rebuild it every winter.', want: ['walls:stone', 'roof:stone'] },
  { id: 'l_workshop', family: 'taiga', text: 'An L-shaped house: the living part and a workshop wing off to one side, with a chimney for the forge.', want: ['wing', 'chimney'] },
  { id: 'timber_two', family: 'taiga', text: 'A proper timber-framed house, two storeys, with shutters on the windows.', want: ['timber', 'storeys2', 'shutters'] },
  { id: 'cabin', family: 'taiga', text: 'Just a little cabin. One room. Few windows, it gets cold.', want: ['small', 'few_windows'] },
  { id: 'savanna_porch', family: 'savanna', text: 'A wide house with a deep porch where the neighbours can sit in the shade.', want: ['porch', 'big'] },
  { id: 'savanna_tower', family: 'savanna', text: 'A lookout tower at the back corner, I keep an eye on the herds.', want: ['tower'] },
  { id: 'savanna_hip', family: 'savanna', text: 'A big family house under one hip roof, two floors for the children.', want: ['roof:hip', 'storeys2', 'big'] },
  { id: 'savanna_cross', family: 'savanna', text: 'A cross-shaped house, the front wing sticking out towards the street.', want: ['wing'] },
  { id: 'savanna_simple', family: 'savanna', text: 'Like my neighbours have. I do not want to stand out.', want: ['small'] },
  { id: 'desert_court', family: 'desert', text: 'A house built round a shaded courtyard, flat roof, thick sandstone walls.', want: ['courtyard', 'roof:flat', 'walls:sandstone'] },
  { id: 'desert_tower', family: 'desert', text: 'A flat-roofed house with a square tower where I can sleep in the cool at night.', want: ['tower', 'roof:flat'] },
  { id: 'desert_long', family: 'desert', text: 'A long low storehouse of a home, I trade goods and need the room.', want: ['long'] },
  { id: 'desert_two', family: 'desert', text: 'Two floors of sandstone, small windows against the sun.', want: ['storeys2', 'few_windows', 'walls:sandstone'] },
  { id: 'desert_bays', family: 'desert', text: 'I want windows that stick out on both sides so I catch the breeze.', want: ['bay'] },
  { id: 'snowy_chimney', family: 'snowy', text: 'Warm above all: a stone base, a big chimney, a steep roof the snow slides off.', want: ['chimney', 'base:stone', 'roof:gable'] },
  { id: 'snowy_lodge', family: 'snowy', text: 'A hunting lodge with two wings either side of the main room.', want: ['wing'] },
  { id: 'snowy_tower', family: 'snowy', text: 'A stone tower house, two storeys, the tower taller than the rest.', want: ['tower', 'storeys2'] },
  { id: 'snowy_cosy', family: 'snowy', text: 'Small and cosy, a porch to knock the snow off my boots, shutters to close at night.', want: ['small', 'porch', 'shutters'] },
  { id: 'mansion', family: 'plains', text: 'The finest house in the village: two storeys, two wings, a tower, a porch. Everything.', want: ['storeys2', 'wing', 'tower', 'porch'] },
  { id: 'balcony', family: 'plains', text: 'A two-storey house with a balcony over the front door.', want: ['storeys2'], beyond: 'balcony' },
  { id: 'cellar', family: 'taiga', text: 'A cottage with a cellar under it for my potatoes, and a chimney.', want: ['chimney'], beyond: 'cellar' },
  { id: 'spire', family: 'plains', text: 'I am the priest. A narrow house with a tall pointed spire.', want: ['tower'], beyond: 'spire' },
  { id: 'greenhouse', family: 'savanna', text: 'A house with a glass greenhouse wing for my seedlings.', want: ['wing'], beyond: 'glass wing' },
  { id: 'round_tower', family: 'snowy', text: 'A round stone tower to live in, like a wizard.', want: ['tower', 'walls:stone'], beyond: 'round walls' },
];

const FAMILY_WORDS: Record<string, string> = {
  plains: 'oak planks walls on a cobblestone base, log corner posts, gable roofs of planks, glass panes',
  taiga: 'spruce planks walls on a cobblestone base, log corner posts, gable roofs of planks, glass panes',
  savanna: 'acacia planks walls, log corner posts, hip roofs of planks, glass panes',
  desert: 'sandstone walls, flat sandstone roofs, open windows',
  snowy: 'spruce planks walls on a cobblestone base, log corner posts, hip roofs of planks, glass panes',
};

const SYSTEM = `You design houses for members of a Minecraft village. Reply with only a short JavaScript program in one \`\`\`js block that calls the library below, then nothing else.

${P.LIBRARY_DOC}`;
const userPrompt = (member: string, d: Desc) => `${member} lives on a ${d.family} street (${FAMILY_WORDS[d.family]}).
Budget: ${HOUSE_UNITS} units of materials. A plain 5x5 house is about 90 units, a 7x7 one-storey about 120 and two-storey about 215; a wing adds about 45, a tower about 60.
${member} says: "${d.text}"
Write ${member}'s house.`;

interface Row {
  id: string; s: number; member: string; family: string; reply: string; code: string; ms: number; pt?: number; ot?: number;
  ran: boolean; clean: boolean; error?: string; unknown: string[]; calls: number; notes: string[];
  asked?: HouseSpec; built?: HouseSpec; cuts?: string[]; units?: number; problems?: string[]; pass: boolean;
  wantAsked: number; wantBuilt: number; want: string[]; missing: string[]; charUnits?: number; desc?: string; note?: string;
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
const outDir = path.join(ROOT, 'runs', new Date().toISOString().slice(0, 10), 'bench');
fs.mkdirSync(outDir, { recursive: true });
const base = path.join(outDir, `progbench-${stamp}`);
let rows: Row[] = [];

// CHAR=1: the world's prompt (homeDesign.ts buildProgramPrompt) in the members' own characters, no description, 24
// members across the five families, N samples; STAKE=1 adds #174's stake line. Counts the spread the world will see:
// two-storey share, units, distinct forms, failures. VILLAGE=6: six members already in one house, as in train 11 (a 7x7
// hip house on four streets, two of them in the member's own). HD=<file> benches a copy of homeDesign.ts in server/src
// instead (the train 11 prompt, for a before row).
if (process.env.CHAR === '1') {
  const HD = (process.env.HD ? await import(`../../server/src/${process.env.HD}`) : await import('../../server/src/homeDesign')) as typeof import('../../server/src/homeDesign');
  const MODEL = process.env.MODEL ?? 'qwen3.8:27b';
  const OLLAMA = process.env.OLLAMA ?? 'http://127.0.0.1:11436';
  const N = Number(process.env.N ?? 1), TEMP = Number(process.env.TEMP ?? 0.7);
  const fams = Object.keys(H.FAMILY);
  const out = fs.createWriteStream(`${base}-char.jsonl`);
  const got: Array<{ member: string; family: string; form: string; units?: number; storeys?: number; ok: boolean; s: number; cut: boolean; note?: string; said?: string; ms: number }> = [];
  for (const [i, member] of NAME_POOL.slice(0, 24).entries()) {
    const family = fams[i % fams.length];
    const stake = process.env.STAKE === '1' ? [`The houses before yours in this street come to about ${90 * (i % 5)} units; yours is built after them, so every unit you add delays your moving in.`] : [];
    // (STREET=1: three neighbours' houses alike, as a street in the world shows them: the staged HPp copied them)
    let street = process.env.STREET === '1' ? ['Ada', 'Ben', 'Clara'].map((m) => `${m}: 7x7 two-storey planks house with a gable planks roof, a porch, 197 units`) : [];
    let village = '';
    let forms: string[] = [];
    if (process.env.VILLAGE === '6') {
      const same = '7x7 one-storey planks house with a hip planks roof, a porch, shutters';
      const six = ['Clara', 'Iris', 'Grace', 'Quinn', 'Kai', 'Xavier'];
      street = six.filter((m) => m !== member).slice(0, 2).map((m) => `${m}: ${same}, 136 units`);
      village = '6 members\' houses: 0 with two storeys, 6 with porches, 0 L- or T-shaped.';
      forms = HD.villageForms ? HD.villageForms(six.map((m) => `${m}'s house: a ${same}`)) : [];
    }
    const ctx = { persona: '', character: HD.characterOf(member), self: 'You built 1 of the village\'s 12 buildings.', family, street, village, stake, forms };
    for (let s = 0; s < N; s++) {
      const t0 = Date.now();
      const r = await HD.castProgram({
        agent: member, spec: { provider: 'ollama', model: MODEL }, ctx, budget: HOUSE_UNITS, bill,
        call: (async (req: { system: string; user: string }) => {
          const res = await fetch(`${OLLAMA}/api/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MODEL, stream: false, think: false, keep_alive: -1, options: { num_ctx: 8192, temperature: TEMP, seed: 1000 * i + s }, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }] }),
          });
          const j = (await res.json()) as { message?: { content?: string } };
          return { reply: { calls: [], text: j.message?.content ?? '' }, ms: Date.now() - t0, waitMs: 0 };
        }) as never,
      });
      const b = r.built;
      const form = b ? `${b.body.width}x${b.body.depth}x${b.body.storeys}${b.wings.length ? `+${b.wings.length}w` : ''}${b.towers.length ? '+t' : ''}${b.bays.length ? '+b' : ''}${b.porch ? '+p' : ''}${b.chimney ? '+c' : ''}` : `none:${r.why}`;
      const row = { member, family, form, units: r.design ? bill.units(r.design) : undefined, storeys: b?.body.storeys, ok: !!r.design, s, cut: r.cuts.length > 0, note: r.note, said: r.said, ms: Date.now() - t0 };
      got.push(row);
      out.write(`${JSON.stringify({ ...row, code: r.code })}\n`);
      console.log(`${member} ${family} ${form} ${row.units ?? '-'} units ${(row.ms / 1000).toFixed(1)}s | ${r.note}${process.env.PEEK === '1' ? ` | "${r.said}"` : ''}`);
    }
  }
  out.end();
  const ok = got.filter((g) => g.ok);
  const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const summary = {
    rows: got.length, ok: ok.length, twoStorey: pct(ok.filter((g) => g.storeys === 2).length, ok.length), unitsMean: Math.round(mean(ok.map((g) => g.units ?? 0))),
    over200: pct(ok.filter((g) => (g.units ?? 0) > 200).length, ok.length), distinctForms: new Set(ok.map((g) => g.form)).size,
    withWing: pct(ok.filter((g) => /w/.test(g.form)).length, ok.length), withTower: pct(ok.filter((g) => /\+t/.test(g.form)).length, ok.length), cut: pct(ok.filter((g) => g.cut).length, ok.length),
    distinctPerSample: [...new Set(ok.map((g) => g.s))].map((k) => new Set(ok.filter((g) => g.s === k).map((g) => g.form)).size),
    villageForm: ok.filter((g) => g.form === '7x7x1+p').length,medianS: +(median(got.map((g) => g.ms)) / 1000).toFixed(1),
  };
  fs.writeFileSync(`${base}-char.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary), `\nrows ${base}-char.jsonl`);
  process.exit(0);
}

if (process.env.REPORT) {
  rows = fs.readFileSync(process.env.REPORT, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
} else {
  const MODEL = process.env.MODEL ?? 'qwen3.8:27b';
  const OLLAMA = process.env.OLLAMA ?? 'http://127.0.0.1:11436';
  // gpt-oss ignores think:false: give it a reasoning level instead (THINK=low|medium|high; the design kind is medium)
  const THINK = process.env.THINK ?? (/gpt-oss/.test(MODEL) ? 'medium' : false);
  const N =Number(process.env.N ?? 3), TEMP = Number(process.env.TEMP ?? 0.7);
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
  const descs = DESCS.filter((d) => !only || only.has(d.id));
  const out = fs.createWriteStream(`${base}.jsonl`);
  const replay = process.env.REPLAY ? new Map(fs.readFileSync(process.env.REPLAY, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row).map((r) => [`${r.id}#${r.s}`, r])) : null;
  for (const [i, d] of descs.entries()) {
    const member = NAME_POOL[i % NAME_POOL.length];
    const ref = H.fitHome(H.memberStyle(member, d.family), HOUSE_UNITS, bill);
    const charUnits = ref ? bill.units(ref.design) : undefined;
    for (let s = 0; s < N; s++) {
      const t0 = Date.now();
      const old = replay?.get(`${d.id}#${s}`);
      if (replay && !old) continue;
      const res = old ? null : await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, stream: false, think: THINK, keep_alive: -1,
          options: { num_ctx: 8192, temperature: TEMP, seed: 1000 * i + s },
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(member, d) }],
        }),
      });
      const j = (res ? await res.json() : { message: { content: old!.reply }, prompt_eval_count: old!.pt, eval_count: old!.ot }) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number; error?: string };
      const ms = old ? old.ms : Date.now() - t0;
      const reply = j.message?.content ?? `ERROR ${j.error ?? res?.status}`;
      const code = P.extractProgram(reply);
      const h = P.houseFromProgram(code, d.family, HOUSE_UNITS, bill, `home_${d.id}_${s}`);
      const fit = h.fit;
      const asked = h.spec;
      const has = (sp: HouseSpec | undefined) => d.want.filter((f) => sp && FEATURES[f](sp));
      const row: Row = {
        id: d.id, s, member, family: d.family, reply, code, ms, pt: j.prompt_eval_count, ot: j.eval_count,
        ran: h.run.calls.length > 0, clean: !h.run.error && !h.run.unknown.length, ...(h.run.error ? { error: h.run.error } : {}),
        unknown: h.run.unknown, calls: h.run.calls.length, notes: h.notes, asked, built: fit?.spec, cuts: fit?.cuts,
        units: fit ? bill.units(fit.design) : undefined, problems: fit ? problems(fit.design) : undefined, pass: false,
        want: d.want, wantAsked: has(asked).length / d.want.length, wantBuilt: has(fit?.spec).length / d.want.length,
        missing: d.want.filter((f) => !has(fit?.spec).includes(f)), charUnits, desc: fit?.design.description,
        note: fit ? P.programNote(fit.spec, fit.cuts, h.run.unknown, h.notes) : undefined,
      };
      row.pass = !!fit && !row.problems!.length;
      out.write(`${JSON.stringify(row)}\n`);
      rows.push(row);
      if (process.env.DESIGNS === '1' && fit) fs.writeFileSync(`${base}-${d.id}-${s}.design.json`, JSON.stringify(fit.design));
      console.log(`${d.id}#${s} ${member} ${(ms / 1000).toFixed(1)}s ran=${row.ran} clean=${row.clean} pass=${row.pass} asked=${row.wantAsked.toFixed(2)} built=${row.wantBuilt.toFixed(2)} units=${row.units ?? '-'} ${row.unknown.length ? `unknown=${row.unknown.join(',')} ` : ''}${row.error ? `error=${row.error.slice(0, 80)} ` : ''}cuts=${(row.cuts ?? []).join(',')}`);
      if (process.env.PEEK === '1') console.log(`  ${code.replace(/\n/g, '\n  ')}\n  -> ${row.desc ?? '(none)'}; notes: ${row.notes.join('; ') || 'none'}`);
    }
  }
  out.end();
}

// ---- the summary
const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const n = rows.length;
const byFeature: Record<string, { asked: number; built: number; of: number }> = {};
for (const r of rows) for (const f of r.want) {
  const b = (byFeature[f] ??= { asked: 0, built: 0, of: 0 });
  b.of++;
  if (r.asked && FEATURES[f](r.asked)) b.asked++;
  if (r.built && FEATURES[f](r.built)) b.built++;
}
const unknownCount: Record<string, number> = {};
for (const r of rows) for (const u of r.unknown) unknownCount[u] = (unknownCount[u] ?? 0) + 1;
const errors: Record<string, number> = {};
for (const r of rows) if (r.error) errors[r.error.replace(/\d+/g, 'N').slice(0, 70)] = (errors[r.error.replace(/\d+/g, 'N').slice(0, 70)] ?? 0) + 1;
const cutCount: Record<string, number> = {};
for (const r of rows) for (const c of r.cuts ?? []) cutCount[c] = (cutCount[c] ?? 0) + 1;
const noteCount: Record<string, number> = {};
for (const r of rows) for (const c of r.notes) {
  const k = c.replace(/\d+/g, 'N').replace(/"[^"]*"/g, '"X"').slice(0, 70);
  noteCount[k] = (noteCount[k] ?? 0) + 1;
}
const beyond = rows.filter((r) => DESCS.find((d) => d.id === r.id)?.beyond);
const passed = rows.filter((r) => r.pass);
const summary = {
  rows: n,
  code: pct(rows.filter((r) => r.code.length > 0 && /\w+\s*\(/.test(r.code)).length, n),
  ran: pct(rows.filter((r) => r.ran).length, n),
  ranClean: pct(rows.filter((r) => r.clean && r.ran).length, n),
  pass: pct(passed.length, n),
  cut: pct(rows.filter((r) => r.cuts?.length).length, n),
  matchAsked: Math.round(100 * mean(rows.map((r) => r.wantAsked))),
  matchBuilt: Math.round(100 * mean(rows.map((r) => r.wantBuilt))),
  fullAsked: pct(rows.filter((r) => r.wantAsked === 1).length, n),
  fullBuilt: pct(rows.filter((r) => r.wantBuilt === 1).length, n),
  beyondInvented: `${beyond.filter((r) => r.unknown.length).length} of ${beyond.length}`,
  inventedAny: pct(rows.filter((r) => r.unknown.length).length, n),
  unitsMean: Math.round(mean(passed.map((r) => r.units ?? 0))),
  charUnitsMean: Math.round(mean(passed.map((r) => r.charUnits ?? 0))),
  medianS: +(median(rows.map((r) => r.ms)) / 1000).toFixed(1),
  tokensIn: Math.round(mean(rows.map((r) => r.pt ?? 0))), tokensOut: Math.round(mean(rows.map((r) => r.ot ?? 0))),
  byFeature, unknownCount, errors, cutCount, noteCount,
  perDesc: Object.fromEntries(DESCS.filter((d) => rows.some((r) => r.id === d.id)).map((d) => {
    const rs = rows.filter((r) => r.id === d.id);
    return [d.id, { pass: rs.filter((r) => r.pass).length, of: rs.length, asked: +mean(rs.map((r) => r.wantAsked)).toFixed(2), built: +mean(rs.map((r) => r.wantBuilt)).toFixed(2), units: Math.round(mean(rs.filter((r) => r.units).map((r) => r.units!))) }];
  })),
};
if (!process.env.REPORT) fs.writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(process.env.REPORT ? '' : `rows ${base}.jsonl`);

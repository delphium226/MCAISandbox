/**
 * talkprogbench (the talk build's tier 2, runs/2026-11-01/talk-build): a person asks the Mayor for a public building that
 * none of the pre-designed ones fits, and the architect writes it as a program against the house library (talkDesign.ts
 * castPublic, its real prompt), run, compiled and fitted by code at LANDMARK_UNITS. Measures whether the library can
 * express buildings that are not houses: programs that run, buildings that fit and pass validateDesign, the box, 12
 * layers, LANDMARK_UNITS and 32 smelts; the features each request implies (a tower for a lighthouse, wide windows for a
 * school...) in the building built; invented functions; latency. Figures (11-12, sculpture.ts: a chicken statue, a
 * fountain, an arch...) must come back drawn as figures (box()/block()), pass without a door and use the easy blocks.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/talkprogbench.mts
 * Env: MODEL (default qwen3.8:27b), OLLAMA (default http://127.0.0.1:11436), N (samples, default 3), TEMP (0.7),
 *   THINK (gpt-oss's level, default low as the talk build calls it), ONLY (ids, comma-separated), PEEK=1 (each program),
 *   DESIGNS=1 (each built design as JSON beside the rows, for scripts/render_design.py).
 * gpt-oss cloud: MODEL=gpt-oss:120b-cloud OLLAMA=http://127.0.0.1:11434.
 * Writes runs/<date>/bench/talkprogbench-<ts>.jsonl and .json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import minecraftData from 'minecraft-data';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.MC_TIME_SCALE = '1';
const T = await import('../../server/src/talkDesign');
const { V2_LIMITS } = await import('../../server/src/buildingGen');
const { LANDMARK_UNITS, MAX_SMELTS, validateDesign } = await import('../../server/src/designs');
const { Materials, designBill, hardToGather } = await import('../../server/src/mineflayer/mcMaterials');
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
const cost = (d: Design) => {
  const b = designBill(d);
  let plan = materials.plan(b);
  plan = materials.plan({ ...b, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
  return { units: Object.values(plan.gather).reduce((t, q) => t + q, 0) + 1, smelts: plan.fuel.smelts };
};
const bill = { units: (d: Design) => cost(d).units, smelts: (d: Design) => cost(d).smelts };
function problems(d: Design, door = true): string[] {
  const p: string[] = [];
  const { errors } = validateDesign({ ...d, layers: d.layers.map((l) => [...l]), palette: { ...d.palette } }, 'bench', { isPlaceable, states: true, requireDoor: door });
  p.push(...errors);
  const plan = materials.plan(designBill(d)), hard = hardToGather(plan.gather);
  if (hard.length || plan.problems.length) p.push(`hard: ${[...hard, ...plan.problems].join(',')}`);
  if (d.width > V2_LIMITS.maxBox || d.depth > V2_LIMITS.maxBox) p.push(`box ${d.width}x${d.depth}`);
  if (d.height > V2_LIMITS.maxLayers) p.push(`${d.height} layers`);
  const c = cost(d);
  if (c.units > LANDMARK_UNITS) p.push(`${c.units} units`);
  if (c.smelts > MAX_SMELTS) p.push(`${c.smelts} smelts`);
  return p;
}

const FEATURES: Record<string, (s: HouseSpec) => boolean> = {
  tower: (s) => s.towers.length > 0,
  tall: (s) => s.body.storeys === 2 || s.towers.length > 0,
  storeys2: (s) => s.body.storeys === 2,
  big: (s) => s.body.width * s.body.depth >= 49 || (s.body.width * s.body.depth >= 35 && (s.body.storeys === 2 || s.wings.length > 0)),
  long: (s) => Math.max(s.body.width, s.body.depth) >= 9 || s.wings.length > 0,
  wide_windows: (s) => s.windows === 'wide' || s.bays.length > 0,
  chimney: (s) => !!s.chimney,
  porch: (s) => s.porch,
  stone: (s) => s.walls === 'stone_bricks' || s.walls === 'cobblestone' || s.walls === 'sandstone',
  glass: (s) => s.glass === 'glass' && s.windows !== 'none',
};

interface Desc { id: string; family: string; text: string; what: string; want: string[]; figure?: boolean }
// (none of these is one of the civic tier's kinds nor a vanilla work)
const DESCS: Desc[] = [
  { id: 'bakery', family: 'plains', text: 'Mayor, please build a bakery by the river', what: 'a bakery', want: ['chimney'] },
  { id: 'school', family: 'plains', text: 'can the village build a school for the children?', what: 'a school', want: ['big', 'wide_windows'] },
  { id: 'observatory', family: 'plains', text: 'Mayor, I want an observatory to watch the stars', what: 'an observatory', want: ['tower'] },
  { id: 'bathhouse', family: 'desert', text: 'build us a bathhouse please', what: 'a bathhouse', want: ['stone'] },
  { id: 'museum', family: 'plains', text: 'we should have a museum for the things we find', what: 'a museum', want: ['big', 'stone'] },
  { id: 'theatre', family: 'savanna', text: 'Mayor, build a theatre where we can put on plays', what: 'a theatre', want: ['big'] },
  { id: 'greenhouse', family: 'plains', text: 'a glass greenhouse next to the farm please', what: 'a greenhouse', want: ['glass', 'wide_windows'] },
  { id: 'wizard', family: 'taiga', text: "build a wizard's tower at the edge of the forest", what: "a wizard's tower", want: ['tower', 'stone'] },
  { id: 'lookout', family: 'taiga', text: 'a fire lookout on the hill would be good', what: 'a fire lookout', want: ['tall'] },
  { id: 'apothecary', family: 'snowy', text: 'Mayor, could we get an apothecary shop?', what: 'an apothecary', want: ['porch'] },
  { id: 'courthouse', family: 'plains', text: 'the village needs a courthouse', what: 'a courthouse', want: ['big', 'stone'] },
  { id: 'post_office', family: 'savanna', text: 'please build a post office near the market', what: 'a post office', want: ['porch'] },
  // (figures: drawn block by block, sculpture.ts)
  { id: 'chicken', family: 'plains', text: 'mayor, please build a statue of a chicken here', what: 'a statue of a chicken', want: [], figure: true },
  { id: 'fountain', family: 'plains', text: 'Mayor, could we have a fountain in the middle of the village?', what: 'a fountain', want: [], figure: true },
  { id: 'arch', family: 'desert', text: 'build a stone arch over the road please', what: 'a stone arch', want: [], figure: true },
  { id: 'horse', family: 'taiga', text: 'a statue of a horse by the gate would be lovely', what: 'a statue of a horse', want: [], figure: true },
  { id: 'mayor_statue', family: 'savanna', text: 'build a statue of the Mayor in the square', what: 'a statue of the Mayor', want: [], figure: true },
];

const MODEL = process.env.MODEL ?? 'qwen3.8:27b';
const OLLAMA = process.env.OLLAMA ?? 'http://127.0.0.1:11436';
const THINK = process.env.THINK ?? (/gpt-oss/.test(MODEL) ? 'low' : false);
const N = Number(process.env.N ?? 3), TEMP = Number(process.env.TEMP ?? 0.7);
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const day = new Date().toISOString().slice(0, 10);
const dir = path.join(ROOT, 'runs', day, 'bench');
fs.mkdirSync(dir, { recursive: true });
const base = path.join(dir, `talkprogbench-${MODEL.replace(/[:/]/g, '_')}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`);
const out = fs.createWriteStream(`${base}.jsonl`);
console.log(`talkprogbench ${MODEL} at ${OLLAMA}, think ${THINK}, ${N} samples, budget ${LANDMARK_UNITS} units`);
const rows: Array<Record<string, unknown> & { ok: boolean; pass: boolean; want: number; ms: number; unknown: string[]; id: string; form: string }> = [];
for (const [i, d] of DESCS.filter((x) => !only || only.has(x.id)).entries()) {
  for (let s = 0; s < N; s++) {
    const t0 = Date.now();
    const r = await T.castPublic({
      agent: 'Mayor', spec: { provider: 'ollama', model: MODEL }, ctx: { text: d.text, what: d.what, family: d.family }, budget: LANDMARK_UNITS, bill, name: T.askedName(d.what, `b${s}`),
      call: (async (req: { system: string; user: string }) => {
        const res = await fetch(`${OLLAMA}/api/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: MODEL, stream: false, think: THINK, keep_alive: -1, options: { num_ctx: 8192, temperature: TEMP, seed: 1000 * i + s }, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }] }),
        });
        const j = (await res.json()) as { message?: { content?: string }; error?: string };
        if (j.error) throw new Error(j.error);
        return { reply: { calls: [], text: j.message?.content ?? '' }, ms: Date.now() - t0, waitMs: 0 };
      }) as never,
    });
    const b = r.built;
    const form = r.figure && r.design ? `figure ${r.design.width}x${r.design.depth}x${r.design.height} ${Object.values(r.design.palette).join('/')}` : b ? `${b.body.width}x${b.body.depth}x${b.body.storeys}${b.wings.length ? `+${b.wings.length}w` : ''}${b.towers.length ? `+${b.towers.length}t` : ''}${b.bays.length ? '+b' : ''}${b.porch ? '+p' : ''}${b.chimney ? '+c' : ''} ${b.walls}/${b.roof}` : `none:${r.why}`;
    const pr = r.design ? [...problems(r.design, !r.figure), ...(!!d.figure !== !!r.figure ? [d.figure ? 'drawn as a building' : 'drawn as a figure'] : [])] : ['no design'];
    const got = b ? d.want.filter((f) => FEATURES[f](b)) : [];
    const row = { id: d.id, s, ok: !!r.design, pass: !!r.design && !pr.length, problems: pr, want: d.want.length ? got.length / d.want.length : 1, missing: d.want.filter((f) => !got.includes(f)),
      form, units: r.design ? bill.units(r.design) : undefined, height: r.design?.height, cuts: r.cuts, unknown: r.unknown, error: r.error, said: r.said, desc: r.design?.description, ms: Date.now() - t0, code: r.code };
    rows.push(row);
    out.write(`${JSON.stringify(row)}\n`);
    if (process.env.DESIGNS === '1' && r.design) fs.writeFileSync(`${base}-${d.id}-${s}.design.json`, JSON.stringify(r.design));
    console.log(`${d.id}#${s} ${(row.ms / 1000).toFixed(1)}s pass=${row.pass} want=${row.want.toFixed(2)} ${form} ${row.units ?? '-'}u h${row.height ?? '-'} ${r.unknown.length ? `unknown=${r.unknown.join(',')} ` : ''}${pr.length && r.design ? `problems=${pr.join(';').slice(0, 80)} ` : ''}cuts=${r.cuts.join(',')} | "${r.said.slice(0, 90)}"`);
    if (process.env.PEEK === '1') console.log(`  ${r.code.replace(/\n/g, '\n  ')}`);
  }
}
out.end();
const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const unknown: Record<string, number> = {};
for (const r of rows) for (const u of r.unknown) unknown[u] = (unknown[u] ?? 0) + 1;
const summary = {
  model: MODEL, rows: rows.length, design: pct(rows.filter((r) => r.ok).length, rows.length), pass: pct(rows.filter((r) => r.pass).length, rows.length),
  features: Math.round((100 * rows.reduce((t, r) => t + r.want, 0)) / Math.max(1, rows.length)), fullFeatures: pct(rows.filter((r) => r.want === 1).length, rows.length),
  distinctForms: new Set(rows.filter((r) => r.ok).map((r) => r.form)).size, unknown, medianS: +(median(rows.map((r) => r.ms)) / 1000).toFixed(1),
};
fs.writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary), `\nrows ${base}.jsonl`);
process.exit(0);

/**
 * homebench (#174, spec runs/2026-10-29/homedesign/spec.md section 5 and R10): members design their own houses on the real
 * prompt (homeDesign.ts buildDesignPrompt and castDesign, the real callModel), the 25 names in streets of 4 in their order,
 * each later owner seeing the earlier ones' choices and the street's larger house claimed as the world claims it. Options
 * and costs from houseStyle.ts homeOptions with Materials.plan's bill (as home_design.mts), so no world is loaded; the
 * persona is personaOf (the ballot's) and the character line characterOf, as a run shows them; the self and village lines
 * are left out.
 *
 * Arms: form (the prompt as a run sends it), suggest (code's character draw shown as "what your character suggests"),
 * nostake (no stake line), shuffled (each member shown another member's persona and character: the control for whether
 * choices follow character).
 * Measures, per arm and family: valid, partial and invalid shares; the max-out share (two storeys and all three extras)
 * before and after the cuts; asks for the larger house; cut share; per-field entropy against the character draw's;
 * agreement with the character draw; value-to-feature rank correlations (enhancement with storeys and larger,
 * conservation with the street look, openness with a wing and contrast walls, agreeableness with a porch); the
 * neighbour effect (a member's shape and storeys matching its street's earlier houses, against another street's) and
 * reasons naming a neighbour; the first-listed value's share against chance; consistency across samples; latency, tokens.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/homebench.mts
 * Env: MODEL (default ollama:gpt-oss:120b-cloud), THINK (default REASONING.home), N (samples, default 3), CONC (streets at
 *   once, one call each at a time; default 3), FAMILIES (default plains,savanna,desert), ARMS (default
 *   form,suggest,nostake,shuffled), PEEK=1 (each raw tool call and reason), DRY=1 (no network: the first values),
 *   REPORT=FILE.jsonl (the report again from a run's rows, no calls).
 * Writes rows to runs/<date>/bench/homebench-<ts>.jsonl and the summary beside it (.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import minecraftData from 'minecraft-data';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.MC_TIME_SCALE = '1';
process.env.MC_HOME_DESIGN = 'model';
const D = await import('../../server/src/homeDesign');
const H = await import('../../server/src/houseStyle');
const { HOUSE_UNITS, HOUSE_UNITS_LARGE } = await import('../../server/src/designs');
const { personaOf } = await import('../../server/src/temperament');
const { valuesOf, hexacoOf } = await import('../../server/src/character');
const { shuffled } = await import('../../server/src/choose');
const { NAME_POOL } = await import('../../server/src/agentNames');
const { parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');
const { Materials, designBill } = await import('../../server/src/mineflayer/mcMaterials');
type HomeChoice = import('../../server/src/houseStyle').HomeChoice;
type Design = import('../../server/src/village').Design;

const MEMBERS = ['Mayor', ...NAME_POOL.slice(0, 24)];
const FIELDS = ['size', 'shape', 'storeys', 'roof', 'walls', 'base', 'frame', 'windows', 'door', 'porch', 'chimney', 'shutters'] as const;

interface Row {
  arm: string; family: string; s: number; street: number; pos: number; member: string; shownAs: string;
  choice: HomeChoice | null; partial: string[]; why?: string; reason: string; ms?: number; pt?: number; ot?: number;
  fitted?: HomeChoice; cuts?: string[]; units?: number; needsLarger?: boolean; claimed?: boolean; first?: Record<string, unknown>; raw?: unknown;
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
const outDir = path.join(ROOT, 'runs', new Date().toISOString().slice(0, 10), 'bench');
fs.mkdirSync(outDir, { recursive: true });
let rows: Row[] = [];

if (process.env.REPORT) {
  rows = fs.readFileSync(process.env.REPORT, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
} else {
  const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
  const spec = parseSpec(MODEL);
  if (!spec) throw new Error(`MODEL=${MODEL} is not <provider>:<model>`);
  const level = (process.env.THINK?.trim().toLowerCase() || REASONING.home) as 'low' | 'medium' | 'high';
  const N = Number(process.env.N ?? 3), CONC = Number(process.env.CONC ?? 3);
  const FAMILIES = (process.env.FAMILIES ?? 'plains,savanna,desert').split(',').map((s) => s.trim()).filter(Boolean);
  const ARMS = (process.env.ARMS ?? 'form,suggest,nostake,shuffled').split(',').map((s) => s.trim()).filter(Boolean);
  const dry = process.env.DRY === '1';

  const reg = minecraftData('26.1');
  const materials = new Materials(reg);
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
  const optionCache = new Map<string, import('../../server/src/houseStyle').HomeOptions>();
  const optionsFor = (m: string, fam: string, budget: number) => {
    const key = `${fam}|${hexacoOf(m).X >= 0.5 ? 1 : 0}|${budget}`;
    let o = optionCache.get(key);
    if (!o) optionCache.set(key, (o = H.homeOptions(m, fam, budget, bill)));
    return o;
  };
  const fake = async (req: { tools: Array<{ input_schema: { properties: Record<string, { enum?: unknown[] }> } }> }) => {
    const props = req.tools[0].input_schema.properties;
    const input: Record<string, unknown> = { reason: 'dry', priority: ['storeys'] };
    for (const [k, p] of Object.entries(props)) if (p.enum) input[k] = p.enum[0];
      else if ((p as { type?: string }).type === 'boolean') input[k] = false;
    return { ms: 1, waitMs: 0, reply: { text: '', calls: [{ name: 'design_house', input }], promptTokens: 0, outputTokens: 0 } };
  };

  const jobs: Array<() => Promise<void>> = [];
  const file = path.join(outDir, `homebench-${stamp}.jsonl`);
  for (const arm of ARMS) for (const fam of FAMILIES) for (let s = 0; s < N; s++) for (let st = 0; st * 4 < MEMBERS.length; st++) jobs.push(async () => {
    const street = MEMBERS.slice(st * 4, st * 4 + 4);
    const done: Row[] = [];
    for (let pos = 0; pos < street.length; pos++) {
      const m = street[pos];
      const shownAs = arm === 'shuffled' ? MEMBERS[(MEMBERS.indexOf(m) + 7) % MEMBERS.length] : m;
      const claimer = done.find((r) => r.claimed)?.member;
      const options = optionsFor(m, fam, claimer ? HOUSE_UNITS : HOUSE_UNITS_LARGE);
      const lines = done.filter((r) => r.fitted).map((r) => `${r.member}: ${H.describeStyle(H.styleFromChoice(r.member, fam, r.fitted!)).replace(/^an? /, '')}, ${r.units} units${r.reason ? `; ${r.member}: "${r.reason.slice(0, 110)}"` : ''}`);
      const ahead = done.reduce((t, r) => t + (r.units ?? options.base), 0);
      const after = street.slice(pos + 1);
      const stake = arm === 'nostake' ? [] : [`The houses before yours in this street come to about ${ahead} units; yours is built after them, so every unit you add delays your moving in${after.length ? ` (and ${after.join(', ')}, built after you)` : ''}.`];
      const suggest = arm === 'suggest' ? `What your character suggests: ${H.describeStyle(H.memberStyle(m, fam)).replace(/ in \w+ /, ' ')}.` : '';
      const ctx = { persona: personaOf(shownAs), character: D.characterOf(shownAs), self: suggest, family: fam, street: lines, village: '', options, budget: HOUSE_UNITS, larger: { budget: HOUSE_UNITS_LARGE, ...(claimer ? { by: claimer } : {}) }, stake };
      const seed = `bench${s}|${m}|${fam}`;
      let raw: unknown;
      const res = await D.castDesign({
        agent: m, spec: spec!, level, ctx, fallback: H.characterChoice(m, fam), seed,
        call: (dry ? fake : async (req: Parameters<typeof import('../../server/src/modelCall').callModel>[0]) => {
          const r = await (await import('../../server/src/modelCall')).callModel(req);
          raw = r.reply.calls[0]?.input ?? r.reply.text;
          return r;
        }) as never,
      });
      const first: Record<string, unknown> = {};
      for (const [k, vs] of Object.entries(options.fields)) if (vs.length > 1) first[k] = shuffled(vs, `${seed}|${k}`)[0].value;
      const row: Row = { arm, family: fam, s, street: st, pos, member: m, shownAs, choice: res.choice, partial: res.partial, why: res.why, reason: res.reason, ms: res.ms, pt: res.promptTokens, ot: res.outputTokens, first, raw };
      if (res.choice) {
        const plain = H.fitChoice(m, fam, { ...res.choice, larger: false }, HOUSE_UNITS, bill);
        row.needsLarger = res.choice.larger && !!plain?.cuts.length;
        row.claimed = row.needsLarger && !claimer;
        const fit = row.claimed ? H.fitChoice(m, fam, { ...res.choice, larger: true }, HOUSE_UNITS_LARGE, bill) : plain;
        if (fit) Object.assign(row, { fitted: fit.choice, cuts: fit.cuts, units: bill.units(fit.design) });
      }
      done.push(row);
      rows.push(row);
      fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
      if (process.env.PEEK) console.log(`[${arm} ${fam} #${s} st${st}.${pos}] ${m}${shownAs !== m ? ` as ${shownAs}` : ''}: ${res.choice ? JSON.stringify(raw) : `(${res.why}) ${res.reason}`}${row.cuts?.length ? ` -> cut ${row.cuts.join(', ')}` : ''}`);
    }
  });
  console.log(`homebench: ${jobs.length} streets (${ARMS.join(',')} x ${FAMILIES.join(',')} x ${N}), ${MODEL} ${level}; rows to ${path.relative(ROOT, file)}`);
  let next = 0;
  await Promise.all(Array.from({ length: CONC }, async () => { while (next < jobs.length) await jobs[next++](); }));
}

// ---------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const entropy = (xs: unknown[]) => {
  const c = new Map<string, number>();
  for (const x of xs) c.set(String(x), (c.get(String(x)) ?? 0) + 1);
  return [...c.values()].reduce((t, n) => t - (n / xs.length) * Math.log2(n / xs.length), 0);
};
const rank = (xs: number[]) => {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r as number[];
};
const spearman = (a: number[], b: number[]) => {
  const ra = rank(a), rb = rank(b), n = a.length;
  const ma = ra.reduce((t, x) => t + x, 0) / n, mb = rb.reduce((t, x) => t + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) num += (ra[i] - ma) * (rb[i] - mb), da += (ra[i] - ma) ** 2, db += (rb[i] - mb) ** 2;
  return da && db ? num / Math.sqrt(da * db) : 0;
};
const maxed = (c: HomeChoice) => c.storeys === 2 && c.porch && c.chimney && c.shutters;
const lookStreet = (c: HomeChoice) => [c.roof, c.walls, c.base, c.frame].filter((x) => x === 'street').length / 4;
const ASSOC: Array<[string, (m: string) => number, (c: HomeChoice) => number]> = [
  ['enhancement~storeys+larger', (m) => valuesOf(m).enhancement, (c) => ((c.storeys === 2 ? 1 : 0) + (c.larger ? 1 : 0)) / 2],
  ['conservation~street look', (m) => valuesOf(m).conservation, lookStreet],
  ['openness~wing+contrast', (m) => valuesOf(m).openness, (c) => ((c.shape !== 'rect' ? 1 : 0) + (c.walls === 'contrast' ? 1 : 0)) / 2],
  ['agreeableness~porch', (m) => hexacoOf(m).A, (c) => (c.porch ? 1 : 0)],
];
const summary: Record<string, unknown> = {};
const groups = new Map<string, Row[]>();
for (const r of rows) for (const k of [`${r.arm}|${r.family}`, `${r.arm}|all`]) groups.set(k, [...(groups.get(k) ?? []), r]);
const lines: string[] = [];
for (const [key, rs] of [...groups.entries()].sort()) {
  const [arm, fam] = key.split('|');
  const got = rs.filter((r) => r.choice);
  const valid = got.filter((r) => !r.partial.length);
  const fams = fam === 'all' ? [...new Set(rs.map((r) => r.family))] : [fam];
  const charEnt: Record<string, number> = {}, modelEnt: Record<string, number> = {};
  for (const f of FIELDS) {
    charEnt[f] = fams.reduce((t, fm) => t + entropy(MEMBERS.map((m) => H.characterChoice(m, fm)[f])), 0) / fams.length;
    modelEnt[f] = fams.reduce((t, fm) => t + entropy(got.filter((r) => r.family === fm).map((r) => r.choice![f])), 0) / fams.length;
  }
  const agreeOf = (r: Row) => FIELDS.filter((f) => r.choice![f] === H.characterChoice(r.member, r.family)[f]).length / FIELDS.length;
  const agree = got.reduce((t, r) => t + agreeOf(r), 0) / (got.length || 1);
  const assoc: Record<string, number> = {};
  for (const [name, val, feat] of ASSOC) {
    const per = MEMBERS.map((m) => { const ms = got.filter((r) => r.member === m); return ms.length ? ms.reduce((t, r) => t + feat(r.choice!), 0) / ms.length : NaN; });
    const ok = MEMBERS.map((m, i) => [val(m), per[i]] as const).filter(([, y]) => !Number.isNaN(y));
    assoc[name] = Math.round(spearman(ok.map((x) => x[0]), ok.map((x) => x[1])) * 100) / 100;
  }
  // (the neighbour effect: shape and storeys matching the street's earlier houses, against another street's)
  let own = 0, ctl = 0, nOwn = 0, nCtl = 0, named = 0, later = 0;
  for (const r of got.filter((x) => x.pos > 0)) {
    const sib = (st: number) => got.filter((x) => x.family === r.family && x.s === r.s && x.street === st && x.pos < r.pos && x.arm === r.arm);
    const match = (x: Row) => (x.choice!.shape === r.choice!.shape ? 0.5 : 0) + (x.choice!.storeys === r.choice!.storeys ? 0.5 : 0);
    for (const x of sib(r.street)) own += match(x), nOwn++;
    for (const x of sib((r.street + 1) % 6)) ctl += match(x), nCtl++;
    later++;
    if (sib(r.street).some((x) => r.reason.includes(x.member))) named++;
  }
  let firstHits = 0, firstN = 0, chance = 0;
  for (const r of got) for (const [k, v] of Object.entries(r.first ?? {})) {
    firstN++;
    if ((r.choice as unknown as Record<string, unknown>)[k] === v) firstHits++;
    const field = rows.find((x) => x.first && k in x.first);
    void field;
    chance += 1 / (k === 'size' || k === 'shape' || k === 'windows' || k === 'door' || k === 'frame' ? 3.3 : 2);
  }
  const byMember = new Map<string, Row[]>();
  for (const r of got) byMember.set(`${r.member}|${r.family}`, [...(byMember.get(`${r.member}|${r.family}`) ?? []), r]);
  const multi = [...byMember.values()].filter((x) => x.length >= 2);
  const consistent = multi.filter((x) => x.every((r) => r.choice!.storeys === x[0].choice!.storeys && r.choice!.shape === x[0].choice!.shape)).length;
  const ms = got.map((r) => r.ms ?? 0).sort((a, b) => a - b);
  const s = {
    n: rs.length, valid: pct(valid.length, rs.length), partial: pct(got.length - valid.length, rs.length), invalid: pct(rs.length - got.length, rs.length),
    whys: Object.fromEntries([...new Set(rs.filter((r) => !r.choice).map((r) => r.why))].map((w) => [w, rs.filter((r) => r.why === w).length])),
    maxoutRaw: pct(got.filter((r) => maxed(r.choice!)).length, got.length), maxoutFitted: pct(got.filter((r) => r.fitted && maxed(r.fitted)).length, got.length),
    larger: pct(got.filter((r) => r.choice!.larger).length, got.length), cut: pct(got.filter((r) => r.cuts?.length).length, got.length),
    twoStorey: pct(got.filter((r) => r.choice!.storeys === 2).length, got.length), porch: pct(got.filter((r) => r.choice!.porch).length, got.length),
    chimney: pct(got.filter((r) => r.choice!.chimney).length, got.length), shutters: pct(got.filter((r) => r.choice!.shutters).length, got.length),
    wing: pct(got.filter((r) => r.choice!.shape !== 'rect').length, got.length),
    entropy: Object.fromEntries(FIELDS.map((f) => [f, `${modelEnt[f].toFixed(2)}/${charEnt[f].toFixed(2)}`])),
    agreeCharacter: `${Math.round(agree * 100)}%`, assoc,
    neighbour: `${pct(own, nOwn)} own street vs ${pct(ctl, nCtl)} other`, reasonsNameNeighbour: pct(named, later),
    firstListed: `${pct(firstHits, firstN)} vs chance ~${pct(chance, firstN)}`, consistent: pct(consistent, multi.length),
    unitsMean: Math.round(got.reduce((t, r) => t + (r.units ?? 0), 0) / (got.length || 1)),
    msMedian: ms[Math.floor(ms.length / 2)] ?? 0, tokens: `${Math.round(got.reduce((t, r) => t + (r.pt ?? 0), 0) / (got.length || 1))} in / ${Math.round(got.reduce((t, r) => t + (r.ot ?? 0), 0) / (got.length || 1))} out`,
  };
  summary[key] = s;
  lines.push(`${key}: ${JSON.stringify(s)}`);
}
for (const l of lines) console.log(l);
const tokIn = rows.reduce((t, r) => t + (r.pt ?? 0), 0), tokOut = rows.reduce((t, r) => t + (r.ot ?? 0), 0);
console.log(`calls ${rows.length}; tokens ${tokIn} in, ${tokOut} out: about $${((tokIn * 0.15 + tokOut * 0.6) / 1e6).toFixed(3)}`);
const sumFile = process.env.REPORT ? process.env.REPORT.replace(/\.jsonl$/, '.json') : path.join(outDir, `homebench-${stamp}.json`);
fs.writeFileSync(sumFile, JSON.stringify({ rows: rows.length, tokens: { in: tokIn, out: tokOut }, summary }, null, 2));
console.log(`summary: ${path.relative(ROOT, sumFile)}`);
console.log('ALL DONE');

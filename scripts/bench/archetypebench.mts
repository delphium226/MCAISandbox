/**
 * archetypebench (#115 2b): does an archetype change what members choose? Recorded model-driven menus (All1's by default)
 * are replayed through choose() with each context's persona and values line rewritten as the archetype gives them (its
 * temperament words and life goal, the house and role kept; the needs and mood lines kept), and the original member's own
 * option weights stripped (tw, gw, vw: its temperament's and goal's tags), so only the archetype differs. One archetype a
 * process (character.ts reads MC_CHARACTER_PRESET at load); `drawn` keeps the recorded lines (the baseline, stripped too).
 * Reports the pick share by option kind; --compare prints every saved result side by side.
 *
 * Usage: ARCHETYPE=invention node node_modules/tsx/dist/cli.mjs scripts/bench/archetypebench.mts [CHOICES.jsonl]
 *        node node_modules/tsx/dist/cli.mjs scripts/bench/archetypebench.mts --compare
 * Env: ARCHETYPE (wealth, invention, community, tradition, beauty or drawn), CASES (menus, default 40: the first of each
 *   agent's in turn), N (samples a case, default 3), CONC (default 3), MODEL (default gpt-oss cloud), DRY=1 (no network:
 *   the first option shown), OUT (default runs/2026-10-24/run-profiles/archetypebench).
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.OUT ?? 'runs/2026-10-24/run-profiles/archetypebench';
if (process.argv.includes('--compare')) {
  const files = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => f.endsWith('.json')) : [];
  const res = files.map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')) as { archetype: string; picks: number; byKind: Record<string, number>; invalid: number });
  const kinds = [...new Set(res.flatMap((r) => Object.keys(r.byKind)))].sort((a, b) => res.reduce((t, r) => t + (r.byKind[b] ?? 0), 0) - res.reduce((t, r) => t + (r.byKind[a] ?? 0), 0));
  console.log(`kind          ${res.map((r) => r.archetype.padStart(10)).join('')}`);
  for (const k of kinds) console.log(`${k.padEnd(14)}${res.map((r) => `${((100 * (r.byKind[k] ?? 0)) / Math.max(1, r.picks)).toFixed(0)}%`.padStart(10)).join('')}`);
  console.log(`${'picks'.padEnd(14)}${res.map((r) => String(r.picks).padStart(10)).join('')}`);
  console.log(`${'invalid'.padEnd(14)}${res.map((r) => String(r.invalid).padStart(10)).join('')}`);
  process.exit(0);
}

const ARCH = (process.env.ARCHETYPE ?? 'drawn').trim().toLowerCase();
if (ARCH !== 'drawn') {
  process.env.MC_CHARACTER_PRESET = ARCH;
  delete process.env.MC_CHARACTER_MIX;
}
process.env.MC_MODEL_RECORD = '0';
const file = process.argv[2] ?? 'runs/2026-10-24/all1/long/All1.choices.jsonl';
const CASES = Number(process.env.CASES) || 40, N = Number(process.env.N) || 3, CONC = Number(process.env.CONC) || 3;
const DRY = !!process.env.DRY;

const { choose } = await import('../../server/src/choose');
const { parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');
const ch = await import('../../server/src/character');
const spec = parseSpec(process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud')!;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
// (the recorded model choices with full options, one menu each, taken round-robin by agent so every member is in)
const byAgent = new Map<string, Any[]>();
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.type !== 'choice' || r.source !== 'model' || !Array.isArray(r.options) || r.options.length < 3 || !r.ctx) continue;
  if (!r.options.every((o: Any) => typeof o?.id === 'string' && typeof o?.name === 'string')) continue;
  if (!byAgent.has(r.agent)) byAgent.set(r.agent, []);
  byAgent.get(r.agent)!.push(r);
}
const picked: Any[] = [];
for (let i = 0; picked.length < CASES && [...byAgent.values()].some((xs) => xs.length > i); i++)
  for (const xs of byAgent.values()) if (xs[i] && picked.length < CASES) picked.push(xs[i]);

const STRIP = ['tw', 'gw', 'vw'];
function caseOf(r: Any) {
  const ctx = { persona: '', village: '', others: '', outcomes: [], ...r.ctx };
  if (ARCH !== 'drawn') {
    const house = /you live in ([^;.]+(?:\.\d+)?[^;.]*)/.exec(ctx.persona ?? '')?.[1];
    const role = /you have become the village's ([^;.(]+)/.exec(ctx.persona ?? '')?.[1]?.trim();
    ctx.persona = ch.identityLine(r.agent, { goal: ch.goalFromValues(r.agent), ...(house ? { house } : {}), ...(role ? { role } : {}) });
    ctx.character = String(ctx.character ?? '').replace(/You value [^.]*\./, ch.valuesLine(r.agent));
  }
  const options = r.options.map((o: Any, i: number) => ({
    ...Object.fromEntries(Object.entries(o).filter(([k]) => !STRIP.includes(k))),
    key: String(o.key ?? o.id), holds: o.holds ?? [], excludes: o.excludes ?? [], facts: String(o.facts ?? ''), effect: String(o.effect ?? ''), rank: Number.isFinite(o.rank) ? o.rank : i,
  }));
  return { name: `${r.agent}/${r.id}`, menu: { agent: r.agent, village: r.village, t: r.t, options, guarded: [], reasons: {}, ctx } };
}
const cases = picked.map(caseOf);
// (as choicebench's DRY: the first option shown)
const dry = async (req: Any) => ({ reply: { calls: [{ name: 'choose', input: { reason: 'dry', choice: (req.tools[0]?.input_schema as Any)?.properties?.choice?.enum?.[0] } }], text: '', promptTokens: 0, outputTokens: 0 }, ms: 1, waitMs: 0 });
const jobs = cases.flatMap((c) => Array.from({ length: N }, (_, i) => ({ c, i })));
console.log(`archetypebench ${ARCH}: ${cases.length} menus x ${N} (${jobs.length} decisions) from ${file}; e.g. "${cases[0]?.menu.ctx.persona}" / "${String(cases[0]?.menu.ctx.character).slice(0, 80)}"`);
const byKind: Record<string, number> = {};
let picks = 0, invalid = 0, next = 0, done = 0;
await Promise.all(Array.from({ length: Math.min(CONC, jobs.length) }, async () => {
  while (next < jobs.length) {
    const { c, i } = jobs[next++];
    const r = await choose({ agent: 'archetypebench', spec, level: REASONING.choose, menu: c.menu as Any, seed: `${c.name}#${i}`, ...(DRY ? { call: dry as Any } : {}) });
    const o = c.menu.options.find((x: Any) => x.id === r.id);
    if (o) {
      picks++;
      byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
    } else invalid++;
    if (++done % 30 === 0) console.log(`  ${done}/${jobs.length}`);
  }
}));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `${ARCH}.json`), JSON.stringify({ archetype: ARCH, file, cases: cases.length, n: N, picks, invalid, byKind, at: new Date().toISOString() }, null, 1));
console.log(`${ARCH}: ${picks} picks, ${invalid} invalid; ${Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${((100 * n) / picks).toFixed(0)}%`).join(', ')}`);
process.exit(0);

/**
 * #205's choicebench cases for the instinct tag (spec 6.5): replays a model-driven run's decision log through instincts.ts
 * (its own E1 lessons, sharing off) and, at each later model decision of a member holding an avoid instinct that matches
 * an option on its menu, writes a pair of cases: `NAME|off` (the menu as recorded, trimmed as decide() shows it) and
 * `NAME|on` (the same options with the instinct's `xw`, so the prompt tags them "[your instinct: avoid]", and the
 * "Your instincts" section in the context). Run choicebench on the file; scripts/bench/instinct_bench_sum.mts reads the
 * result.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/bench/instinct_cases.mts OUT.json CHOICES.jsonl [...] [--cases N]
 * Each log is replayed on its own; the pairs are spread evenly over all the decisions found.
 */
import fs from 'node:fs';

process.env.MC_INSTINCTS = 'on';
process.env.MC_INSTINCT_SHARE = 'off';
process.env.MC_TIME_SCALE ??= '1';
const I = await import('../../server/src/instincts.ts');
const { trimMenu } = await import('../../server/src/choose.ts');

const args = process.argv.slice(2);
const ci = args.indexOf('--cases');
const MAX = ci >= 0 ? Number(args.splice(ci, 2)[1]) : 10;
const [out, ...files] = args;
if (!out || !files.length) throw new Error('usage: instinct_cases.mts OUT.json CHOICES.jsonl [...] [--cases N]');
I.setInstinctLog(() => {});

const found: Array<{ name: string; avoid: string[]; options: unknown[]; ctx: Record<string, unknown>; xw: Record<string, number> }> = [];
for (const file of files) {
I.initInstincts(null);
const run = file.replace(/\\/g, '/').split('/').slice(-2).join('/').replace(/\.choices\.jsonl$/, '');
const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const seen = new Set<string>();
for (const r of rows) {
  if (r.type === 'choice') {
    if (r.source === 'model' && Array.isArray(r.options) && r.options.length >= 2 && r.ctx) {
      const opts = r.options.map((o: Record<string, unknown>) => ({ holds: [], excludes: [], ...o }));
      const menu = { agent: r.agent, village: r.village, options: opts, ctx: { ...r.ctx } };
      I.applyInstincts(menu);
      const avoid = opts.filter((o: { xw?: number }) => o.xw !== undefined && o.xw < 1).map((o: { id: string }) => o.id);
      // (one case per member and avoided set: the same lesson on many menus says little more)
      const k = `${r.agent}|${avoid.join(',')}`;
      if (avoid.length && !seen.has(k)) {
        seen.add(k);
        const shown = trimMenu(opts);
        if (shown.some((o: { id: string }) => avoid.includes(o.id)) && shown.length >= 2) {
          const xw = Object.fromEntries(shown.filter((o: { xw?: number }) => o.xw !== undefined).map((o: { id: string; xw?: number }) => [o.id, o.xw!]));
          found.push({ name: `${run}/${r.agent}/${r.id}`, avoid, options: shown.map(({ xw: _x, ...o }: { xw?: number }) => o), ctx: menu.ctx, xw });
        }
      }
    }
    I.noteChoice(r);
  } else if (r.type === 'choice-end') I.noteChoiceEnd({ ...r, contention: r.code });
}
}
const pick = found.length > MAX ? Array.from({ length: MAX }, (_, i) => found[Math.floor((i * found.length) / MAX)]) : found;
const cases = pick.flatMap((f) => {
  const { instincts: _s, ...plain } = f.ctx;
  return [
    { name: `${f.name}|off`, avoid: f.avoid, menu: { options: f.options, ctx: plain } },
    { name: `${f.name}|on`, avoid: f.avoid, menu: { options: f.options.map((o) => ({ ...(o as object), ...(f.xw[(o as { id: string }).id] !== undefined ? { xw: f.xw[(o as { id: string }).id] } : {}) })), ctx: f.ctx } },
  ];
});
fs.writeFileSync(out, JSON.stringify({ cases }, null, 1));
console.log(`instinct_cases: ${found.length} decisions with an avoided option on the menu (${new Set(found.map((f) => f.name.split('/')[1])).size} members); wrote ${pick.length} pairs to ${out}`);
for (const f of pick) console.log(`  ${f.name}: avoid ${f.avoid.join(', ')}; ${String(f.ctx.instincts ?? '').split('\n').slice(1).join(' ').slice(0, 160)}`);

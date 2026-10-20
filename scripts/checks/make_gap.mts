/**
 * The workshop's make/gather gap, offline (s41): for every good on a village record, its target, stock and plan now
 * (makePlan), and for each good at "inputs short" the raw items its deficit would have to gather (materials.plan's
 * gather and problems from the spare storage), grouped by whether gathering (logs, sand, cobblestone) can bring them.
 * Beside it gatherWanted's demand. The record is loaded into a real MineflayerWorld on a scratch copy (menu_probe.mts's
 * harness, cut down: RCON stubbed, console muted, save() never written).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/make_gap.mts [CHECKPOINT_DIR | villages.json] [--families LIST]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const FAMILIES = opt('--families') ?? 'make,gather,works,light,catalog,furnish,initiatives';
const input = argv[0] ?? 'mc/testcheckpoints/mv3_grown25';
let villagesFile = input, atlasFile: string | null = null;
if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
  villagesFile = path.join(input, 'villages.json');
  if (fs.existsSync(path.join(input, 'atlas.json'))) atlasFile = path.join(input, 'atlas.json');
}
process.env.MC_CHOICE_FAMILIES = FAMILIES;
process.env.MC_CHOOSE = 'fixed';
process.env.MC_VOTE = 'off';
process.env.MC_PROJECTS = 'off';
process.env.MC_GROW = '0';
process.env.MC_TIME_SCALE = '1';
process.env.MC_MODEL_RECORD = '0';
process.env.MC_APPETITE ??= '18';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'make-gap-'));
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');

const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const mute = () => { console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const unmute = () => Object.assign(console, quiet);
const say = (s: string) => quiet.log(s);

mute();
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const { storageContents } = await import('../../server/src/mineflayer/mcStorage');
const { makeBill } = await import('../../server/src/mineflayer/mcWorkshop');
const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
fs.copyFileSync(villagesFile, path.join(dir, 'villages.json'));
if (atlasFile) fs.copyFileSync(atlasFile, path.join(dir, 'atlas.json'));
const data = JSON.parse(fs.readFileSync(villagesFile, 'utf8')) as { villages: Any[] };
const base = data.villages.find((x) => x.complete) ?? data.villages[0];
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
w.villages.save = () => {};
if (w.atlas) w.atlas.save = () => {};
const v = w.villages.get(base.name);
const store = storageContents(v);
const goods = w.goodsFor(v);
const spare = w.makeSpare(v, '', undefined, store);
const wood = v.wood ?? w.woodOf(v, store);
const rows: Any[] = [];
for (const g of goods) {
  const target = w.makeTarget(v, g), stock = store[g.item] ?? 0;
  const p = w.makePlan(v, g, '', store);
  let gather: Record<string, number> = {}, problems: string[] = [];
  if ('why' in p && p.why === 'inputs short') {
    const s2 = { ...spare };
    delete s2[g.item];
    if (g.wood) for (const n of Object.keys(s2)) if (/_(log|planks)$/.test(n) && !n.startsWith(`${g.wood}_`)) delete s2[n];
    const plan = (b: Any, have: Any) => w.materials.plan(b, have);
    const count = Math.min(g.batch, Math.max(g.unit, target - stock));
    const b = makeBill(w.registry, plan, g, Math.max(1, Math.min(g.unit, count)), s2, wood);
    if (b) {
      const mp = plan(b.bill, s2);
      gather = mp.gather;
      problems = mp.problems;
    }
  }
  rows.push({ item: g.item, food: !!g.food, src: g.source ?? '', target, stock, why: 'why' in p ? p.why : `plan ${p.count}`, gather, problems });
}
const gw = w.gatherWanted(v, store);
unmute();

const EASY = (n: string) => /_log$|^any:logs$|^(red_)?sand$|^(any:)?cobblestone$/.test(n);
say(`make_gap: ${villagesFile}; village ${v.name}; ${goods.length} goods; families ${FAMILIES}`);
const by = (why: string) => rows.filter((r) => r.why === why);
const plannable = rows.filter((r) => r.why.startsWith('plan'));
say(`plans: ${plannable.length} plannable, ${by('at stock').length} at stock, ${by('inputs short').length} inputs short, ${by('no recipe').length} no recipe`);
say('\n== inputs short (one unit\'s gather from the spare storage)');
const missing = new Map<string, string[]>();
for (const r of by('inputs short')) {
  const g = Object.entries(r.gather).map(([n, q]) => `${n} ${q}`).join(', ');
  say(`  ${r.item.padEnd(26)} ${String(r.stock).padStart(4)}/${String(r.target).padEnd(4)} gather: ${g || '-'}${r.problems.length ? `; problems: ${r.problems.join('; ')}` : ''}`);
  for (const n of Object.keys(r.gather)) missing.set(n, [...(missing.get(n) ?? []), r.item]);
}
say('\n== raw items those goods lack, by how many goods (E = gathering brings it)');
for (const [n, xs] of [...missing.entries()].sort((a, b) => b[1].length - a[1].length)) say(`  ${EASY(n) ? 'E' : ' '} ${n.padEnd(22)} ${xs.length}: ${xs.slice(0, 8).join(', ')}${xs.length > 8 ? ', ...' : ''}`);
say('\n== plannable now');
for (const r of plannable) say(`  ${r.item.padEnd(26)} ${r.stock}/${r.target} ${r.why}`);
say('\n== at stock');
say(`  ${by('at stock').map((r) => `${r.item} ${r.stock}/${r.target}`).join(', ')}`);
say('\n== gatherWanted');
for (const [m, x] of Object.entries(gw) as Any) say(`  ${m.padEnd(12)} need ${x.need}, incoming ${x.incoming}, want ${x.want}; for ${x.for.slice(0, 6).join(', ')}`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.exit(0);

/**
 * #140: a flower bed whose flower runs out does not hold the project cap (train 5's C1: six beds stayed open on used-up
 * lilies of the valley). On a checkpoint loaded into a real MineflayerWorld (no server, seconds), with MC_GARDENS and
 * MC_FLOWER_MIX on: three open mixed beds (the cap, MC_INITIATIVES 3) with lily_of_the_valley in their mix; their gathering
 * answers "cannot be gathered here" for the lilies (initiativeNoneNear, as the gather chore's failure calls it):
 *   A. each bed drops the lily and goes on as a bed of the rest of its mix (wildflowers when nothing else is left), its
 *      new design registered, still open, its next step no gathering of lilies; the census is to be read again;
 *   B. a bed down to wildflowers that finds no wildflowers either ends (failed) after the third answer, not before, and the
 *      open projects drop below the cap;
 *   C. a gathering that is not a bed's mix flower (logs) ends its project after 3 answers too.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/flower_drop.mts [CHECKPOINT_DIR]   (default mc/testcheckpoints/im2_mine)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const cpDir = process.argv[2] ?? 'mc/testcheckpoints/im2_mine';
const villagesFile = path.join(cpDir, 'villages.json');
if (!fs.existsSync(villagesFile)) {
  console.log(`SKIP flower_drop: ${villagesFile} is not here`);
  process.exit(0);
}
process.env.MC_GROW = '0';
process.env.MC_MODEL_RECORD = '0';
process.env.MC_GARDENS = 'on';
process.env.MC_FLOWER_MIX = 'on';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-drop-'));
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
process.env.MCAI_ACTS_LOG = path.join(SCRATCH, 'acts.jsonl');
const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const mute = () => { console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const unmute = () => Object.assign(console, quiet);
let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    quiet.log(`FAIL ${what}`);
  }
};

mute();
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const SW = await import('../../server/src/smallWorks');
unmute();
const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
fs.copyFileSync(villagesFile, path.join(dir, 'villages.json'));
const data = JSON.parse(fs.readFileSync(villagesFile, 'utf8')) as { villages: Any[] };
const base = data.villages.find((x) => x.complete) ?? data.villages[0];
mute();
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
unmute();
w.villages.save = () => {};
const v = w.villages.get(base.name);
ok(SW.FLOWER_MIX, 'MC_FLOWER_MIX is not on');

const bed = SW.smallWorkKind('front_bed')!;
const mixes = [['wildflowers', 'lily_of_the_valley'], ['lily_of_the_valley', 'poppy', 'dandelion'], ['lily_of_the_valley']];
v.initiatives = (v.initiatives ?? []).filter((i: Any) => i.state !== 'open');
const beds = mixes.map((mix, n) => {
  const d = bed.make('birch', mix);
  v.designs[d.name] = d;
  const it = { id: `ichk${n}`, kind: 'front_bed', design: d.name, by: 'Ada', crew: ['Ada'], x: 0, y: 64, z: 0, state: 'open', at: Date.now(), steps: [], gathered: {} };
  v.initiatives.push(it);
  return it;
});
const open = () => v.initiatives.filter((i: Any) => i.state === 'open').length;
ok(open() === 3, `the three beds are not the open projects (${open()})`);
w.flowerCensus.set(v.name, { at: Date.now(), counts: { lily_of_the_valley: 30, wildflowers: 50 } });

// A: the lilies run out
const lily = { material: 'flowers', block: 'lily_of_the_valley', item: 'lily_of_the_valley' };
mute();
for (const it of beds) w.initiativeNoneNear(v, it, lily);
unmute();
const want = ['small_front_bed_birch~wildflowers', 'small_front_bed_birch~poppy-dandelion', 'small_front_bed_birch~wildflowers'];
beds.forEach((it, n) => {
  ok(it.design === want[n], `A ${it.id}: design ${it.design}, not ${want[n]}`);
  ok(!!v.designs[it.design], `A ${it.id}: its new design is not registered`);
  ok(it.state === 'open', `A ${it.id}: ended (${it.state}) instead of going on`);
  const step = w.initiativeStep(v, it, {}, new Set());
  ok(step && step.what === 'gather' && step.block !== 'lily_of_the_valley', `A ${it.id}: next step ${JSON.stringify(step)}`);
});
ok(!w.flowerCensus.has(v.name), 'A: the census was not cleared');
ok(open() === 3, `A: open projects ${open()} (the beds go on)`);

// B: no wildflowers either: the bed ends at the third answer
const wild = { material: 'flowers', block: 'wildflowers' };
const b0 = beds[0];
mute();
w.initiativeNoneNear(v, b0, wild);
w.initiativeNoneNear(v, b0, wild);
unmute();
ok(b0.state === 'open', `B: ended after 2 answers (${b0.state})`);
mute();
w.initiativeNoneNear(v, b0, wild);
unmute();
ok(b0.state === 'failed', `B: still ${b0.state} after 3 answers`);
ok(open() === 2, `B: open projects ${open()}, not 2 (the cap of 3 freed)`);

// C: logs that cannot be found end a project the same way
const c = beds[1];
mute();
for (let i = 0; i < 3; i++) w.initiativeNoneNear(v, c, { material: 'logs', block: 'birch_log' });
unmute();
ok(c.state === 'failed', `C: logs none found 3 times left it ${c.state}`);

// D (F324): after the lilies ran out no new mix holds them, though the census still counts them; and with more kinds
// growing (the widened census) the mixes differ from member to member
w.flowerCensus.set(`${v.name}|144`, { at: Date.now(), counts: { lily_of_the_valley: 24, wildflowers: 24, poppy: 14, dandelion: 12, cornflower: 9, azure_bluet: 8 } });
const mixesNow = Array.from({ length: 12 }, (_, i) => w.flowerMixFor(v, { name: `M${i}` }, 'front_bed') as string[]);
ok(mixesNow.every((m) => !m.includes('lily_of_the_valley')), `D: a new mix holds the used-up lily: ${JSON.stringify(mixesNow.find((m) => m.includes('lily_of_the_valley')))}`);
const distinct = new Set(mixesNow.map((m) => [...m].sort().join('+')));
ok(distinct.size >= 4, `D: only ${distinct.size} different mixes over 12 members`);
ok(new Set(mixesNow.flat()).size >= 4, `D: the mixes use ${new Set(mixesNow.flat()).size} kinds of 5 to be had`);
v.flowersOut.lily_of_the_valley = Date.now() - 2 * 3600000;
const later = Array.from({ length: 12 }, (_, i) => w.flowerMixFor(v, { name: `M${i}` }, 'front_bed') as string[]);
ok(later.some((m) => m.includes('lily_of_the_valley')), 'D: the lily never comes back after its hour out');
quiet.log(`  mixes after the lilies ran out: ${[...distinct].join('; ')}`);
quiet.log(`  ${base.name}: beds ${beds.map((b) => `${b.id} ${b.design} ${b.state}`).join('; ')}`);
quiet.log(`${failures ? 'FAIL' : 'PASS'}: ${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);

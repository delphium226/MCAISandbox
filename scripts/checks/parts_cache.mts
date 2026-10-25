/**
 * #142: lightParts' and decorParts' quick signatures (mcWorld.ts) keep the cached parts right. On a checkpoint loaded into a
 * real MineflayerWorld (no server, seconds), each change the parts read is made in turn and the cached answer compared
 * with one worked out from scratch (caches cleared): a spot lit, a spot marked never, a structure added, a done build
 * task, a sign, a furnished spot, an own chest; and with nothing changed the cached array itself comes back.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/parts_cache.mts [CHECKPOINT_DIR]   (default mc/testcheckpoints/im2_mine)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const cpDir = process.argv[2] ?? 'mc/testcheckpoints/im2_mine';
const villagesFile = path.join(cpDir, 'villages.json');
if (!fs.existsSync(villagesFile)) {
  console.log(`SKIP parts_cache: ${villagesFile} is not here`);
  process.exit(0);
}
process.env.MC_GROW = '0';
process.env.MC_MODEL_RECORD = '0';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'parts-cache-'));
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

/** The parts as JSON, without the object identities. */
const view = (parts: Any[]) => JSON.stringify(parts.map((P) => [P.part, P.unlit ?? null, P.spots.length, (P.open ?? []).length, P.walk ?? null, P.label]));
const cold = () => {
  w.lightCache.clear();
  w.decorCache.clear();
  return { light: view(w.lightParts(v)), decor: view(w.decorParts(v)) };
};
const warm = () => ({ light: view(w.lightParts(v)), decor: view(w.decorParts(v)) });
const same = (what: string) => {
  mute();
  const a = warm(), b = cold();
  unmute();
  ok(a.light === b.light, `${what}: light parts stale`);
  ok(a.decor === b.decor, `${what}: decor parts stale`);
};

mute();
const first = w.lightParts(v), firstDecor = w.decorParts(v);
const again = w.lightParts(v), againDecor = w.decorParts(v);
unmute();
ok(first === again && firstDecor === againDecor, 'unchanged: not the cached arrays');
ok(first.length > 0 && firstDecor.length > 0, `no parts to check (${first.length} light, ${firstDecor.length} decor)`);

// A spot lit, then one marked never
const lp = first.find((P: Any) => P.kind === 'building' && P.spots.length > 1);
if (lp) {
  v.lights ??= {};
  v.lights[lp.part] ??= { done: [] };
  const k = (q: Any) => `${q.x},${q.y},${q.z}`;
  v.lights[lp.part].done.push(k(lp.spots[0]));
  same('a spot lit');
  (v.lights[lp.part].never ??= []).push(k(lp.spots[1]));
  same('a spot marked never');
}
// A furnished spot
const dp = firstDecor.find((P: Any) => P.open.length);
if (dp) {
  v.decor ??= {};
  v.decor[dp.part] ??= { done: [] };
  const q = dp.open[0];
  v.decor[dp.part].done.push(`${q.x},${q.y},${q.z}`);
  same('a spot furnished');
}
// An own chest placed (home basics and the own chest read it)
const owner = v.structures.find((s: Any) => s.owner)?.owner;
if (owner) {
  v.homes ??= {};
  v.homes[owner] = { ...(v.homes[owner] ?? {}), chest: { x: 0, y: 0, z: 0, items: {} } };
  same('an own chest moved');
}
// A sign added to the first layout
if (v.layouts?.[0]) {
  (v.layouts[0].signs ??= []).push({ x: v.structures[0].x1, layer: 1, z: v.structures[0].z1, facing: 'north', text: ['x'] });
  same('a sign added');
}
// A structure removed (the last), then put back; a done build task
const st = v.structures.pop();
same('a structure removed');
v.structures.push(st);
same('the structure back');
const t = v.tasks.find((x: Any) => x.status !== 'done');
if (t) {
  t.status = 'done';
  same('a task done');
}
quiet.log(`  ${base.name}: ${first.length} light parts, ${firstDecor.length} decor parts checked`);
quiet.log(`${failures ? 'FAIL' : 'PASS'}: ${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);

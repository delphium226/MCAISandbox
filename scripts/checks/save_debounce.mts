/**
 * villages.json's debounced, atomic saves checked (E.0; no server), on a scratch folder:
 *   1. 10,000 save() calls in a burst write the file at most twice, and it parses after each write;
 *   2. saves every 50 ms for 3 s are written about once a second (never more than SAVE_MAX_MS late);
 *   3. flushSync() racing a write under way: the file ends with the newest state, never an older snapshot;
 *   4. a child process that saves and exits with flushSync on 'exit' leaves its change on disk;
 *   5. the file held open by another process (Python, as the check scripts do): the rename is retried (or the file
 *      written in place), the change lands and no temporary file is left.
 * Usage: node_modules/.bin/tsx scripts/checks/save_debounce.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { VillageRegistry } = await import('../../server/src/village');

const say = console.log;
let failures = 0;
let checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    say(`FAIL ${what}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-debounce-'));
const file = path.join(dir, 'villages.json');
const read = () => JSON.parse(fs.readFileSync(file, 'utf8')) as { villages: Array<{ name: string; objective: string; log: string[] }> };

// Count the renames into place (each is one write) and check the file parses after each
let writes = 0, bad = 0;
const rename = fs.renameSync;
fs.renameSync = ((a: fs.PathLike, b: fs.PathLike) => {
  rename(a, b);
  if (String(b) === file) {
    writes++;
    try { read(); } catch { bad++; }
  }
}) as typeof fs.renameSync;

const reg = new VillageRegistry(file);
const quiet = console.log;
console.log = () => {};
const v = reg.ensure('Savevale', 'v0');

// --- 1. a burst
await sleep(1200);
writes = 0;
for (let i = 0; i < 10000; i++) {
  v.objective = `burst ${i}`;
  reg.save();
}
await sleep(1500);
ok(writes >= 1 && writes <= 2, `10,000 saves: ${writes} writes (1-2)`);
ok(read().villages[0].objective === 'burst 9999', 'the last change is on disk');
ok(bad === 0, 'the file parsed after every write');

// --- 2. a steady trickle: about one write a second, none later than 1 s after the change
writes = 0;
let latest = '';
let late = 0;
const t0 = Date.now();
while (Date.now() - t0 < 3000) {
  latest = `trickle ${Date.now()}`;
  v.objective = latest;
  reg.save();
  await sleep(50);
  // (from the first trickle write on: the burst's value is on disk until then)
  const onDisk = Number(/^trickle (\d+)$/.exec(read().villages[0].objective)?.[1] ?? 0);
  if (onDisk && Date.now() - onDisk > 1300) late++;
}
await sleep(1200);
ok(writes >= 2 && writes <= 5, `saves every 50 ms for 3 s: ${writes} writes (about one a second)`);
ok(late === 0, `the file was never more than ~1 s behind (${late} late reads)`);
ok(read().villages[0].objective === latest, 'the last change is on disk');

// --- 3. flushSync against a write under way (unique temporary files; the older snapshot never lands last); a big
// village (~4 MB, as the main world's 2.2 MB) so the asynchronous write takes long enough to be caught in flight
let lost = 0, inFlight = 0;
v.log = Array.from({ length: 40 }, (_, i) => `${i} ${'x'.repeat(100000)}`);
reg.save();
await sleep(1500);
for (let k = 0; k < 20; k++) {
  v.objective = `async ${k}`;
  reg.save();
  await sleep(250 + (k % 5) * 2);
  v.objective = `flushed ${k}`;
  // (every change goes through save(); flushSync writes what is marked or under way)
  reg.save();
  if ((reg as unknown as { writing: boolean }).writing) inFlight++;
  reg.flushSync();
  await sleep(300);
  if (read().villages[0].objective !== `flushed ${k}`) lost++;
}
ok(lost === 0, `flushSync racing a write: the newest state stayed on disk 20 times of 20 (${lost} lost; ${inFlight} with a write in flight)`);
ok(inFlight > 0, `a write was in flight at least once (${inFlight})`);
v.log = [];
reg.save();

// --- 4. a child that saves and exits at once: flushSync on 'exit' writes it
{
  const child = path.join(dir, 'child.mts');
  const village = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server/src/village.ts')).href;
  fs.writeFileSync(child, `import { VillageRegistry } from ${JSON.stringify(village)};\nconst r = new VillageRegistry(${JSON.stringify(file)});\nprocess.on('exit', () => r.flushSync());\nconst v = r.ensure('Savevale');\nv.objective = 'from the child';\nr.save();\nprocess.exit(0);\n`);
  const out = spawnSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), child], { encoding: 'utf8' });
  ok(out.status === 0, `the child ran (${out.stderr?.slice(0, 200)})`);
  ok(read().villages.find((x) => x.name === 'Savevale')?.objective === 'from the child', 'its change was flushed at exit');
}

// --- 5. held open by another process: retried, then landed; no temporary file left
{
  const reg2 = new VillageRegistry(file);
  const v2 = reg2.ensure('Savevale');
  await sleep(1200);
  const holder = spawn('python', ['-c', `import time\nf = open(${JSON.stringify(file)}, 'rb')\nprint('open', flush=True)\ntime.sleep(0.6)\nf.close()`]);
  await new Promise<void>((r) => holder.stdout.once('data', () => r()));
  v2.objective = 'while held';
  reg2.save();
  await new Promise((r) => holder.once('exit', r));
  await sleep(1500);
  ok(read().villages[0].objective === 'while held', 'the change landed once the reader let go');
  const left = fs.readdirSync(dir).filter((n) => n.startsWith('villages.json.tmp-'));
  ok(left.length === 0, `no temporary file left (${left.join(', ')})`);
  reg2.flushSync();
}

reg.flushSync();
fs.renameSync = rename;
console.log = quiet;
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);

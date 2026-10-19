/**
 * The task board's claim check against a golden dump (E.0, no server): copies of the main and test worlds' villages.json
 * are loaded into a real MineflayerWorld (no bots, no RCON: refreshNeeds and syncGather run with no agents) on a scratch
 * folder, with the clock frozen; for every village, the tasks claimable() returns and every task's status and result
 * after the call are written (`dump`, on the code before the change) or compared (`check`). On the code with
 * refreshBoard, `check` runs refreshBoard, then claimable(), and then 1,000 more claimable() calls, which must leave the
 * registry's JSON as it was and save nothing.
 * Usage: node_modules/.bin/tsx scripts/checks/board_golden.mts dump|check GOLDEN.json [villages.json ...]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [mode, golden, ...files] = process.argv.slice(2);
if (!/^(dump|check)$/.test(mode ?? '') || !golden) {
  console.log('usage: board_golden.mts dump|check GOLDEN.json [villages.json ...]');
  process.exit(2);
}
const sources = files.length ? files : ['mc/server/villages.json', 'mc/testserver/villages.json'];
const NOW = Date.parse('2026-10-11T12:00:00Z');
Date.now = () => NOW;
// (N.2's housing and the parts chests: on by default since s38, off here: the golden is of the board without them)
process.env.MC_HOUSING ??= 'off';
process.env.MC_PARTS ??= 'off';

const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
type Board = Record<string, { claimable: string[]; tasks: Array<[string, string, string]>; woodFor: unknown; log: string[] }>;
const out: Record<string, Board> = {};
let failures = 0;
const quiet = console.log;
for (const src of sources) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-golden-'));
  fs.copyFileSync(src, path.join(dir, 'villages.json'));
  console.log = () => {};
  const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir);
  console.log = quiet;
  const reg = w.villages as typeof w.villages & { refreshBoard?: (v: unknown) => void };
  let saves = 0;
  const save = reg.save.bind(reg);
  reg.save = () => { saves++; save(); };
  const board: Board = {};
  console.log = () => {};
  for (const v of reg.villages.values()) {
    reg.refreshBoard?.(v);
    const ids = reg.claimable(v).map((t) => t.id);
    board[v.name] = { claimable: ids, tasks: v.tasks.map((t) => [t.id, t.status, t.result ?? '']), woodFor: v.woodFor ?? null, log: v.log.slice(-10) };
  }
  console.log = quiet;
  out[src] = board;
  if (mode === 'check' && reg.refreshBoard) {
    // claimable() is a pure read now
    const before = JSON.stringify([...reg.villages.values()]);
    const s0 = saves;
    for (let i = 0; i < 1000; i++) for (const v of reg.villages.values()) reg.claimable(v);
    const same = JSON.stringify([...reg.villages.values()]) === before;
    if (!same || saves !== s0) {
      failures++;
      console.log(`FAIL ${src}: 1,000 claimable() rounds ${same ? '' : 'changed the registry'}${!same && saves !== s0 ? ' and ' : ''}${saves !== s0 ? `saved ${saves - s0} times` : ''}`);
    } else console.log(`${src}: 1,000 claimable() rounds over ${reg.villages.size} villages left the registry as it was, 0 saves`);
  }
  // (the debounced save writes later: flushed before the folder goes)
  (reg as { flushSync?: () => void }).flushSync?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
if (mode === 'dump') {
  fs.writeFileSync(golden, JSON.stringify(out, null, 1));
  const n = Object.values(out).reduce((s, b) => s + Object.keys(b).length, 0);
  console.log(`golden written: ${n} villages, ${golden}`);
  process.exit(0);
}
const want = JSON.parse(fs.readFileSync(golden, 'utf8')) as Record<string, Board>;
let villages = 0;
for (const [src, board] of Object.entries(want)) {
  for (const [name, b] of Object.entries(board)) {
    villages++;
    const got = out[src]?.[name];
    if (!got) { failures++; console.log(`FAIL ${src} ${name}: missing`); continue; }
    for (const k of ['claimable', 'tasks', 'woodFor', 'log'] as const)
      if (JSON.stringify(got[k]) !== JSON.stringify(b[k])) {
        failures++;
        console.log(`FAIL ${src} ${name} ${k}:\n  got  ${JSON.stringify(got[k]).slice(0, 400)}\n  want ${JSON.stringify(b[k]).slice(0, 400)}`);
      }
  }
}
console.log(`${villages} villages compared, ${failures} failures`);
process.exit(failures ? 1 : 0);

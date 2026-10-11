/**
 * The task board's version counter and the idle pollers (E.0; no server): every write path of the registry moves the
 * version and claimable() does not; an idle scripted worker (TaskBrain) and an idle tiered worker look at the board
 * once while it stands still, again as soon as it changes, and again after CLAIM_LOOK_MS with no change (cooldowns end
 * unsaved); claim() refreshes a board changed since its last refresh. Uses a registry on a scratch file and fake agents.
 * Usage: node_modules/.bin/tsx scripts/checks/board_version.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MC_TOKEN_BUDGET_HOUR = 'off';
const { VillageRegistry, CLAIM_LOOK_MS } = await import('../../server/src/village');
const { TaskBrain } = await import('../../server/src/taskBrain');
const { TieredBrain } = await import('../../server/src/tieredBrain');

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-version-'));
const reg = new VillageRegistry(path.join(dir, 'villages.json'));
const quiet = console.log;
console.log = () => {};
const v = reg.ensure('Testvale', 'test');

// --- every write moves the version; claimable() does not
const moves = (what: string, f: () => void) => {
  const before = reg.version;
  f();
  ok(reg.version > before, `${what} moves the version`);
};
let made: Array<{ id: string }> = [];
moves('post', () => (made = reg.post(v, [{ title: 'Gather 4 logs for the hut', detail: 'collect block=logs count=4, then deposit item=all', soft: true }, { title: 'Build a hut', detail: 'build_design "hut" x=1 z=1', after: [0] }, { title: 'Gather 8 sand for the windows', detail: 'collect block=sand count=8, then deposit item=all', soft: true }], 'code', 20)));
const [g, b, s] = made.map((t) => t.id);
const v0 = reg.version;
for (let i = 0; i < 100; i++) reg.claimable(v, 'W1');
ok(reg.version === v0, 'claimable() leaves the version alone');
moves('claim', () => reg.claim(v, g, 'W1'));
moves('unclaim', () => reg.unclaim(v, g, 'W1', 'test'));
reg.claim(v, g, 'W1');
moves('finish', () => reg.finish(v, g, 'W1', 'done'));
reg.claim(v, s, 'W2');
moves('handBackTaken', () => reg.handBackTaken(v, s, 'W2', 'taken', 'sand'));
moves('note', () => reg.note(v, 'a note'));
let r: { id: string } | null = null;
moves('reserve', () => (r = reg.reserve(v, { x1: 0, z1: 0, x2: 4, z2: 4 }, 'W1', 'test')));
moves('release', () => reg.release(v, r!.id));
moves('save (storage, needs, the API)', () => reg.save());
moves('cancelOpen', () => reg.cancelOpen(v, 'test over'));

// --- claim() refreshes a changed board first (refreshNeeds is run by refreshBoard)
{
  let refreshed = 0;
  reg.refreshNeeds = () => void refreshed++;
  const [t1] = reg.post(v, [{ title: 'Gather 2 logs', detail: 'collect block=logs count=2, then deposit item=all', soft: true }], 'code');
  reg.claim(v, t1.id, 'W3');
  ok(refreshed === 1, `claim() refreshed the changed board (${refreshed})`);
  reg.refreshBoard(v);
  const n = refreshed;
  reg.tickBoard(v);
  ok(refreshed === n, 'tickBoard: nothing changed, no refresh');
  reg.save();
  reg.tickBoard(v);
  ok(refreshed === n + 1, 'tickBoard: refreshed after a change');
  reg.refreshNeeds = undefined;
}

// --- the idle pollers: count claimable() calls
let calls = 0;
const claimable = reg.claimable.bind(reg);
reg.claimable = (...a: Parameters<typeof claimable>) => { calls++; return claimable(...a); };
let now = Date.now();
const realNow = Date.now;
Date.now = () => now;
const world = {
  kind: 'sandbox' as const, villages: reg, ticks: 0, skills: [{ name: 'collect', input_schema: {} }, { name: 'deposit', input_schema: {} }, { name: 'build_design', input_schema: {} }],
  isAgent: () => true, agentList: () => [], isPlaceable: () => true,
};
const fakeAgent = (name: string) => ({
  name, role: 'worker', gamemode: 'survival', world, memory: { village: 'Testvale' } as Record<string, unknown>, events: [],
  observe: () => ({ position: { x: 0, y: 64, z: 0 }, nearbyBlocks: {}, nearbyEntities: [], inventory: {} }),
  enqueue: () => { throw new Error('no actions in this check'); }, stop() {}, idle: () => true, pushEvent() {}, village: () => v,
});
for (const [label, brain] of [['TaskBrain', new TaskBrain()], ['TieredBrain', new TieredBrain()]] as const) {
  const a = fakeAgent(`Idle${label}`) as never;
  calls = 0;
  for (let i = 0; i < 40; i++) brain.tick!(a);
  ok(calls === 1, `${label}: 40 idle ticks on a board standing still look once (${calls})`);
  reg.save();
  brain.tick!(a);
  ok(calls === 2, `${label}: looks again at once after a change (${calls})`);
  for (let i = 0; i < 10; i++) brain.tick!(a);
  ok(calls === 2, `${label}: then not again (${calls})`);
  now += CLAIM_LOOK_MS;
  brain.tick!(a);
  ok(calls === 3, `${label}: and again after ${CLAIM_LOOK_MS} ms with no change (${calls})`);
}
// The mayor's runner: the gate opening (mayClaim turning true) is a reason to look
{
  const brain = new TaskBrain();
  const a = fakeAgent('Gate') as never;
  calls = 0;
  brain.tick(a, false);
  brain.tick(a, true);
  brain.tick(a, true);
  ok(calls === 1, `TaskBrain: looks when it may claim again, once (${calls})`);
}
Date.now = realNow;
reg.flushSync();
console.log = quiet;
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);

// #234 (train 24, F359): the hunt's summary. An ok hunt read "0 kills" when its kills came before a resume (Clara's third
// A1 hunt: 3 kills logged; Dev's A2 hunt deposited 10 bones), and a resume called off after meeting prey said "hurt on the
// way out". The kills and the meeting are kept in the action's memo, which a resume keeps. Fails on the code before it.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/fixes_234.mts
import { Vec3 } from 'vec3';

process.env.MC_WORLD_MODE ??= 'hostile';
const C = await import('../../server/src/mineflayer/mcCombat');
let fails = 0;
const ok = (cond: unknown, what: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) fails++;
};
const sec = async (name: string, f: () => Promise<void> | void) => {
  try { await f(); } catch (e) { ok(false, `${name}: ${(e as Error).message}`); }
};

const chest = { x: 10, y: 64, z: 10 };
const v = { name: 'P1', storage: { chests: [chest] } };
const fake = (health: number, timeOfDay: number) => ({
  name: 'Clara',
  village: () => v,
  world: { agents: new Map() },
  bot: { on: () => undefined, removeListener: () => undefined, health, food: 20, time: { timeOfDay }, inventory: { items: () => [{ name: 'iron_sword', count: 1 }] }, entity: { position: new Vec3(10.5, 64, 11.5) }, entities: {} },
}) as never;
const box = { x1: 0, z1: 0, x2: 20, z2: 20 };
const signal = new AbortController().signal;

await sec('the summary', async () => {
  ok(C.killWords(C.huntKills({ 'kill:skeleton': 2, 'kill:spider': 1, met: 1 })) === '3 kills (skeleton 2, spider 1)', 'the memo\'s kills in words');
  // (a resumed hunt that ends at dawn at once: its kills all came before the resume)
  const run = { resumes: 1, firstStartedAt: Date.now() - 60000, memo: { met: 1, 'kill:skeleton': 3 } as Record<string, number> };
  let out = '';
  try { out = await C.huntEdge(fake(20, 1000), [], box, () => null, signal, 32, run); } catch (e) { out = `error ${(e as Error).message}`; }
  ok(/: 3 kills \(skeleton 3\)/.test(out), `a resumed hunt counts the kills before the resume (${out})`);
});

await sec('the call-off', async () => {
  const run = { resumes: 2, firstStartedAt: Date.now() - 120000, memo: { met: 1, 'kill:spider': 1 } as Record<string, number> };
  let out = '';
  try { out = await C.huntEdge(fake(7, 15000), [], box, () => null, signal, 32, run); } catch (e) { out = `error ${(e as Error).message}`; }
  ok(/health 7, hurt in the hunt after 1 kill \(spider 1\)/.test(out), `after meeting prey: "hurt in the hunt", with its kill (${out})`);
  const run2 = { resumes: 1, firstStartedAt: Date.now() - 60000 };
  try { out = await C.huntEdge(fake(7, 15000), [], box, () => null, signal, 32, run2); } catch (e) { out = `error ${(e as Error).message}`; }
  ok(/health 7, hurt on the way out \(/.test(out), `before meeting prey: "hurt on the way out" (${out})`);
});

console.log(fails ? `FAIL ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);

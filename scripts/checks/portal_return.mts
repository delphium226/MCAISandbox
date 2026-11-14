// The Nether rung's way back, by itself (nether1-3, 11-14: members went home through the far portal and were back in the
// Nether at once). Joins as NAME, goes through the portal whose frame's lower corner is X Y Z (axis
// x, lit), steps off at the far side, walks to the far portal's front, steps in and logs every respawn and position
// packet for 15 s. Test worlds only.
// Usage: MC_SERVER_DIR=mc/testserver2 node node_modules/tsx/dist/cli.mjs scripts/checks/portal_return.mts NAME PORT X Y Z TIMESCALE
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const [name = 'Gus', port = '25567', X0 = '-1641', Y0 = '64', Z0 = '3', TS = '3'] = process.argv.slice(2);
const X = Number(X0), Y = Number(Y0), Z = Number(Z0);
const rcon = (...c: string[]) => execFileSync('python', ['mc/rcon.py', ...c], { encoding: 'utf8' }).trim();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const t0 = Date.now();
const log = (s: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} ${s}`);
const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(port), username: name, version: '26.1', auth: 'offline', timeScale: Number(TS) });
bot.loadPlugin(pathfinder);
const dim = () => String(bot.game?.dimension ?? '?');
const pos = () => (bot.entity ? `${bot.entity.position.x.toFixed(1)},${bot.entity.position.y.toFixed(1)},${bot.entity.position.z.toFixed(1)}` : '?');
bot._client.on('respawn', (p: any) => log(`packet respawn ${JSON.stringify(p.worldState ?? p).slice(0, 200)}`));
bot._client.on('position', (p: any) => log(`packet position ${JSON.stringify(p).slice(0, 160)}`));
bot._client.on('login', (p: any) => log(`packet login dim ${JSON.stringify(p.worldState ?? {}).slice(0, 120)}`));
bot.on('respawn', () => setImmediate(() => log(`event respawn: dimension ${dim()} at ${pos()}`)));

async function stepIn(cell: any, exit?: any) {
  const d0 = dim();
  const inPortal = () => bot.blockAt(bot.entity.position.floored())?.name === 'nether_portal';
  const stop = () => { if (inPortal()) bot.clearControlStates(); };
  await bot.lookAt(cell.offset(0.5, 0.5, 0.5), true);
  bot.on('physicsTick', stop);
  bot.setControlState('forward', true);
  for (let t = 0; t < 60 && !inPortal() && dim() === d0; t++) await sleep(50);
  bot.clearControlStates();
  bot.off('physicsTick', stop);
  log(`in the portal: ${inPortal()} at ${pos()}`);
  for (let i = 0; i < 150 && dim() === d0; i++) await sleep(100);
  log(`dimension now ${dim()} at ${pos()}`);
  if (exit) {
    await bot.lookAt(new Vec3(exit.x + 0.5, exit.y + 1.6, exit.z + 0.5), true);
    bot.setControlState('forward', true);
    for (let t = 0; t < 40; t++) { if (Math.hypot(bot.entity.position.x - exit.x - 0.5, bot.entity.position.z - exit.z - 0.5) < 0.45) break; await sleep(50); }
    bot.clearControlStates();
    log(`stepped toward ${exit.x},${exit.y},${exit.z}: at ${pos()}`);
  }
}

bot.once('spawn', async () => {
  rcon(`execute in minecraft:overworld run tp ${name} ${X + 1.5} ${Y + 1} ${Z - 0.5}`, `gamemode survival ${name}`);
  await sleep(3000);
  await bot.waitForChunksToLoad();
  log(`start: ${dim()} at ${pos()}`);
  const m = new Movements(bot);
  for (const n of ['nether_portal', 'lava', 'fire', 'soul_fire']) m.blocksToAvoid.add(bot.registry.blocksByName[n].id);
  bot.pathfinder.setMovements(m);
  await stepIn(new Vec3(X + 1, Y + 1, Z));
  await sleep(2000);
  await bot.waitForChunksToLoad();
  const cells = bot.findBlocks({ matching: bot.registry.blocksByName.nether_portal.id, maxDistance: 6, count: 12 }).sort((a: any, b: any) => a.y - b.y);
  log(`far portal cells: ${cells.map((c: any) => `${c.x},${c.y},${c.z}`).join(' ')}`);
  // walk a few blocks off, then back to a front cell and in
  const c0 = cells[0];
  const fronts = [c0.offset(0, 0, -1), c0.offset(0, 0, 1), c0.offset(-1, 0, 0), c0.offset(1, 0, 0)].filter((f: any) => bot.blockAt(f)?.name === 'air' && bot.blockAt(f.offset(0, -1, 0))?.boundingBox === 'block');
  log(`fronts ${fronts.map((f: any) => `${f.x},${f.y},${f.z}`).join(' ')}`);
  for (const dz of [-1, 1]) for (const dy of [-2, -1, 0, 1]) log(`  z${dz > 0 ? '+' : '-'}1 y${dy}: ${[-1, 0, 1, 2].map((dx) => bot.blockAt(c0.offset(dx, dy, dz))?.name).join(' ')}`);
  if (!fronts.length) fronts.push(...[c0.offset(0, 0, -1), c0.offset(0, 0, 1)].filter((f: any) => bot.blockAt(f)?.name === 'air'));
  bot.pathfinder.setGoal(new goals.GoalBlock(fronts[0].x, fronts[0].y, fronts[0].z));
  await sleep(4000);
  bot.pathfinder.setGoal(null);
  log(`at the front: ${pos()}`);
  await stepIn(c0, { x: X + 1, y: Y + 1, z: Z - 1 });
  for (let i = 0; i < 15; i++) { await sleep(1000); log(`... ${dim()} at ${pos()}`); }
  rcon(`tp ${name} ${X + 1.5} ${Y + 1} ${Z - 2.5}`);
  await sleep(1500);
  bot.quit();
  setTimeout(() => process.exit(0), 1000);
});

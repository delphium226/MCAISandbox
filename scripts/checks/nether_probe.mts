// The Nether probe (docs/specs/nether.md section 4, N0): do Mineflayer bots on Paper 26.1 survive a dimension change?
// Joins as NAME (a plain player with the agent server's shared world, as botAgent.ts creates its bots), builds and
// lights a portal at X Z (a real flint and steel use), walks in, reads, walks and digs in the Nether, walks back out,
// goes back by command, reconnects there, is recalled by a console tp, and reads the spec's questions 1-7 (question 8,
// an agent-server log-in in the Nether, is asked by spawning NAME through the agent server afterwards).
// Test worlds only. Usage:
//   MC_SERVER_DIR=mc/testserver2 node node_modules/tsx/dist/cli.mjs scripts/checks/nether_probe.mts [NAME] [PORT] [X] [Z] [TIMESCALE]
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

const [name = 'Gus', port = '25567', X0 = '-1540', Z0 = '-36', TS = '2'] = process.argv.slice(2);
const X = Number(X0), Z = Number(Z0);
const rcon = (...cmds: string[]) => execFileSync('python', ['mc/rcon.py', ...cmds], { encoding: 'utf8' }).trim();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const until = async (f: () => boolean, ms: number) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) if (f()) return true; return f(); };
const answers: string[] = [];
const say = (s: string) => { console.log(s); answers.push(s); };
const at = (p: { x: number; y: number; z: number }) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;

// Event-loop lag: the largest drift of a 100 ms timer, per phase
let lagMax = 0;
let last = Date.now();
setInterval(() => { const now = Date.now(); lagMax = Math.max(lagMax, now - last - 100); last = now; }, 100);

function connect(): Promise<any> {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(port), username: name, version: '26.1', auth: 'offline', timeScale: Number(TS) });
  bot.loadPlugin(pathfinder);
  bot.on('kicked', (r: unknown) => console.log('kicked', JSON.stringify(r)));
  bot.on('error', (e: Error) => console.log('error', e.message));
  bot.on('respawn', () => console.log(`  (respawn: dimension ${bot.game?.dimension}, at ${bot.entity ? at(bot.entity.position) : '?'})`));
  return new Promise((ok) => bot.once('spawn', () => ok(bot)));
}

function moves(bot: any, dig = true) {
  const m = new Movements(bot);
  m.canDig = dig;
  m.allowParkour = false;
  m.allow1by1towers = false;
  m.scafoldingBlocks = [];
  for (const n of ['nether_portal', 'lava', 'fire', 'soul_fire']) { const b = bot.registry.blocksByName[n]; if (b) m.blocksToAvoid.add(b.id); }
  bot.pathfinder.setMovements(m);
}

async function walkTo(bot: any, goal: any, ms: number) {
  bot.pathfinder.setGoal(goal);
  const ok = await until(() => goal.isEnd(bot.entity.position.floored()), ms);
  bot.pathfinder.setGoal(null);
  return ok;
}

const dimOf = (bot: any) => String(bot.game?.dimension ?? '?').replace('minecraft:', '');

/** Step into the nearest portal cell from where the bot stands; wait for the dimension to change. */
async function stepIn(bot: any, cell: any, ms = 20000) {
  const d0 = dimOf(bot);
  bot.pathfinder.setGoal(null);
  await bot.lookAt(cell.offset(0.5, 0.5, 0.5), true);
  // (forward until the feet are in a portal cell, read each physics tick: a portal is one block thick, and an arrival
  // platform over the lava sea ends a block beyond it)
  const inPortal = () => bot.blockAt(bot.entity.position.floored())?.name === 'nether_portal';
  const stop = () => { if (inPortal()) bot.clearControlStates(); };
  bot.on('physicsTick', stop);
  bot.setControlState('forward', true);
  const t0 = Date.now();
  await until(() => inPortal() || dimOf(bot) !== d0, 3000);
  bot.clearControlStates();
  bot.off('physicsTick', stop);
  const changed = await until(() => dimOf(bot) !== d0, ms);
  return { changed, secs: (Date.now() - t0) / 1000 };
}

function walkable(bot: any, origin: any, r: number, dy: number) {
  const out: any[] = [];
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) for (let y = -dy; y <= dy; y++) {
    const p = origin.offset(x, y, z);
    const below = bot.blockAt(p.offset(0, -1, 0)), feet = bot.blockAt(p), head = bot.blockAt(p.offset(0, 1, 0));
    if (!below || !feet || !head) continue;
    if (below.boundingBox === 'block' && !/lava|magma|fire/.test(below.name) && feet.name === 'air' && head.name === 'air') out.push(p);
  }
  return out;
}

async function main() {
  let bot = await connect();
  say(`login: dimension ${dimOf(bot)} at ${at(bot.entity.position)}`);
  // A clean start in the overworld at the site
  rcon(`execute in minecraft:overworld run tp ${name} ${X} 200 ${Z}`, `gamemode survival ${name}`, `clear ${name}`, `effect clear ${name}`);
  await until(() => dimOf(bot) === 'overworld', 8000);
  rcon(`spreadplayers ${X + 0.5} ${Z + 0.5} 0 1 false ${name}`);
  await sleep(1500);
  await bot.waitForChunksToLoad();
  const g = bot.entity.position.floored();
  const y0 = g.y - 1;
  // The frame along x at z = Z+3: obsidian x X..X+3, y y0..y0+4; inner X+1..X+2, y0+1..y0+3. A stone pad round it, air above.
  const Zp = Z + 3;
  rcon(`fill ${X - 3} ${y0} ${Z - 3} ${X + 6} ${y0} ${Zp + 3} minecraft:stone`, `fill ${X - 3} ${y0 + 1} ${Z - 3} ${X + 6} ${y0 + 6} ${Zp + 3} minecraft:air`,
    `fill ${X} ${y0} ${Zp} ${X + 3} ${y0 + 4} ${Zp} minecraft:obsidian`, `fill ${X + 1} ${y0 + 1} ${Zp} ${X + 2} ${y0 + 3} ${Zp} minecraft:air`,
    `tp ${name} ${X + 1.5} ${y0 + 1} ${Z + 0.5}`, `give ${name} minecraft:flint_and_steel`, `give ${name} minecraft:netherrack 16`);
  await sleep(1500);
  moves(bot);
  // Light it: a real use of the flint and steel on the frame's inner floor (the obsidian under the first inner cell)
  const fs = bot.inventory.items().find((i: any) => i.name === 'flint_and_steel');
  await bot.equip(fs, 'hand');
  const stand = new Vec3(X + 1, y0 + 1, Zp - 1);
  await walkTo(bot, new goals.GoalBlock(stand.x, stand.y, stand.z), 10000);
  const floor = bot.blockAt(new Vec3(X + 1, y0, Zp));
  let lit = false;
  try { await bot.activateBlock(floor, new Vec3(0, 1, 0)); } catch (e) { console.log('  activateBlock:', (e as Error).message); }
  await sleep(1000);
  lit = /passed/i.test(rcon(`execute if block ${X + 1} ${y0 + 1} ${Zp} minecraft:nether_portal`));
  const allSix = [[1, 1], [2, 1], [1, 2], [2, 2], [1, 3], [2, 3]].every(([dx, dy]) => /passed/i.test(rcon(`execute if block ${X + dx} ${y0 + dy} ${Zp} minecraft:nether_portal`)));
  say(`Q1a light: a real flint-and-steel use lights the frame: ${lit} (all six inner cells portal: ${allSix})`);
  if (!lit) {
    rcon(`fill ${X + 1} ${y0 + 1} ${Zp} ${X + 2} ${y0 + 3} ${Zp} minecraft:nether_portal[axis=x]`);
    say('  (lit by command instead)');
  }
  // Walk in
  lagMax = 0;
  const s0 = 0;
  const into = await stepIn(bot, new Vec3(X + 1, y0 + 1, Zp));
  say(`Q1b enter: dimension changed: ${into.changed} after ${into.secs.toFixed(1)} s -> ${dimOf(bot)} at ${at(bot.entity.position)}`);
  if (!into.changed) { say('STOP: the bot did not pass through the portal'); return finish(bot); }
  await sleep(2000);
  const t0 = Date.now();
  await bot.waitForChunksToLoad();
  say(`Q1c chunks: waitForChunksToLoad returned in ${((Date.now() - t0) / 1000).toFixed(1)} s; columns ${Object.keys((bot.world as any).async?.columns ?? {}).length}`);
  const here = bot.entity.position.floored();
  const under = bot.blockAt(here.offset(0, -1, 0));
  const serverSays = rcon(`execute in minecraft:the_nether if block ${here.x} ${here.y - 1} ${here.z} minecraft:${under?.name ?? 'air'}`);
  say(`Q1d blockAt: under the bot ${under?.name} (server: ${/passed/i.test(serverSays) ? 'agrees' : 'DISAGREES: ' + serverSays})`);
  // The arrival portal
  const portals = bot.findBlocks({ matching: bot.registry.blocksByName.nether_portal.id, maxDistance: 8, count: 12 });
  const far = portals[0];
  say(`Q4a arrival: far portal cells ${portals.length} near ${far ? at(far) : 'none'}; bot at ${at(here)}`);
  const ground = walkable(bot, here, 32, 12);
  const floatPad = [-1, 0, 1].every((dx) => bot.blockAt(here.offset(dx, -1, 0))?.name === 'obsidian');
  say(`Q4b ground: ${ground.length} walkable cells within 32 across, 12 up/down (obsidian under the arrival: ${floatPad})`);
  // Walk somewhere 8-16 blocks off
  const flat = (p: any) => Math.hypot(p.x - here.x, p.z - here.z);
  const rings = [0, 4, 8, 16, 24, 32].map((r, i, a) => i ? ground.filter((p: any) => flat(p) > a[i - 1] && flat(p) <= r).length : 0).slice(1);
  say(`Q4c ground by distance (0-4, 4-8, 8-16, 16-24, 24-32): ${rings.join(', ')}; lava cells within 16 at y-1: ${
    bot.findBlocks({ matching: bot.registry.blocksByName.lava.id, maxDistance: 16, count: 2000 }).filter((p: any) => p.y === here.y - 1).length}`);
  const target = ground.filter((p: any) => flat(p) >= 6 && flat(p) <= 24).sort((a: any, b: any) => flat(a) - flat(b))[0];
  if (target) {
    const ok = await walkTo(bot, new goals.GoalNear(target.x, target.y, target.z, 1), 40000);
    say(`Q1e walk: the pathfinder walked to ${at(target)}: ${ok} (at ${at(bot.entity.position)})`);
  } else say('Q1e walk: no walkable target 8-16 blocks off');
  // Dig a netherrack block beside the bot
  const soft = ['netherrack', 'crimson_nylium', 'warped_nylium', 'soul_soil', 'soul_sand', 'blackstone', 'basalt'].map((n) => bot.registry.blocksByName[n].id);
  const rack = bot.findBlocks({ matching: soft, maxDistance: 4, count: 40 })
    .map((p: any) => bot.blockAt(p)).find((b: any) => b && !b.position.equals(bot.entity.position.floored().offset(0, -1, 0)) && b.position.y >= bot.entity.position.y - 1 && bot.canDigBlock(b));
  if (rack) {
    const p = rack.position;
    const drop = /nylium/.test(rack.name) ? 'netherrack' : rack.name;
    const n0 = Number(rcon(`clear ${name} minecraft:${drop} 0`).match(/(\d+)/)?.[1] ?? 0);
    try { await bot.dig(rack); } catch (e) { console.log('  dig:', (e as Error).message); }
    await sleep(1500);
    const gone = /passed/i.test(rcon(`execute in minecraft:the_nether if block ${p.x} ${p.y} ${p.z} minecraft:air`));
    const n1 = Number(rcon(`clear ${name} minecraft:${drop} 0`).match(/(\d+)/)?.[1] ?? 0);
    say(`Q1f dig: ${rack.name} at ${at(p)} dug: ${gone}; the server's ${drop} count ${n0} -> ${n1}; bot.blockAt now ${bot.blockAt(p)?.name}`);
  } else say('Q1f dig: no netherrack in reach');
  // Q2: the console's commands in the Nether
  const hp = bot.entity.position.floored();
  const set = rcon(`execute in minecraft:the_nether run setblock ${hp.x + 2} ${hp.y + 3} ${hp.z} minecraft:glowstone`);
  await sleep(500);
  say(`Q2a execute in: setblock "${set}"; bot sees ${bot.blockAt(hp.offset(2, 3, 0))?.name}; if block ${rcon(`execute in minecraft:the_nether if block ${hp.x + 2} ${hp.y + 3} ${hp.z} minecraft:glowstone`)}`);
  rcon(`execute in minecraft:the_nether run setblock ${hp.x + 2} ${hp.y + 3} ${hp.z} minecraft:air`);
  const tpIn = rcon(`execute in minecraft:the_nether run tp ${name} ${hp.x + 0.5} ${hp.y} ${hp.z + 0.5}`);
  say(`Q2b execute in tp (in the Nether): "${tpIn}"`);
  // Q3: a piglin on peaceful
  rcon(`execute in minecraft:the_nether run summon minecraft:piglin ${hp.x + 3} ${hp.y} ${hp.z}`);
  await sleep(1000);
  const pig = rcon(`execute in minecraft:the_nether if entity @e[type=minecraft:piglin,x=${hp.x},y=${hp.y},z=${hp.z},distance=..10]`);
  say(`Q3a piglin: a summoned piglin after 1 s: ${pig}`);
  // Q5: ancient debris in the chunk data at y 8-22 within 48
  const debris = bot.findBlocks({ matching: bot.registry.blocksByName.ancient_debris.id, maxDistance: 48, count: 500, useExtraInfo: (b: any) => b.position.y >= 8 && b.position.y <= 22 });
  const d0 = debris[0];
  const debrisOk = d0 ? rcon(`execute in minecraft:the_nether if block ${d0.x} ${d0.y} ${d0.z} minecraft:ancient_debris`) : 'none';
  say(`Q5 debris: ${debris.length} ancient debris in the bot's chunk data at y 8-22 within 48; the nearest ${d0 ? at(d0) : '-'} (server: ${debrisOk})`);
  // Q6: locate
  const loc = (what: string, dim: string, p: any) => rcon(`execute in minecraft:${dim} positioned ${p.x} ${p.y} ${p.z} run locate structure minecraft:${what}`);
  say(`Q6a fortress: ${loc('fortress', 'the_nether', hp)}`);
  say(`Q6b bastion: ${loc('bastion_remnant', 'the_nether', hp)}`);
  say(`Q7 a trip's cost: columns ${Object.keys((bot.world as any).async?.columns ?? {}).length - s0}, largest event-loop drift ${lagMax} ms`);
  // Back: walk to the far portal's front and step in
  const farCell = bot.findBlocks({ matching: bot.registry.blocksByName.nether_portal.id, maxDistance: 32, count: 12 })
    .sort((a: any, b: any) => a.y - b.y)[0];
  let back = { changed: false, secs: 0 };
  if (farCell) {
    const axisX = bot.blockAt(farCell.offset(1, 0, 0))?.name === 'nether_portal' || bot.blockAt(farCell.offset(-1, 0, 0))?.name === 'nether_portal';
    const fronts = axisX ? [farCell.offset(0, 0, -1), farCell.offset(0, 0, 1)] : [farCell.offset(-1, 0, 0), farCell.offset(1, 0, 0)];
    const front = fronts.find((f: any) => bot.blockAt(f)?.name === 'air' && bot.blockAt(f.offset(0, -1, 0))?.boundingBox === 'block') ?? fronts[0];
    const ok = await walkTo(bot, new goals.GoalBlock(front.x, front.y, front.z), 30000);
    console.log(`  (at the far portal's front ${at(front)}: ${ok})`);
    back = await stepIn(bot, farCell);
  }
  say(`Q1g return: through the far portal: ${back.changed} after ${back.secs.toFixed(1)} s -> ${dimOf(bot)} at ${at(bot.entity.position)}`);
  if (back.changed) {
    await sleep(1500);
    await bot.waitForChunksToLoad();
    const p = bot.entity.position.floored();
    const ow = bot.blockAt(p.offset(0, -1, 0));
    const ok = await walkTo(bot, new goals.GoalNear(X - 2, y0 + 1, Z - 2, 1), 20000);
    say(`Q1h after: overworld blockAt ${ow?.name} under the bot; a walk plans and arrives: ${ok}`);
  }
  // Q8 (the bot's half): reconnect while in the Nether
  rcon(`execute in minecraft:the_nether run tp ${name} ${hp.x + 0.5} ${hp.y} ${hp.z + 0.5}`);
  await until(() => dimOf(bot) === 'the_nether', 8000);
  await sleep(1500);
  bot.quit();
  await sleep(3000);
  bot = await connect();
  await sleep(1500);
  await bot.waitForChunksToLoad();
  const lp = bot.entity.position.floored();
  say(`Q8a reconnect: logs in in ${dimOf(bot)} at ${at(lp)}; blockAt under ${bot.blockAt(lp.offset(0, -1, 0))?.name}`);
  // The recall: a console tp moves a Nether player to the overworld
  rcon(`tp ${name} ${X - 1.5} ${y0 + 1} ${Z - 1.5}`);
  const rec = await until(() => dimOf(bot) === 'overworld', 8000);
  await sleep(1500);
  await bot.waitForChunksToLoad();
  say(`Q2c recall: a console tp from the Nether lands in the overworld: ${rec} (at ${at(bot.entity.position)}, under ${bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))?.name})`);
  // Q6 from the site
  const site = { x: X, y: y0, z: Z };
  say(`Q6c stronghold: ${loc('stronghold', 'overworld', site)}`);
  say(`Q6d ruined portal: ${loc('ruined_portal', 'overworld', site)}`);
  // (question 8's second half, an agent-server log-in in the Nether: leave NAME there by hand and spawn it through the API)
  return finish(bot);
}

function finish(bot: any) {
  console.log('\nANSWERS');
  for (const a of answers) console.log(a);
  bot.quit();
  setTimeout(() => process.exit(0), 1500);
}

main().catch((e) => { console.log('probe error', e); process.exit(1); });

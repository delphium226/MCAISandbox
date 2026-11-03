// #214's check: a bot teleported far off while the pathfinder digs must not stay "mining" for good. Joins as NAME (a plain
// player, not an agent), builds a stone platform with a wall across it at X Z (y 150, in the air), sets a goal behind the
// wall so the pathfinder digs, teleports the bot 3000 blocks away once it is mining, then checks the dig ended (the
// patched mineflayer aborts a dig whose chunk is no longer loaded) and that a new goal walks again.
// Before the fix the dig's chunk was unloaded when it finished, no blockUpdate came, and isMining() stayed true (Finn,
// train 19 I0: busy every tick, moved 0, for 20 min).
// Usage: MC_SERVER_DIR=mc/testserver node scripts/checks/dig_teleport.cjs [NAME] [PORT] [X] [Z]
const { execFileSync } = require('child_process');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const [name = 'Gus', port = '25566', X0 = '-2400', Z0 = '700'] = process.argv.slice(2);
const X = Number(X0), Z = Number(Z0), Y = 150;
const rcon = (...cmds) => execFileSync('python', ['mc/rcon.py', ...cmds], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const until = async (f, ms) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) if (f()) return true; return f(); };

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };

const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(port), username: name, version: '26.1', auth: 'offline' });
bot.loadPlugin(pathfinder);
bot.on('kicked', (r) => console.log('kicked', JSON.stringify(r)));
bot.on('error', (e) => console.log('error', e.message));
const aborted = [];
bot.on('diggingAborted', (b) => aborted.push(b?.position?.toString()));

bot.once('spawn', async () => {
  try {
    rcon(`gamemode survival ${name}`, `clear ${name}`, `effect clear ${name}`, `tp ${name} ${X + 0.5} ${Y + 1} ${Z + 0.5}`);
    await sleep(1500);
    await bot.waitForChunksToLoad();
    // (a platform, open above; a stone wall two high across it at X+2)
    rcon(`fill ${X - 3} ${Y} ${Z - 3} ${X + 8} ${Y} ${Z + 3} minecraft:stone`, `fill ${X - 3} ${Y + 1} ${Z - 3} ${X + 8} ${Y + 4} ${Z + 3} minecraft:air`,
      `fill ${X + 2} ${Y + 1} ${Z - 3} ${X + 2} ${Y + 2} ${Z + 3} minecraft:stone`, `tp ${name} ${X + 0.5} ${Y + 1} ${Z + 0.5}`);
    await sleep(1500);
    const m = new Movements(bot);
    m.canDig = true;
    m.allow1by1towers = false;
    m.scafoldingBlocks = [];
    m.allowParkour = false;
    bot.pathfinder.setMovements(m);
    bot.pathfinder.setGoal(new goals.GoalBlock(X + 5, Y + 1, Z));
    const mining = await until(() => bot.pathfinder.isMining() && !!bot.targetDigBlock, 20000);
    check(mining, `the pathfinder digs through the wall (at ${bot.entity.position.floored()}, digging ${bot.targetDigBlock?.position})`);
    if (!mining) return;
    const dug = bot.targetDigBlock.position.clone();
    await sleep(500);
    rcon(`tp ${name} ${X + 3000.5} ${Y + 1} ${Z + 0.5}`);
    // (stone by hand is 7.5 s: the dig finishes while its chunk is unloaded)
    const cleared = await until(() => !bot.pathfinder.isMining(), 15000);
    check(!bot.world.getColumnAt(dug), `the dug block's chunk is unloaded after the teleport (${dug})`);
    check(cleared, `the pathfinder is not mining 15 s after the teleport (isMining ${bot.pathfinder.isMining()}, aborted ${aborted.join(' ') || 'none'})`);
    // (a new goal plans and walks: the walk a rescue gives after its teleport)
    await sleep(2000);
    await bot.waitForChunksToLoad();
    const p0 = bot.entity.position.clone();
    rcon(`fill ${X + 2997} ${Y} ${Z - 3} ${X + 3008} ${Y} ${Z + 3} minecraft:stone`, `fill ${X + 2997} ${Y + 1} ${Z - 3} ${X + 3008} ${Y + 4} ${Z + 3} minecraft:air`, `tp ${name} ${X + 3000.5} ${Y + 1} ${Z + 0.5}`);
    await sleep(1500);
    const start = bot.entity.position.clone();
    bot.pathfinder.setGoal(new goals.GoalBlock(X + 3006, Y + 1, Z));
    const walked = await until(() => bot.entity.position.distanceTo(start) > 3, 15000);
    check(walked, `a new goal walks (from ${start.floored()} to ${bot.entity.position.floored()}; before the platform ${p0.floored()})`);
  } catch (e) {
    check(false, `error: ${e.message}`);
  } finally {
    bot.pathfinder.setGoal(null);
    try { rcon(`fill ${X - 3} ${Y} ${Z - 3} ${X + 8} ${Y + 4} ${Z + 3} minecraft:air`, `fill ${X + 2997} ${Y} ${Z - 3} ${X + 3008} ${Y + 4} ${Z + 3} minecraft:air`); } catch { /* the platforms stay */ }
    console.log(failed ? `dig_teleport: ${failed} FAILED` : 'dig_teleport: all checks passed');
    bot.quit();
    setTimeout(() => process.exit(failed ? 1 : 0), 500);
  }
});

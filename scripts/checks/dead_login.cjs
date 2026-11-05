// #223's check: a member saved dead logs in dead, and that is no death. Joins as NAME (a plain player that does not
// respawn), is killed over RCON and leaves while dead, as Ada and Lena did at the end of train 20's I0 (killed by a spider
// as their connections timed out); then the agent server spawns NAME (brain idle, no reset). Before the fix its log had
// "[death] NAME other at <world spawn> (no death message: guessed)" and a walk home at +0.
// PASS: the agent log from the spawn on has "[death] NAME logged in dead" and no counted death line, and the agent is
// alive (health > 0) after it.
// Usage: MC_SERVER_DIR=mc/testserver node scripts/checks/dead_login.cjs AGENT_LOG [NAME] [PORT] [API]
const fs = require('fs');
const { execFileSync } = require('child_process');
const mineflayer = require('mineflayer');
const [log, name = 'Gus', port = '25566', api = 'http://127.0.0.1:8767/api'] = process.argv.slice(2);
if (!log) throw new Error('usage: dead_login.cjs AGENT_LOG [NAME] [PORT] [API]');
const rcon = (...cmds) => execFileSync('python', ['mc/rcon.py', ...cmds], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const call = async (method, path, body) => {
  const r = await fetch(`${api}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return r.json().catch(() => ({}));
};

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };

(async () => {
  await call('DELETE', `/agents/${name}`).catch(() => {});
  await sleep(2000);
  // 1. Saved dead: joins without respawning, killed, leaves while dead
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(port), username: name, version: '26.1', auth: 'offline', respawn: false });
  bot.on('error', (e) => console.log('error', e.message));
  await new Promise((ok) => bot.once('spawn', ok));
  await sleep(1000);
  const dead = new Promise((ok) => bot.once('death', ok));
  console.log(rcon(`kill ${name}`));
  await Promise.race([dead, sleep(5000)]);
  check(bot.health <= 0, `${name} killed and left dead (health ${bot.health})`);
  bot.quit();
  await sleep(3000);
  // 2. The agent server's spawn
  const from = fs.statSync(log).size;
  const r = await call('POST', '/agents', { name, brain: 'idle' });
  console.log(`spawned: ${JSON.stringify(r).slice(0, 160)}`);
  await sleep(10000);
  const lines = fs.readFileSync(log, 'utf8').slice(from).split(/\r?\n/).filter((l) => l.startsWith(`[death] ${name} `));
  for (const l of lines) console.log(`  ${l}`);
  check(lines.some((l) => /logged in dead/.test(l)), 'the log-in while dead is named as such');
  check(!lines.some((l) => /guessed|after the death/.test(l)), 'no death counted or walked home from');
  const o = await call('GET', `/agents/${name}/observe?radius=4`);
  check((o.health ?? 0) > 0, `${name} alive after it (health ${o.health})`);
  await call('DELETE', `/agents/${name}`);
  console.log(failed ? `dead_login: ${failed} FAILED` : 'dead_login: all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(e.stack); process.exit(1); });

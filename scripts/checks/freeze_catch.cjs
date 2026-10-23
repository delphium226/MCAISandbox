// Catch an event-loop block in a running agent server and print where it is (#106): opens the process's inspector, pings
// its API every second, and when no answer comes for BLOCK_S seconds pauses the process through the inspector (which
// works while JavaScript runs) and prints the call stack, a few times a block, then lets it run on.
// Usage: node scripts/checks/freeze_catch.cjs API_PORT [MINUTES] [OUT]   (default 60 minutes; OUT gets the stacks too)
// The process is found by the port it listens on (netstat); a new process on the port (a reset) is followed.
const http = require('http');
const fs = require('fs');
const { execSync } = require('child_process');
const WebSocket = require('D:/Projects/MCAISandbox/node_modules/ws');
const [port, minutes = '60', out] = process.argv.slice(2);
const BLOCK_S = 5, SAMPLES = 4;
const log = (s) => { console.log(s); if (out) fs.appendFileSync(out, s + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const end = Date.now() + Number(minutes) * 60000;

function pidOf() {
  try {
    const t = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    const m = t.split('\n').find((l) => new RegExp(`127\\.0\\.0\\.1:${port}\\s|0\\.0\\.0\\.0:${port}\\s`).test(l) && /LISTENING/.test(l));
    return m ? Number(m.trim().split(/\s+/).pop()) : null;
  } catch { return null; }
}
const ping = () => new Promise((ok) => {
  const r = http.get({ host: '127.0.0.1', port, path: '/api/perf', timeout: 1500 }, (res) => { res.resume(); ok(true); });
  r.on('timeout', () => { r.destroy(); ok(false); });
  r.on('error', () => ok(false));
});
const getJson = (p) => new Promise((ok, fail) => http.get({ host: '127.0.0.1', port: p, path: '/json' }, (res) => {
  let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { try { ok(JSON.parse(b)); } catch (e) { fail(e); } });
}).on('error', fail));

async function attach(pid) {
  execSync(`node -e "process._debugProcess(${pid})"`);
  await sleep(1500);
  for (const p of [9229, 9230, 9231, 9232]) {
    try {
      const list = await getJson(p);
      const t = list.find((x) => x.webSocketDebuggerUrl);
      if (t) { log(`attached to pid ${pid} at ${t.webSocketDebuggerUrl}`); return t.webSocketDebuggerUrl; }
    } catch { /* next */ }
  }
  throw new Error(`no inspector for pid ${pid}`);
}

async function main() {
  let pid = null, ws = null, id = 0, pending = new Map(), paused = null;
  const send = (method, params = {}) => new Promise((ok) => { pending.set(++id, ok); ws.send(JSON.stringify({ id, method, params })); });
  const scripts = new Map();
  while (Date.now() < end) {
    const now = pidOf();
    if (!now) { await sleep(3000); continue; }
    if (now !== pid) {
      if (ws) ws.close();
      pid = now;
      try {
        const url = await attach(pid);
        ws = new WebSocket(url, { perMessageDeflate: false });
        await new Promise((ok, fail) => { ws.on('open', ok); ws.on('error', fail); });
        ws.on('message', (m) => {
          const d = JSON.parse(m);
          if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
          if (d.method === 'Debugger.scriptParsed') scripts.set(d.params.scriptId, d.params.url);
          if (d.method === 'Debugger.paused' && paused) paused(d.params);
        });
      } catch (e) { log(`attach failed: ${e.message}`); ws = null; await sleep(5000); continue; }
    }
    let bad = 0;
    while (!(await ping())) {
      if (++bad < BLOCK_S) { await sleep(1000); continue; }
      log(`[catch] ${new Date().toISOString()} pid ${pid}: no API answer for ${bad} s; pausing`);
      await send('Debugger.enable');
      for (let k = 0; k < SAMPLES; k++) {
        const got = new Promise((ok) => (paused = ok));
        await send('Debugger.pause');
        const ev = await Promise.race([got, sleep(10000).then(() => null)]);
        paused = null;
        if (!ev) { log('  (no pause event in 10 s)'); break; }
        log(`  sample ${k + 1}:`);
        for (const f of ev.callFrames.slice(0, 25)) {
          const u = (scripts.get(f.location.scriptId) ?? f.url ?? '').replace(/^.*MCAISandbox[\\/]/, '');
          log(`    ${f.functionName || '(anon)'} ${u}:${f.location.lineNumber + 1}`);
        }
        await send('Debugger.resume');
        await sleep(2000);
        if (await ping()) break;
      }
      await send('Debugger.disable');
      bad = 0;
      await sleep(5000);
    }
    await sleep(1000);
  }
  if (ws) ws.close();
}
main().catch((e) => { log(`error: ${e.stack}`); process.exit(1); });

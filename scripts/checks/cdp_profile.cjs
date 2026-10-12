// Take a CPU profile of a running Node process through its inspector and print the heaviest functions (self time) and
// the heaviest files. Usage: node cdp_profile.cjs ws://127.0.0.1:9229/<id> SECONDS OUT.cpuprofile
// (open the inspector first: node -e "process._debugProcess(PID)"; find the id at http://127.0.0.1:9229/json)
const fs = require('fs');
const WebSocket = require('D:/Projects/MCAISandbox/node_modules/ws');
const [url, secs = '30', out = 'profile.cpuprofile'] = process.argv.slice(2);
const ws = new WebSocket(url);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((ok) => { pending.set(++id, ok); ws.send(JSON.stringify({ id, method, params })); });
ws.on('message', (m) => {
  const d = JSON.parse(m);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
});
ws.on('open', async () => {
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 500 });
  await send('Profiler.start');
  console.log(`profiling ${secs} s`);
  await new Promise((r) => setTimeout(r, Number(secs) * 1000));
  const { profile } = await send('Profiler.stop');
  fs.writeFileSync(out, JSON.stringify(profile));
  // self time per node from samples
  const dt = {};
  const { samples, timeDeltas, nodes } = profile;
  for (let i = 0; i < samples.length; i++) dt[samples[i]] = (dt[samples[i]] ?? 0) + (timeDeltas[i] ?? 0);
  const total = Object.values(dt).reduce((a, b) => a + b, 0);
  const byFn = {}, byFile = {};
  for (const n of nodes) {
    const t = dt[n.id] ?? 0;
    if (!t) continue;
    const f = n.callFrame;
    const file = (f.url || '(native)').replace(/^.*node_modules\//, 'nm/').replace(/^file:\/\/\/D:\/Projects\/MCAISandbox\//, '');
    const key = `${f.functionName || '(anon)'}  ${file}:${f.lineNumber + 1}`;
    byFn[key] = (byFn[key] ?? 0) + t;
    const pkg = file.startsWith('nm/') ? file.split('/').slice(0, file.split('/')[1].startsWith('@') ? 3 : 2).join('/') : file;
    byFile[pkg] = (byFile[pkg] ?? 0) + t;
  }
  const pct = (t) => `${(100 * t / total).toFixed(1)}%`;
  console.log(`total sampled ${(total / 1e6).toFixed(1)} s`);
  console.log('--- by package/file');
  for (const [k, t] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(pct(t).padStart(6), k);
  console.log('--- by function (self)');
  for (const [k, t] of Object.entries(byFn).sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(pct(t).padStart(6), k);
  process.exit(0);
});

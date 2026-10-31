// What ran during the event loop's stalls: a CPU profile of a running Node process (through its inspector, like
// cdp_profile.cjs) with a 10 ms timer put into the process beside it, so each gap the timer saw (a late fire: the loop
// delay /api/perf's p99 measures) can be matched to the samples taken in it. Prints the gaps' spread, then the time in
// gaps over MIN ms (default 60) by the outermost three server/src frames, and by the library frame at the top of the stack.
// Usage: node cdp_stalls.cjs ws://127.0.0.1:9229/<id> SECONDS OUT.cpuprofile [MIN_MS]
// (OUT "-": the timer only, no profile, for the loop's delay without the profiler's own cost; p99 as /api/perf counts it)
// (open the inspector first: node -e "process._debugProcess(PID)"; the id is at http://127.0.0.1:9229/json)
const fs = require('fs');
const WebSocket = require('D:/Projects/MCAISandbox/node_modules/ws');
const [url, secs = '60', out = 'stalls.cpuprofile', minMs = '60'] = process.argv.slice(2);
const MIN = Number(minMs);
const ws = new WebSocket(url);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((ok) => { pending.set(++id, ok); ws.send(JSON.stringify({ id, method, params })); });
ws.on('message', (m) => {
  const d = JSON.parse(m);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
});
const eval_ = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.value;
ws.on('open', async () => {
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 500 });
  // (the timer keeps its gaps over 30 ms in µs of process.hrtime, the clock the profile's timestamps use)
  await eval_(`(() => { const g = globalThis; g.__stalls = []; g.__fires = 0; let prev = process.hrtime.bigint();
    g.__stallTimer = setInterval(() => { const now = process.hrtime.bigint(); const gap = Number(now - prev) / 1e3;
      if (gap > 30000) g.__stalls.push([Number(prev / 1000n), Number(now / 1000n)]); prev = now; g.__fires++; }, 10);
    return true; })()`);
  if (out === '-') {
    await new Promise((r) => setTimeout(r, Number(secs) * 1000));
    const st = await eval_('(() => { clearInterval(globalThis.__stallTimer); return { s: globalThis.__stalls, fires: globalThis.__fires }; })()');
    ws.close();
    spread(st.s, st.fires);
    return;
  }
  await send('Profiler.start');
  const t0 = await eval_('Number(process.hrtime.bigint() / 1000n)');
  console.log(`profiling ${secs} s`);
  await new Promise((r) => setTimeout(r, Number(secs) * 1000));
  const { profile } = await send('Profiler.stop');
  const stalls = await eval_('(() => { clearInterval(globalThis.__stallTimer); return { s: globalThis.__stalls, fires: globalThis.__fires }; })()');
  fs.writeFileSync(out, JSON.stringify(profile));
  fs.writeFileSync(out.replace(/\.cpuprofile$/, '') + '.stalls.json', JSON.stringify(stalls));
  ws.close();
  console.log(`clock check: profile starts ${((profile.startTime - t0) / 1e3).toFixed(1)} ms from the hrtime read after Profiler.start (Profiler.start itself holds the loop ~250 ms: its gap is in the list)`);
  analyse(profile, stalls.s, stalls.fires);
});

/** The gaps' spread; p99 and the rest as /api/perf counts them (a gap less the timer's 10 ms; under 20 ms not kept). */
function spread(stalls, fires) {
  const gaps = stalls.map(([a, b]) => (b - a) / 1e3);
  const n = (ms) => gaps.filter((g) => g >= ms).length;
  console.log(`timer fires ${fires}; gaps >= 30 ms: ${n(30)}, >= 60: ${n(60)}, >= 100: ${n(100)}, >= 200: ${n(200)}; longest ${[...gaps].sort((a, b) => b - a).slice(0, 12).map((g) => g.toFixed(0)).join(' ')}`);
  const late = gaps.map((g) => g - 10).sort((a, b) => b - a);
  const q = (p) => { const v = late[Math.floor(fires * (1 - p))]; return v === undefined ? '<20' : v.toFixed(1); };
  console.log(`delay p99 ${q(0.99)} ms, p99.5 ${q(0.995)}, p99.9 ${q(0.999)}, max ${late.length ? late[0].toFixed(1) : '<20'}`);
}

function analyse(p, stalls, fires) {
  spread(stalls, fires);
  const byId = new Map(p.nodes.map((x) => [x.id, x]));
  const parent = new Map();
  for (const x of p.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const ours = (x) => /server\/src\//.test(x.callFrame.url);
  const nm = (x) => `${x.callFrame.functionName || '(anon)'} ${x.callFrame.url.replace(/^.*server\/src\//, '').replace(/^.*node_modules\//, 'nm/').replace(/^node:/, '')}`;
  const memo = new Map();
  const key = (sid) => {
    if (memo.has(sid)) return memo.get(sid);
    let x = byId.get(sid); const c = []; const lib = [];
    while (x) { if (ours(x)) c.push(nm(x)); else if (!c.length && x.callFrame.url) lib.push(nm(x)); x = byId.get(parent.get(x.id)); }
    const k = { ours: c.slice(-3).reverse().join(' > ') || '(no server/src frame)', top: nm(byId.get(sid)), libTop: lib[lib.length - 1] ?? nm(byId.get(sid)) };
    memo.set(sid, k);
    return k;
  };
  const win = stalls.filter(([a, b]) => b - a >= MIN * 1000).sort((u, v) => u[0] - v[0]);
  const tally = { ours: {}, top: {}, libTop: {} };
  let t = p.startTime, w = 0, inT = 0;
  for (let i = 0; i < p.samples.length; i++) {
    t += p.timeDeltas[i];
    while (w < win.length && win[w][1] < t) w++;
    if (w >= win.length) break;
    if (t < win[w][0]) continue;
    const dt = p.timeDeltas[i + 1] ?? 0; inT += dt;
    const k = key(p.samples[i]);
    for (const f of ['ours', 'top', 'libTop']) tally[f][k[f]] = (tally[f][k[f]] ?? 0) + dt;
  }
  const pr = (o, k) => { for (const [a, v] of Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, k)) console.log(`${(100 * v / inT).toFixed(1).padStart(5)}%  ${(v / 1e3).toFixed(0).padStart(6)} ms  ${a}`); };
  console.log(`--- ${win.length} gaps >= ${MIN} ms, ${(inT / 1e3).toFixed(0)} ms sampled in them: outermost server/src frames`); pr(tally.ours, 25);
  console.log('--- the outermost library frame under them (entry points: sockets, timers)'); pr(tally.libTop, 15);
  console.log('--- self time'); pr(tally.top, 20);
}

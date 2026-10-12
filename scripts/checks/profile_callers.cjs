// Inclusive time of a CPU profile attributed to the nearest calling function in server/src (and its caller chain)
const p = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = {};
for (let i = 0; i < p.samples.length; i++) self[p.samples[i]] = (self[p.samples[i]] ?? 0) + (p.timeDeltas[i] ?? 0);
const total = Object.values(self).reduce((a, b) => a + b, 0);
const ours = (n) => /server\/src\//.test(n.callFrame.url);
const name = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^.*server\/src\//, '')}`;
const near = {}, chain = {};
for (const [id, t] of Object.entries(self)) {
  let n = byId.get(Number(id)); const path = [];
  while (n) { if (ours(n)) path.push(name(n)); n = byId.get(parent.get(n.id)); }
  const k = path[0] ?? '(no server/src frame)';
  near[k] = (near[k] ?? 0) + t;
  const c = path.slice(0, 3).join(' < ') || '(none)';
  chain[c] = (chain[c] ?? 0) + t;
}
const pr = (o, k) => { for (const [a, t] of Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, k)) console.log(`${(100 * t / total).toFixed(1).padStart(5)}%  ${a}`); };
console.log('--- nearest server/src function (inclusive of library time below it)'); pr(near, 25);
console.log('--- chains (3 deep)'); pr(chain, 25);

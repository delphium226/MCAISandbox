/**
 * bigbench (MC_TALK_BIG, docs/specs/requested-builds.md): the architect's drawings of big and material requests through
 * castPublic's real path with the big option (the 30x30x30 prompt, the worker sandbox, the block resolver, compile and fit
 * at the budget for 50 members). Per sample: drawn or why, size against the size asked, the material asked in the palette,
 * the swaps said, cuts, calls, latency.
 *
 * Usage: MODEL=gpt-oss:120b-cloud OLLAMA=http://127.0.0.1:11434 N=4 node node_modules/tsx/dist/cli.mjs scripts/bench/bigbench.mts
 * Env: THINK (default low, the talk build's), ONLY (ids), PEEK=1 (each program), MEMBERS (50).
 */
import minecraftData from 'minecraft-data';

process.env.MC_TIME_SCALE = '1';
const T = await import('../../server/src/talkDesign');
const S = await import('../../server/src/sculpture');
const A = await import('../../server/src/askedWork');
const { yardMaterials } = await import('../../server/src/mineflayer/mcKiln');
const { Materials, designBill } = await import('../../server/src/mineflayer/mcMaterials');
type Design = import('../../server/src/village').Design;

const reg = minecraftData('26.1');
const planner = yardMaterials({ materials: new Materials(reg), registry: reg }, { asked: true } as never)!;
const resolve = A.makeResolver({ known: (n) => !!reg.blocksByName[n] && !!reg.itemsByName[n], plan: (b) => planner.plan(b), colours: new Set(A.DYE_COLOURS.filter((c) => c !== 'brown')), colourBlocks: S.COLOUR_BLOCKS, alias: S.COLOUR_ALIAS });
const bill = { units: (d: Design) => Object.values(planner.plan(designBill(d)).gather).reduce((t, q) => t + q, 0), smelts: (d: Design) => planner.plan(designBill(d)).fuel.smelts };

interface Case { id: string; text: string; what: string; material: RegExp; size?: number }
const CASES: Case[] = [
  { id: 'pyramid', text: 'Mayor, build a 30-block pyramid of blue glass please', what: 'a 30-block blue glass pyramid', material: /^blue_stained_glass$/, size: 30 },
  { id: 'tower', text: 'a red wool castle tower next to the hall please', what: 'a red wool castle tower', material: /^red_wool$/ },
  { id: 'obelisk', text: 'Mayor, could you build a quartz obelisk in the square?', what: 'a quartz obelisk', material: /quartz|white_concrete/ },
  { id: 'arch', text: 'build a terracotta arch over the road', what: 'a terracotta arch', material: /terracotta/ },
  { id: 'dragon', text: 'make a statue of a dragon, 25 blocks tall, out of green concrete', what: 'a 25-block green concrete dragon statue', material: /^green_concrete$/, size: 25 },
  { id: 'lighthouse', text: 'a white and red striped lighthouse 28 blocks tall by the sea', what: 'a 28-block red and white lighthouse', material: /red|white/, size: 28 },
];

const MODEL = process.env.MODEL ?? 'gpt-oss:120b-cloud';
const OLLAMA = process.env.OLLAMA ?? 'http://127.0.0.1:11434';
const THINK = process.env.THINK ?? 'low';
const N = Number(process.env.N ?? 4), MEMBERS = Number(process.env.MEMBERS ?? 50);
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
console.log(`bigbench ${MODEL}, think ${THINK}, ${N} samples, budget ${A.bigBudget(MEMBERS)} units (${MEMBERS} members)`);
let drawn = 0, sized = 0, mat = 0, all = 0;
const ms: number[] = [];
for (const [i, c] of CASES.filter((x) => !only || only.has(x.id)).entries()) {
  for (let s = 0; s < N; s++) {
    const t0 = Date.now();
    const r = await T.castPublic({
      agent: 'Mayor', spec: { provider: 'ollama', model: MODEL }, ctx: { text: c.text, what: c.what, family: 'plains', wood: 'oak' }, budget: A.bigBudget(MEMBERS), bill, name: T.askedName(c.what, `b${s}`), big: { resolve },
      call: (async (req: { system: string; user: string }) => {
        const res = await fetch(`${OLLAMA}/api/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: MODEL, stream: false, think: THINK, options: { num_ctx: 8192, temperature: 0.7, seed: 1000 * i + s }, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }] }),
        });
        const j = (await res.json()) as { message?: { content?: string }; error?: string };
        if (j.error) throw new Error(j.error);
        return { reply: { calls: [], text: j.message?.content ?? '' }, ms: Date.now() - t0, waitMs: 0 };
      }) as never,
    });
    all++;
    const d = r.design, ms0 = Date.now() - t0;
    ms.push(ms0);
    const pal = d ? [...new Set(Object.values(d.palette))] : [];
    const big = d ? Math.max(d.width, d.depth, d.height) : 0;
    const okSize = !!d && (!c.size || big >= c.size - 3);
    const okMat = pal.some((b) => c.material.test(b));
    if (d) drawn++;
    if (okSize) sized++;
    if (okMat) mat++;
    const calls = (r.code.match(/\b(box|block)\s*\(/g) ?? []).length;
    console.log(`${c.id}#${s} ${(ms0 / 1000).toFixed(1)}s ${d ? `${d.width}x${d.depth}x${d.height} ${d.blocks} blocks ${bill.units(d)}u` : `none:${r.why} ${r.error ?? ''}`} size=${okSize} material=${okMat} [${pal.join(',')}] calls~${calls}${r.figure === false ? ' (house library)' : ''}${r.cuts.length ? ` cuts=${r.cuts.join(',')}` : ''}${r.notes.length ? ` notes=${r.notes.join('; ').slice(0, 160)}` : ''} | "${r.said.slice(0, 80)}"`);
    if (process.env.PEEK === '1') console.log(`  ${r.code.replace(/\n/g, '\n  ')}`);
  }
}
const med = [...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)] ?? 0;
console.log(`bigbench ${MODEL}: drawn ${drawn}/${all}, size as asked ${sized}/${all}, material asked ${mat}/${all}; median ${(med / 1000).toFixed(1)} s`);

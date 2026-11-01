/**
 * The talk build's two tiers (MC_TALK_DESIGNS, talkDesign.ts) and #198, offline: the shortlist by words (a windmill and a
 * mill name the mills, a pub the inns, a clock tower the clock towers before the watchtowers; a bakery or a spaceship
 * names none), the Mayor's design prompt, tool and parse (work=design, what, nearest), matching a pick by id, title or
 * kind, a coded design's name (never a dwelling, its words without the prefix), the architect's call (a program built
 * and fitted; no server = down; no code = model), and #198's line for a question about a request the ledger does not hold.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/talk_build.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const T = await import('../../server/src/talkDesign');
const P = await import('../../server/src/playerTalk');
const { isDwelling } = await import('../../server/src/grow');
const { LANDMARK_UNITS } = await import('../../server/src/designs');

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL ${what}`);
  }
};
const ids = (text: string) => T.shortlist(text).map((o) => o.id);
const kinds = (text: string) => [...new Set(T.shortlist(text).map((o) => o.kind))];

// ---- tier 1: the shortlist
ok(kinds('Mayor, please build a windmill by the river').join() === 'mill', `a windmill names the mills (${kinds('Mayor, please build a windmill by the river')})`);
ok(ids('Mayor, please build a windmill by the river').includes('pitstone_windmill') || ids('build a windmill').length === 4, 'Pitstone among them, or four smaller mills');
ok(kinds('can we have a mill?').join() === 'mill', 'a mill names the mills');
ok(kinds('build a lighthouse').join() === 'lighthouse', 'a lighthouse names the lighthouses');
ok(kinds('a pub for the evenings').join() === 'inn', 'a pub names the inns');
ok(kinds('we want a castle').join() === 'tower house', `a castle names the tower houses (${kinds('we want a castle')})`);
ok(T.shortlist('build a clock tower')[0]?.kind === 'clock tower', 'a clock tower before the watchtowers');
ok(ids('build the Pitstone windmill')[0] === 'pitstone_windmill', 'a name first');
ok(ids('build a church').length > 0 && kinds('build a church').includes('parish church'), 'a church names the parish churches');
ok(ids('Mayor, please build a bakery by the river').length === 0, 'a bakery names none');
ok(P.withoutPlace('please build a post office near the market') === 'please build a post office' && ids(P.withoutPlace('a bakery next to the inn')).length === 0, 'place words are not what is asked');
ok(ids('build me a spaceship').length === 0, 'a spaceship names none');
ok(ids('a house here').length === 0 && ids('more houses please').length === 0, 'houses name none');
ok(T.shortlist('a windmill', new Set(['pitstone_windmill'])).every((o) => o.id !== 'pitstone_windmill'), 'a building standing here is left out');
ok(T.shortlist('a windmill').every((o) => o.width <= 72 && o.depth <= 72 && o.blocks > 0), 'offers drawn, within a civic site');
const others = T.sampler();
ok(others.length === 6 && new Set(others.map((o) => o.kind)).size === 6, 'the sampler: six kinds');
const mills = T.shortlist('a windmill');
ok(T.matchDesign(mills, mills[0].id)?.id === mills[0].id, 'a pick by id');
ok(T.matchDesign(mills, mills[0].title)?.id === mills[0].id, 'a pick by title');
ok(T.matchDesign(mills, 'mill')?.kind === 'mill', 'a pick by kind');
ok(T.matchDesign(mills, 'smeatons_tower')?.id === 'smeatons_tower', 'any civic id');
ok(!T.matchDesign(mills, 'plains_temple_3') && !T.matchDesign(mills, 'design') && !T.matchDesign(mills, ''), 'a work, design or nothing is no pick');

// ---- the Mayor's prompt, tool and parse
ok(/"design"/.test(P.talkSystem('mayor', true)) && !/"design"/.test(P.talkSystem('mayor')), 'the design system prompt only with designs');
const tool = P.talkTool('mayor', true).input_schema as { properties: Record<string, unknown> };
ok(tool.properties.what && tool.properties.nearest && !(P.talkTool('mayor').input_schema as { properties: Record<string, unknown> }).properties.what, 'what and nearest only with designs');
const base = { agent: 'Mayor', role: 'mayor' as const, village: 'V', persona: [], from: 'Sam', lines: ['build a windmill'], history: [], state: [], works: [] };
const u = P.talkUser({ ...base, designs: mills });
ok(u.includes('Pre-designed buildings that match their words') && u.includes(mills[0].id) && u.includes('- design:'), 'the shortlist and design in the prompt');
const u0 = P.talkUser({ ...base, designs: [], otherDesigns: others });
ok(u0.includes('No pre-designed building matches') && u0.includes(others[0].id), 'the sampler when none match');
ok(!P.talkUser(base).includes('Pre-designed') && !P.talkUser(base).includes('- design:'), 'nothing of it without designs');
const r = P.parseRespond({ calls: [{ name: 'respond', input: { kind: 'build', say: 'Our architect will draw it!', work: 'design', what: 'a bakery', nearest: 'pembridge_market' } }] }, 'mayor');
ok(r?.kind === 'build' && r.work === 'design' && r.what === 'a bakery' && r.nearest === 'pembridge_market', 'parse: work=design, what, nearest');

// ---- a coded design's name
const n = T.askedName('a lighthouse', 'r12');
ok(n === 'asked_lighthall_r12' || (n.startsWith('asked_') && n.endsWith('_r12')), `the name (${n})`);
ok(!isDwelling(n) && !isDwelling(T.askedName("a wizard's cottage", 'r3')), 'never a dwelling');
ok(P.workWords('asked_bakery_r12') === 'bakery' && P.workWords('plains_temple_3') === 'temple', 'its words');
ok(T.civicIdOf(T.civicPiece('pitstone_windmill')) === 'pitstone_windmill' && T.civicIdOf('plains_temple_3') === undefined, 'civic pieces');

// ---- the architect's call
const bill = { units: (d: { blocks: number }) => Math.round(d.blocks * 0.6), smelts: () => 0 };
const reply = (text: string) => (async () => ({ reply: { calls: [], text }, ms: 5, waitMs: 0 })) as never;
const good = await T.castPublic({ agent: 'Mayor', spec: { provider: 'ollama', model: 'qwen3.8:27b' }, ctx: { text: 'a bakery please', what: 'a bakery', family: 'plains' }, budget: LANDMARK_UNITS, bill: bill as never, name: 'asked_bakery_r1',
  call: reply('```js\nbody(7, 5, 1);\nchimney("right");\nporch();\nnote("the village bakery");\n```') });
ok(good.design?.name === 'asked_bakery_r1' && /^a bakery: a 7x5 one-storey .* building/.test(good.design.description) && good.built?.chimney, `a program built (${good.design?.description})`);
const down = await T.castPublic({ agent: 'Mayor', spec: { provider: 'ollama', model: 'qwen3.8:27b' }, ctx: { text: 'x', what: 'a bakery', family: 'plains' }, budget: LANDMARK_UNITS, bill: bill as never, name: 'asked_x_r2',
  call: (async () => { throw new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:11436'); }) as never });
ok(!down.design && down.why === 'down', `no server: down (${down.why})`);
const none = await T.castPublic({ agent: 'Mayor', spec: { provider: 'ollama', model: 'qwen3.8:27b' }, ctx: { text: 'x', what: 'a bakery', family: 'plains' }, budget: LANDMARK_UNITS, bill: bill as never, name: 'asked_x_r3', call: reply('I cannot do that.') });
ok(!none.design && none.why === 'model', 'no code: model');
ok(/just now/.test(T.failWords('down')) && /fit/.test(T.failWords('fit')), 'the failures in words');

// ---- #198: a question about a request the ledger does not hold
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-build-'));
P.initTalk(dir);
const now = Date.now();
ok(/no house request/.test(P.noRequestLine('V', 'Sam', now, 'where is my house?') ?? ''), 'no requests: "where is my house?" has no house on record');
ok(/no request from you/.test(P.noRequestLine('V', 'Sam', now, 'how is the thing I asked for coming along?') ?? ''), 'no requests: any of theirs');
ok(P.noRequestLine('V', 'Sam', now, 'how is the village doing?') === null, 'a question about the village is not about theirs');
const w = P.addRequest({ village: 'V', from: 'Sam', to: 'Mayor', text: 'build a windmill', at: now - 60000 });
P.updateRequest(w.id, { kind: 'build', status: 'queued', piece: T.civicPiece('pitstone_windmill'), what: 'Pitstone Windmill (a mill)' });
const line = P.noRequestLine('V', 'Sam', now, 'how is my house coming along?');
ok(/no house request/.test(line ?? '') && /Pitstone/.test(line ?? ''), `a windmill but no house: says so (${line})`);
ok(P.noRequestLine('V', 'Sam', now, 'how is my windmill coming along?') === null, 'a windmill question goes to statusFor');
const h = P.addRequest({ village: 'V', from: 'Sam', to: 'Mayor', text: 'a house here please', at: now - 30000 });
P.updateRequest(h.id, { kind: 'build', status: 'under_way', piece: 'houses', what: 'a street of houses' });
ok(P.noRequestLine('V', 'Sam', now, 'where is my house?') === null, 'with a house request: statusFor answers');

console.log(`talk_build: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);

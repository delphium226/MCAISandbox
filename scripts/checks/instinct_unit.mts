/**
 * The instincts' unit check (#205, spec runs/2026-11-02/instincts/spec.md 6.1; no server): E1 from repeat failures, the
 * grading table (3.1), E4's instead, the drop at 0, one new instinct a day, the cap of 5 and its replacement (3.2),
 * duplicate areas merging, the untested fade, the template's 22 words, `xw` (an avoid at 1.0 halves an option's weight;
 * the fixed pick takes the other, and a meal still comes first), the place layer, and the flag off.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/instinct_unit.mts
 */
process.env.MC_INSTINCTS = 'on';
process.env.MC_TIME_SCALE = '1';
process.env.MC_DAY_MIN = '20';
const I = await import('../../server/src/instincts.ts');
const { fixedPick } = await import('../../server/src/choose.ts');
type ChoiceMenu = import('../../server/src/world.ts').ChoiceMenu;
type ChoiceOption = import('../../server/src/world.ts').ChoiceOption;

let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};
const lines: string[] = [];
I.setInstinctLog((l) => lines.push(l));
const DAY = 20 * 60000, MIN = 60000;
const V = 'U1';
let seq = 0;
/** One chore of a member, start to end. */
function chore(agent: string, key: string, kind: string, ok: boolean, message: string, t: number, what?: string): string {
  const id = `U1#${++seq}`;
  I.noteChoice({ id, agent, village: V, key, kind, what, t });
  I.noteChoiceEnd({ id, ok, message, tEnd: t + MIN });
  return id;
}
const held = (agent: string) => I.instinctsOf(V, agent);
const fresh = () => { I.initInstincts(null); lines.length = 0; };

// E1 and the grading table
fresh();
const T0 = 1_000_000_000;
chore('Ada', 'monument:gather:sand:1', 'monument', false, 'no sand within 96 blocks of the village at -1500,63', T0);
check(held('Ada').length === 0, 'one failure teaches nothing');
chore('Ada', 'monument:gather:sand:2', 'monument', false, 'no sand within 96 blocks of the village at -1480,70', T0 + 5 * MIN);
const a = held('Ada')[0];
check(!!a && a.how === 'E1' && a.conf === 1 && a.trigger.keys[0] === 'monument:gather:sand' && a.trigger.item === 'sand',
  `the same key failed twice with one message class: learned at 1.0 (${a?.trigger.keys}, item ${a?.trigger.item})`);
check(!!a && I.words(a.text) <= I.MAX_WORDS, `the template's text in ${I.MAX_WORDS} words: "${a?.text}"`);
chore('Ada', 'monument:gather:sand:1', 'monument', false, 'no sand within 96 blocks of the village at -1400,10', T0 + 10 * MIN);
check(a.conf === 1, 'the avoided thing failing again confirms (capped at 1.0)');
chore('Ada', 'monument:gather:sand:1', 'monument', false, 'the walk timed out', T0 + 12 * MIN);
check(a.conf === 1, 'a failure of another class grades nothing');
chore('Ada', 'monument:gather:sand:1', 'monument', true, 'gathered 64 sand', T0 + 14 * MIN);
check(a.conf === 0.75, `the avoided thing succeeding contradicts (${a.conf})`);
check(I.weightFor(V, 'Ada', { id: 'monument:gather:sand', key: 'monument:gather:sand:3', kind: 'monument' }) === 1 - 0.5 * 0.75,
  'xw for an avoid at 0.75: 0.625');
check(I.weightFor(V, 'Ada', { id: 'make:torch', key: 'make:torch', kind: 'make' }) === undefined, 'an unrelated option gets no xw');
// E4: a success at the same item by another key fills the instead, and grades from then on
chore('Ada', 'gather:sand', 'gather', true, 'gathered 32 sand', T0 + 16 * MIN);
check(a.instead === 'gather:sand', `a success at the same item by another key fills the instead (${a.instead})`);
check(I.weightFor(V, 'Ada', { id: 'gather:sand', key: 'gather:sand', kind: 'gather' }) === 1 + 0.3 * 0.75, 'the instead option: xw 1 + 0.3c (1.225 at 0.75)');
const before = a.conf;
chore('Ada', 'gather:sand', 'gather', true, 'gathered 32 sand', T0 + 18 * MIN);
check(a.conf === Math.min(1, before + 0.25), 'the instead succeeding confirms');
// Four contradictions in a row drop a learned instinct
for (let k = 0; k < 4; k++) chore('Ada', 'monument:gather:sand:1', 'monument', true, 'gathered 64 sand', T0 + (20 + k) * MIN);
check(held('Ada').length === 0 && lines.some((l) => / drops i\d+ \(contradicted\)/.test(l)), 'four contradictions drop it');

// One new instinct a day; a waiting candidate promoted the next day
fresh();
const fail2 = (agent: string, key: string, t: number) => {
  chore(agent, key, 'make', false, `cannot make ${key}: short of planks`, t);
  chore(agent, key, 'make', false, `cannot make ${key}: short of planks`, t + MIN);
};
fail2('Ben', 'make:torch', T0);
fail2('Ben', 'make:chest', T0 + 3 * MIN);
check(held('Ben').length === 1 && lines.some((l) => /waiting \(one new instinct a day\)/.test(l)), 'a second lesson the same day waits');
chore('Ben', 'make:barrel', 'make', true, 'made a barrel', T0 + DAY + MIN);
check(held('Ben').length === 2, 'the next day the waiting candidate is learned');

// The cap of 5 and replacement
fresh();
for (let d = 0; d < 5; d++) fail2('Cid', `make:item${d}`, T0 + d * DAY);
check(held('Cid').length === 5, 'five learned on five days');
chore('Cid', 'make:item0', 'make', true, 'made it', T0 + 5 * DAY);
const low = held('Cid').find((i) => i.trigger.keys[0] === 'make:item0')!;
check(low.conf === Math.min(...held('Cid').map((i) => i.conf)) && low.conf < 1, `the oldest, faded and contradicted, is the least sure (${held('Cid').map((i) => i.conf)})`);
fail2('Cid', 'make:item5', T0 + 5 * DAY + 2 * MIN);
check(held('Cid').length === 5 && !held('Cid').includes(low) && held('Cid').some((i) => i.trigger.keys[0] === 'make:item5'),
  'a sixth lesson replaces the least sure one below 1.0');
for (const i of held('Cid')) { i.conf = 1; i.graded = T0 + 6 * DAY; }
fail2('Cid', 'make:item6', T0 + 6 * DAY + 2 * MIN);
check(held('Cid').length === 5 && !held('Cid').some((i) => i.trigger.keys[0] === 'make:item6') && lines.some((l) => /5 held, all at 1.0/.test(l)),
  'with all 5 at 1.0 the candidate waits');

// Duplicates merge; E2 areas from stalls; the place layer; the untested fade
fresh();
const stuck = (agent: string, x: number, z: number, water = 600) =>
  `[stuck] ${agent} stuck at ${x}.5,62.00,${z}.5 -> -1491,62,67 after 20.0 s: moved 1.20; goal GoalNear -1491,62,67 range 4.00 set end no; path moving; ticks 800/800 fwd 700 jump 500 sprint 100 ground 0 water ${water} busy 0 idle 3 nogoal 0; y 61-62`;
const home = { x: -1631, z: 23 };
I.noteChoice({ id: 'U1#d1', agent: 'Dee', village: V, key: 'monument:gather:sand:1', kind: 'monument', t: T0 });
I.noteStall(stuck('Dee', -1497, 63), { village: V, home, now: T0 + MIN });
I.noteStall(stuck('Dee', -1497, 63, 100).replace('moved 1.20', 'moved 9.00'), { village: V, home, now: T0 + 2 * MIN });
check(held('Dee').length === 0, 'a stall that moved on dry ground does not count');
I.noteStall(stuck('Dee', -1500, 60), { village: V, home, now: T0 + 3 * MIN });
const area = I.noteStall(stuck('Dee', -1495, 65), { village: V, home, now: T0 + 4 * MIN });
check(!!area?.trigger.area && area.trigger.item === 'sand', `three stalls within 12 blocks teach an area (${area?.text})`);
check(!!area && I.words(area.text) <= I.MAX_WORDS, 'its text within 22 words');
const pl = I.placeLayer(V, 'Dee', 'collect:sand');
check(!!pl && pl.avoid(-1491, 67) && !pl.avoid(-1600, 30), 'the place layer passes over a target beyond the area, not one at home');
check(I.placeLayer(V, 'Eve', 'collect:sand') === null, 'a member with no area instinct gets no place layer');
check(I.weightFor(V, 'Dee', { id: 'works:prepare', key: 'works:prepare', kind: 'works', at: { x: -1491, z: 67 } }) === undefined,
  'an area learned in a sand chore gives no xw to another key');
pl!.used(-1491, 67);
I.noteChoiceEnd({ id: 'U1#d1', ok: true, message: 'gathered 64 sand', tEnd: T0 + 5 * MIN });
check(area!.conf === 0.75, 'falling back to the avoided area and succeeding contradicts it');
I.noteChoice({ id: 'U1#d2', agent: 'Dee', village: V, key: 'monument:gather:sand:1', kind: 'monument', t: T0 + DAY + MIN });
for (let k = 0; k < 3; k++) I.noteStall(stuck('Dee', -1497 + k, 63), { village: V, home, now: T0 + DAY + (2 + k) * MIN });
check(held('Dee').length === 1 && area!.conf === 1, 'three more stalls there confirm it, no second entry (merged)');
I.noteChoiceEnd({ id: 'U1#d2', ok: false, message: 'cancelled', tEnd: T0 + DAY + 6 * MIN, cut: true });
chore('Dee', 'make:torch', 'make', true, 'made 4 torches', T0 + 3 * DAY + 7 * MIN);
check(area!.conf === 0.75 && lines.some((l) => / fades i\d+ \(untested/.test(l)), 'ungraded for 2 days: fades by 0.25');
for (let d = 5; d <= 11; d += 2) chore('Dee', 'make:torch', 'make', true, 'made 4 torches', T0 + d * DAY + 7 * MIN);
check(held('Dee').length === 0 && lines.some((l) => / drops i\d+ \(faded\)/.test(l)), 'untested for 8 days: dropped');

// The template's limit on long words
const long = I.template({ how: 'E1', trigger: { keys: ['activity:lib:amethyst_cluster_harvest'], kinds: [], item: 'amethyst_cluster' }, cls: 'the pickaxe broke while mining the amethyst cluster far away in the cave under the hill', count: 7 });
check(I.words(long) <= I.MAX_WORDS, `a long lesson is cut to 22 words (${I.words(long)}): "${long}"`);

// xw in the fixed pick: an avoid at 1.0 halves the option's weight; a meal still comes first
const opt = (id: string, kind: string, rank: number, extra: Partial<ChoiceOption> = {}): ChoiceOption =>
  ({ id, key: id, kind, holds: [], excludes: [], name: id, facts: '', effect: '', rank, ...extra }) as ChoiceOption;
const menu = (options: ChoiceOption[]): ChoiceMenu =>
  ({ agent: 'Fay', village: V, t: T0, options, guarded: [], reasons: {}, ctx: {} as ChoiceMenu['ctx'] }) as ChoiceMenu;
fresh();
fail2('Fay', 'make:torch', T0);
const m1 = menu([opt('make:torch', 'make', 0, { tw: 1 }), opt('make:chest', 'make', 1, { tw: 1 })]);
check(fixedPick(m1)?.id === 'make:torch', 'without xw the lower rank is picked');
I.applyInstincts(m1);
check(m1.options[0].xw === 0.5 && m1.options[1].xw === undefined, 'applyInstincts: an avoid at 1.0 gives xw 0.5, others none');
check(fixedPick(m1)?.id === 'make:chest' && lines.some((l) => /Fay act: picks make:chest, not make:torch/.test(l)), 'the fixed pick takes the other and logs the act');
const m2 = menu([opt('eat', 'eat', 0), opt('make:torch', 'make', 1, { tw: 1 }), opt('make:chest', 'make', 2, { tw: 1 })]);
I.applyInstincts(m2);
check(fixedPick(m2)?.id === 'eat', 'a meal still comes first');

// The flag off: nothing learned, no weight
fresh();
I.setInstinctsOn(false);
fail2('Gus', 'make:torch', T0);
const m3 = menu([opt('make:torch', 'make', 0, { tw: 1 })]);
I.applyInstincts(m3);
check(held('Gus').length === 0 && m3.options[0].xw === undefined && lines.length === 0, 'MC_INSTINCTS=off: nothing learned, no xw, no line');

console.log(failed ? `instinct_unit: ${failed} FAILED` : 'instinct_unit: all checks passed');
process.exit(failed ? 1 : 0);

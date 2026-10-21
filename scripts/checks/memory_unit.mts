/**
 * Members' memory and the village clock (G1, #26): memory.ts and society.ts offline, on a fake clock and a temporary
 * folder. Caps and eviction, replace by id, the per-day cap, recall's cap and order, a save and load that reproduces
 * recall exactly, the clock's windows and offsets, a run begun by a spawn with reset and continued by one without, the dawn
 * decision once a member-day, the night's day lines and reflection (a fake model), and the chooser's prompt and tool with
 * memory on and off.
 *
 *   npx tsx scripts/checks/memory_unit.mts
 */
process.env.MC_MEMORY = 'on';
process.env.MC_CLOCK = 'on';
process.env.MC_DAY_MIN = '20';
process.env.MCAI_ACTS_LOG = `${process.env.TEMP ?? '/tmp'}/memory_unit_acts.jsonl`;
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MEMORY, agentMemory, applyWrites, clockOf, closeAgentDays, flushMemory, initMemory, isDawnDecision, liveNotes, loadMemory, noteEnd,
  noteIntent, noteSpawn, offsetIn, recall, rosterOf, serialiseMemory, setMemorySettings, villageMemory,
} from '../../server/src/memory';
import { parseReflect, reflectPrompt, setReflectCall, tick } from '../../server/src/society';
import { buildPrompt } from '../../server/src/choose';
import type { ChoiceMenu, ChoiceOption } from '../../server/src/world';

let pass = 0, fail = 0;
const ok = (c: boolean, what: string) => {
  if (c) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};

// (imports run before the settings above: set them here)
setMemorySettings({ on: true, clock: true, reflect: true, dayMs: 20 * 60000, notes: 8, chars: 2000, carry: false });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memunit-'));
initMemory(dir);
const MIN = 60000;
const T0 = 1_800_000_000_000;
const V = 'Testvale';
const spawn = (name: string, reset: boolean, at: number) => noteSpawn(V, name, { role: 'builder', brain: 'tiered', gamemode: 'survival', memory: { village: V, choose: 'model', plan: { goal: 'x', steps: [] } }, reset }, at);
const end = (name: string, kind: string, ok_: boolean, at: number, nm = `${kind} thing`) =>
  noteEnd(V, name, { kind, option: `${kind}:1`, name: nm, ok: ok_, productive: ok_, cut: false, minutes: 2, line: `${nm}: ${ok_ ? 'done' : 'failed (no mine)'}, 2 min`, message: ok_ ? 'done' : 'no mine here' }, at);

// A run begins with a spawn with reset
spawn('Ada', true, T0);
spawn('Ben', true, T0 + 1000);
const v0 = villageMemory(V)!;
ok(!!v0 && v0.epoch === T0, 'the run begins at the first reset spawn');
ok(rosterOf(V).length === 2 && (rosterOf(V)[0].memory as { plan?: unknown }).plan !== undefined, 'rosters kept as given (the plan object too)');

// The clock
const c1 = clockOf(V, T0 + 30000)!;
ok(c1.day === 1 && c1.phase === 'dawn', `day 1 dawn at +30 s (${c1.day} ${c1.phase})`);
ok(clockOf(V, T0 + 5 * MIN)!.phase === 'day', 'day at +5 min');
ok(clockOf(V, T0 + 16 * MIN)!.phase === 'dusk', 'dusk at +16 min');
ok(clockOf(V, T0 + 18 * MIN)!.phase === 'night', 'night at +18 min');
ok(clockOf(V, T0 + 21 * MIN)!.day === 2, 'day 2 at +21 min');
const offs = ['Ada', 'Ben', 'Clara', 'Dev'].map((n) => offsetIn(n, 'night'));
ok(offs.every((o) => o >= 0.85 && o < 1) && new Set(offs).size === 4, 'night offsets inside the window and distinct');

// Dawn decision: once a member-day
const dawnAt = T0 + offsetIn('Ada', 'dawn') * 20 * MIN + 1000;
ok(isDawnDecision(V, 'Ada', dawnAt), "Ada's first decision of day 1 is its dawn decision");
applyWrites(V, 'Ada', { intention: 'make tools all day', focus: 'making goods' }, 'decision', dawnAt);
ok(!isDawnDecision(V, 'Ada', dawnAt + MIN), 'not again that day');
ok(agentMemory(V, 'Ada')!.today?.focus === 'making goods', 'the focus kept');
applyWrites(V, 'Ben', { intention: 'x', focus: 'flying' }, 'decision', dawnAt);
ok(agentMemory(V, 'Ben')!.today?.focus === undefined, 'an unknown focus ignored');
applyWrites(V, 'Ben', { intention: 'gather eggs', focus: 'animal care' }, 'decision', dawnAt + 1);
ok(agentMemory(V, 'Ben')!.today?.focus === 'tending pens', 'a free-text focus normalised (animal care: tending pens)');

// Notes: add, the per-day cap, replace by id, eviction of the oldest when full
const t = T0 + 3 * MIN;
ok(applyWrites(V, 'Ada', { remember: 'charcoal before tools' }, 'decision', t)[0] === 'add', 'a note added');
applyWrites(V, 'Ada', { remember: 'the forge is slow' }, 'decision', t + 1);
applyWrites(V, 'Ada', { remember: 'Rosa needs planks' }, 'decision', t + 2);
ok(applyWrites(V, 'Ada', { remember: 'a fourth today' }, 'decision', t + 3)[0] === 'dropped', 'the per-day cap (3 a day from decisions)');
ok(applyWrites(V, 'Ada', { remember: 'charcoal before tools' }, 'night', t + 4)[0] === 'dropped', 'the same text twice dropped');
const r1 = applyWrites(V, 'Ada', { remember: 'tools first after all', replaces: 'n1' }, 'night', t + 5);
ok(r1[0] === 'replace n1' && agentMemory(V, 'Ada')!.notes.find((n) => n.id === 'n1')?.replaced === 'n4', 'replace by id keeps the old one, marked');
for (let i = 0; i < 6; i++) applyWrites(V, 'Ada', { remember: `night note ${i}` }, 'night', t + 10 + i);
const live = liveNotes(agentMemory(V, 'Ada'));
ok(live.length === MEMORY.notes, `the notes capped at ${MEMORY.notes} (${live.length})`);
ok(!live.some((n) => n.text === 'the forge is slow'), 'the oldest evicted when full and no id given');
ok(applyWrites(V, 'Ada', { remember: 'x'.repeat(400) }, 'night', t + 30).length === 2 && liveNotes(agentMemory(V, 'Ada')).every((n) => n.text.length <= 140), 'a long note cut to 140');

ok(applyWrites(V, 'Ben', { remember: 'n3: gather logs early' }, 'decision', t)[0] === 'add' && liveNotes(agentMemory(V, 'Ben')).some((n) => n.text === 'gather logs early'), 'an id before the note left out');
// Ends: the log and the kinds, importance
end('Ada', 'make', true, T0 + 4 * MIN);
end('Ada', 'make', true, T0 + 5 * MIN);
end('Ada', 'iron', false, T0 + 6 * MIN, 'Iron trip');
for (let i = 0; i < 6; i++) end('Ada', 'make', true, T0 + (7 + i) * MIN);
const a = agentMemory(V, 'Ada')!;
ok(a.kinds.make.n === 8 && a.kinds.iron.n === 1 && a.kinds.iron.ok === 0, 'the kind table');
ok(a.log[0].imp === 7 && a.log.find((e) => e.kind === 'iron')!.imp === 6, 'importance: a first success 7, a failure 6');
for (let i = 0; i < 70; i++) end('Ben', 'gather', i % 9 !== 0, T0 + i * 1000);
ok(agentMemory(V, 'Ben')!.log.length === 60, 'the log capped at 60');

// Recall: order, the earlier-today failure beyond the last chores, the cap
const rc = recall(V, 'Ada', T0 + 14 * MIN, { mark: false })!;
ok(rc.text.startsWith('What you remember (village day 1, day'), 'the head names the village day');
const order = ['Your intention today', 'Your notes', 'Your record', 'Earlier today'].map((s) => rc.text.indexOf(s));
ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), `the lines in order (${order})`);
ok(/Iron trip": failed/.test(rc.text), 'the failure beyond the last 5 chores shown');
ok(rc.text.length <= MEMORY.chars, `under the cap (${rc.text.length})`);
const small = recall(V, 'Ada', T0 + 14 * MIN, { cap: 700, mark: false })!;
ok(small.text.length <= 700 && small.text.includes('Your notes') && !small.text.includes('Your record'), 'a small cap drops from the bottom, keeps the notes');

// Save, load: recall reproduced exactly
noteIntent(V, 'Ada', { kind: 'make', what: 'Make charcoal', why: 'the forge needs it', since: T0, source: 'model' });
flushMemory();
const before = recall(V, 'Ada', T0 + 15 * MIN, { mark: false })!.text;
const json = serialiseMemory();
ok(fs.existsSync(path.join(dir, 'social.json')), 'social.json written');
initMemory(dir);
ok(serialiseMemory() === json, 'the file reloads to the same store');
ok(recall(V, 'Ada', T0 + 15 * MIN, { mark: false })!.text === before, 'recall reproduced after a reload');
ok(agentMemory(V, 'Ada')!.intent?.what === 'Make charcoal', 'the intent kept');

// A respawn without reset keeps memory and the run; a later reset spawn of one member does not restart the clock
spawn('Ada', false, T0 + 16 * MIN);
ok(liveNotes(agentMemory(V, 'Ada')).length === MEMORY.notes && villageMemory(V)!.epoch === T0, 'a respawn keeps the notes and the run');
spawn('Ben', true, T0 + 17 * MIN);
ok(villageMemory(V)!.epoch === T0, 'a reset spawn after a respawn does not restart the run');
ok(!agentMemory(V, 'Ben')!.log.length, "but empties that member's memory");
// a new process: the first reset spawn begins a new run
initMemory(dir);
spawn('Ada', true, T0 + 100 * MIN);
ok(villageMemory(V)!.epoch === T0 + 100 * MIN && !agentMemory(V, 'Ada')!.notes.length, 'a reset spawn in a new process begins a new run');

// The night: day lines, the village's, and the reflection (a fake model)
initMemory(dir);
loadMemory(json);
let asked = 0;
setReflectCall((async (req: { user: string; tools: unknown[] }) => {
  asked++;
  ok(req.user.includes('Your chores today') && req.user.includes('Iron trip'), "the reflection sees the day's chores");
  return { reply: { calls: [{ name: 'reflect', input: { notes: JSON.stringify([{ text: 'iron needs a mine first', replaces: 'n2' }]), intention: 'make tools again tomorrow', focus: 'making goods' } }], text: '' }, ms: 5, waitMs: 0 };
}) as never);
const night = T0 + offsetIn('Ada', 'night') * 20 * MIN + 2000;
tick(night, [{ name: V, members: [{ name: 'Ada', persona: 'You like making things.' }] }]);
await new Promise((r) => setTimeout(r, 50));
const an = agentMemory(V, 'Ada')!;
ok(asked === 1, 'one reflection call at the member night offset');
ok(an.days.length === 1 && /^Day 1: \d+ chores/.test(an.days[0].line), `the day line (${an.days[0]?.line})`);
ok(villageMemory(V)!.days.length === 1, 'the village day line');
ok(an.today?.day === 2 && an.today.by === 'night' && an.today.focus === 'making goods', "the night sets tomorrow's intention");
ok(liveNotes(an).some((n) => n.text === 'iron needs a mine first'), 'the night note kept (arguments as a string)');
tick(night + 1000, [{ name: V, members: [{ name: 'Ada', persona: '' }] }]);
await new Promise((r) => setTimeout(r, 20));
ok(asked === 1, 'once a night');
ok(!isDawnDecision(V, 'Ada', T0 + 20 * MIN + 5 * MIN), "no dawn intention needed when the night set one");
ok(parseReflect({ arguments: '{"notes":[],"intention":"x"}' })?.intention === 'x', 'parseReflect unwraps arguments');
ok(reflectPrompt(V, { name: 'Ada', persona: '' }, 1, night)!.tools[0].name === 'reflect', 'the reflect tool');
// days missed while down are closed without calls
closeAgentDays(V, 'Ben', 3);
ok(agentMemory(V, 'Ben')!.nightDone === 3, 'missed days closed');

// The chooser's prompt and tool, memory on and off
const opt = (id: string, name: string, kind = 'make') => ({ id, kind, key: `${kind}:${id}`, name, facts: '', effect: '', rank: 1 }) as unknown as ChoiceOption;
const menu = { agent: 'Ada', village: V, t: 0, options: [opt('a', 'Make torches'), opt('b', 'Iron trip', 'iron')], guarded: [], reasons: {}, ctx: { persona: 'You like making things.', village: '', others: '', outcomes: [] } } as unknown as ChoiceMenu;
const off = buildPrompt(menu, menu.options);
const rcOn = recall(V, 'Ada', T0 + 25 * MIN, { mark: false });
const onP = buildPrompt(menu, menu.options, { recall: rcOn, outcomes: ['Make torches: done, 1 min'] });
const props = (p: typeof off) => Object.keys((p.tools[0].input_schema as { properties: object }).properties).join(',');
ok(props(off) === 'reason,choice' && !off.user.includes('remember'), 'memory off: the tool and prompt as before');
ok(props(onP).startsWith('reason,choice,remember,replaces') && onP.user.includes('What you remember') && onP.system.endsWith('bears on the choice.'), 'memory on: the section, remember and replaces');
ok(onP.user.includes('Your last chores: Make torches: done, 1 min'), 'the last chores from the stored log after a restart');
setMemorySettings({ clock: true });
spawn('Cleo', true, T0 + 1);
// (a member with an empty memory, past its dawn offset: the head alone, and the intention asked)
const fresh = recall(V, 'Cleo', villageMemory(V)!.epoch + 2 * MIN, { mark: false });
const dawnP = buildPrompt({ ...menu, agent: 'Cleo' }, menu.options, { recall: fresh });
ok(!!fresh?.dawn && dawnP.user.includes('first choice of village day') && props(dawnP).includes('intention,focus'), 'an empty memory still asks for the day intention');

flushMemory();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${fail ? 'FAIL' : 'OK'} memory_unit: ${pass} of ${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);

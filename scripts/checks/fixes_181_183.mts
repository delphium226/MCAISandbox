/**
 * #181, #182 and #183 offline (no server):
 * - #181: when swim-ups mean trapped under water (a third within a minute and 3 blocks, or health at 10 or less), the trap
 *   places gathering keeps off, and a death as the choices' fact line, the prompt's "You lately" line and a memory note;
 * - #182: a first iron start that finds no cell is looked for again after its wait, not closed for good (and a village
 *   saved closed by the old code is due at once);
 * - #183: a status question gets the fact of the request it names (train 14's D: a house question answered with a torch
 *   promise's fact), and "right where you asked" / "right here" is dropped when code's facts put the building further off.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/fixes_181_183.mts
 */
process.env.MC_IRON_AGE = 'on';
process.env.MC_WORLD_MODE = 'damage';
import type { Mine, Village } from '../../server/src/village';
const H = await import('../../server/src/mineflayer/mcHazard');
const MM = await import('../../server/src/mineflayer/mcMine');
const T = await import('../../server/src/playerTalk');
const C = await import('../../server/src/choose');
const MEM = await import('../../server/src/memory');

let fails = 0;
const ok = (cond: unknown, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};

// ---- #181 ----
{
  const p = { x: -1682, y: 59, z: -3 }, t = 1000000;
  ok(!H.trappedUnderWater([{ p, t }], 20), 'one swim-up at full health: swim up');
  ok(!H.trappedUnderWater([{ p, t }, { p, t: t + 15000 }], 20), 'two: swim up');
  ok(H.trappedUnderWater([{ p, t }, { p, t: t + 15000 }, { p, t: t + 30000 }], 20), 'a third within the minute: trapped');
  ok(H.trappedUnderWater([{ p, t }], 10), 'health 10 under water: trapped at once');
  H.noteTrap({ x: -1682.4, y: 59.2, z: -2.7 }, t);
  ok(H.nearTrap({ x: -1680, y: 61, z: -3 }, 4, t + 60000), 'sand 2 blocks off the trap is kept off');
  ok(!H.nearTrap({ x: -1670, y: 61, z: -3 }, 4, t + 60000), '12 blocks off is not');
  ok(!H.nearTrap({ x: -1680, y: 61, z: -3 }, 4, t + 31 * 60000), 'the trap is forgotten after 30 minutes');
  const d = { cause: 'drowning' as const, place: '-1682,59,-3', t };
  const line = H.deathWords(d, t + 2 * 60000);
  ok(line === 'you drowned at -1682,59,-3 2 min ago and woke at home with your things; keep away from that place', `the choice fact: ${line}`);
  const mem = H.deathMemory(d);
  ok(mem === 'I drowned at -1682,59,-3; I keep away from there', `the memory note: ${mem}`);
  ok(H.deathMemory({ cause: 'mob', place: 'x' }).startsWith('I was killed'), 'a mob death in the first person');
  ok(MEM.checkNote('V', 'Uma', mem) === null, `the note passes the memory's checks in damage mode (${MEM.checkNote('V', 'Uma', mem)})`);
  const menu = { agent: 'Uma', village: 'V', t, options: [{ id: 'rest:Uma', kind: 'rest', name: 'Rest at home' }], guarded: [], reasons: {}, ctx: { harm: line } } as unknown as Parameters<typeof C.buildPrompt>[0];
  const user = C.buildPrompt(menu, menu.options).user;
  ok(user.includes(`You lately: ${line}.`), 'the choice prompt carries it');
  ok(!C.buildPrompt({ ...menu, ctx: {} } as typeof menu, menu.options).user.includes('You lately'), 'no line without a death');
}

// ---- #182 ----
{
  const notes: string[] = [];
  const reg = { note: (_v: Village, s: string) => void notes.push(s), save: () => undefined };
  const v = { name: 'D' } as unknown as Village;
  // (a mine at a level with no stairs column to start from: ironStart finds no cell, as train 14's D's did)
  const m = { top: { x: 0, y: 70, z: 0 }, dir: [1, 0], steps: 0, level: 60, dug: 0, ended: [], legs: [] } as unknown as Mine;
  ok(MM.ironStart(m) === null, 'the stub mine has no iron start');
  const now = Date.now();
  const i = MM.layIronStart(v, m, reg) as ReturnType<typeof MM.layIronStart> & { retryAt?: number; noStart?: boolean };
  ok(i.finished && i.noStart && i.retryAt !== undefined && i.retryAt > now, `the no-start waits (${i.finished}, retry in ${Math.round(((i.retryAt ?? 0) - now) / 60000)} min)`);
  ok(MM.ironDone(m, now), 'the dig option is off meanwhile');
  ok(!MM.ironDone(m, now + 6 * 60000), 'and back after the wait (the trip lays the start anew)');
  // (a village saved closed by the old code)
  const old = { top: { x: 0, y: 70, z: 0 }, dir: [1, 0], steps: 0, level: 60, dug: 0, ended: [], legs: [], iron: { x: 0, z: 0, y: 0, dir: [1, 0], steps: 0, legs: [], dug: 0, got: {}, finished: 'no clear way down beside the deepest level' } } as unknown as Mine;
  ok(!MM.ironDone(old, now), "train 14's D record is due at once");
  // (a level finished with no way down after its stairs were dug is not taken for a no-start)
  const dug = { ...old, iron: { x: 4, z: 0, y: 60, dir: [1, 0], steps: 12, legs: [], dug: 0, got: {}, finished: 'no clear way down beside the deepest level' } } as unknown as Mine;
  MM.ironDone(dug, now);
  ok(!(dug.iron as { noStart?: boolean }).noStart, 'a level closed after digging is not taken for a no-start (its own retry and shaft rules)');
}

// ---- #183 ----
{
  T.initTalk(null);
  const now = 200 * 60000;
  const h = T.addRequest({ village: 'D', from: 'Sam', to: 'Mayor', text: 'mayor, please build a house here', at: now - 45 * 60000, pos: { x: -1660, y: 66, z: 6 } });
  T.updateRequest(h.id, { kind: 'build', status: 'done', piece: 'houses', what: 'a street of houses for the 6 members without one', place: { words: 'here', kind: 'here', x: -1660, z: 6 }, closed: now - 7 * 60000 });
  const tq = T.addRequest({ village: 'D', from: 'Sam', to: 'Ada', text: 'Ada, could you make some torches?', at: now - 15 * 60000 });
  T.updateRequest(tq.id, { kind: 'promise', status: 'kept', option: 'make:torch', optionName: 'Make torches', closed: now - 7 * 60000 });
  const prog = (r: { id: string }) => (r.id === h.id ? { state: 'finished 7 min ago', where: 'north-west of the village, ~35 blocks, 4 buildings ~30-65 blocks from the place asked' } : { state: 'done 7 min ago' });
  for (const q of ['what happened with my house?', 'where is my house?', 'how is my house coming along?', 'is my home ready yet'])
    ok(T.statusFor('D', 'Sam', now, prog, q)?.includes('a street of houses'), `"${q}" gets the house's fact`);
  ok(T.statusFor('D', 'Sam', now, prog, 'are the torches done yet?')?.includes('Make torches'), 'a torch question gets the torch fact');
  ok(T.statusFor('D', 'Sam', now, prog, 'any news?')?.includes('a street of houses'), 'no words to match: the newest build');
  ok(T.statusFor('D', 'Ann', now, prog, 'where?') === null, 'none for a person with no requests');
  const far = 'a street of houses ... finished 35 min ago; north-west of the village, ~35 blocks, 4 buildings ~30-65 blocks from the place asked';
  const c = T.answerLine('Your new house was just finished a few minutes ago, right where you asked for it.', far);
  ok(!/right where/i.test(c) && c.startsWith('Your new house was just finished a few minutes ago - '), `train 14's C line loses its claim: ${c}`);
  const first = T.answerLine('Certainly, a new home will rise right here!', 'a street of houses for the 6 members without one, as near here as there is room (north-west of the village, ~40 blocks), after the houses under way');
  ok(!/right here/i.test(first) && first.startsWith('Certainly, a new home will rise - '), `the first answer too: ${first}`);
  const spot = T.answerLine('Your house was completed just a minute ago, right on the spot you requested.', far);
  ok(spot.startsWith('Your house was completed just a minute ago - '), `T1's "right on the spot you requested" goes whole: ${spot}`);
  const near = T.answerLine('Your house stands right where you asked.', 'finished 2 min ago; west of the village, ~5 blocks from the place asked');
  ok(/right where you asked/.test(near), `kept when the facts put it within 15 blocks: ${near}`);
  ok(T.answerLine('Right here is fine, thanks!', 'done 7 min ago') === 'Right here is fine, thanks - done 7 min ago', 'kept when the facts say nothing of a place');
}

console.log(fails ? `FIXES 181-183 FAIL (${fails})` : 'FIXES 181-183 OK');
process.exit(fails ? 1 : 0);

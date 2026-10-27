/**
 * #164's customs (customs.ts, spec 2.6), offline: the four templates, norms and sentences read as a custom (train 7's and
 * G3m1's decor and tools norms), refusals, offered by phase, seeds kept in the village's social memory with their persona
 * line, the ledger (seeded, did with first and after-exposure, started from a norm through rules.addLaw, exposed once a
 * day), the facts line (named, counted, the member's own last time; off with MC_CUSTOM_FACTS off), and the day's line.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/customs_unit.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'customs-unit-'));
process.env.MC_MEMORY = 'on';
process.env.MC_CLOCK = 'on';
process.env.MC_DAY_MIN = '20';
process.env.MC_RULES = 'on';
process.env.MCAI_ACTS_LOG = path.join(dir, 'acts.jsonl');

const mem = await import('../../server/src/memory');
const cu = await import('../../server/src/customs');
const rules = await import('../../server/src/rules');

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL ${what}`);
  }
};
const acts = () => fs.readFileSync(path.join(dir, 'acts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === 'custom');

// Off by default: nothing logged or shown
ok(!cu.CUSTOMS.on && !cu.CUSTOMS.facts, 'both flags off by default');

// Reading members' words (norm_classes.txt's decor and tools classes, and the other two templates)
const reads: Array<[string, string | null]> = [
  ['Each member must place at least one decorative item (e.g., flower, lantern) in a communal area daily to promote village pride.', 'green_stone'],
  ['Each member must contribute at least one decorative block to the communal aesthetic chest each week.', 'green_stone'],
  ['All members must return any borrowed tools to storage by dusk each day.', 'tools_dusk'],
  ['Members must return any borrowed tools to storage by dusk each day.', 'tools_dusk'],
  ['Every member puts a flower pot by their front door.', 'door_flower'],
  ['Hang a lantern at the entrance of your house.', 'door_flower'],
  ['Members gather at the green at dusk before the vote.', 'dusk_gathering'],
  ['Each member lights the houses with torches once a day.', null],
  ['Members must post a claim on the iron schedule board before digging.', null],
  ['Place torches along the path to the stone quarry.', null],
];
for (const [t, want] of reads) ok(cu.customOf(t) === want, `"${t.slice(0, 50)}..." is ${want} (${cu.customOf(t)})`);
ok('custom' in cu.readCustom('We meet at the green every evening.') && /only these customs/.test((cu.readCustom('We sing a song at dawn.') as { refused: string }).refused) && 'refused' in cu.readCustom('x'), 'the night sentence read or refused');

cu.setCustomsSettings({ on: true });
ok(cu.offered('green_stone', 'day') && !cu.offered('green_stone', 'night') && cu.offered('dusk_gathering', 'dusk') && !cu.offered('dusk_gathering', 'day') && !cu.offered('tools_dusk', 'dawn'), 'offered by phase');

mem.initMemory(dir);
const V = 'Customvale';
const epoch = 1950000000000;
const day = 20 * 60000;
mem.villageSocialOf(V, epoch);
const at = (d: number, f: number) => epoch + (d - 1) * day + f * day;
ok(mem.clockOf(V, at(3, 0.5))?.day === 3, `the clock (${mem.clockOf(V, at(3, 0.5))?.day})`);

// Seeds: kept in the village's social memory, a persona line, marked in the ledger
ok(cu.seed(V, ['Ada', 'Ben'], 'green_stone', undefined, at(1, 0.1)).length === 2 && cu.isSeeded(V, 'Ada') && !cu.isSeeded(V, 'Cara'), 'two seeded');
ok(/green's custom stone/.test(cu.seedLine(V, 'Ada')) && cu.seedLine(V, 'Cara') === '', `the seed's persona line (${cu.seedLine(V, 'Ada')})`);
ok(!!(mem.villageSocialOf(V) as { customs?: { seeds?: Record<string, unknown> } }).customs?.seeds?.Ben, 'seeds in the village social memory');
cu.seed(V, ['Dev'], 'door_flower', 'You like a lantern at your door.', at(1, 0.1));
ok(cu.seedLine(V, 'Dev') === 'You like a lantern at your door.', 'a persona given by the seeding call');

// The ledger: did (first, after exposure), exposed once a day, started from a norm through addLaw
cu.noteDid(V, 'Ada', 'green_stone', at(2, 0.3));
cu.noteDid(V, 'Ben', 'green_stone', at(2, 0.4));
cu.noteExposed(V, 'Cara', 'green_stone', at(2, 0.5));
cu.noteExposed(V, 'Cara', 'green_stone', at(2, 0.6));
cu.noteDid(V, 'Cara', 'green_stone', at(2, 0.7));
cu.noteDid(V, 'Cara', 'green_stone', at(2, 0.8));
cu.noteDid(V, 'Eli', 'green_stone', at(2, 0.8));
const a1 = acts();
ok(a1.filter((r) => r.op === 'exposed' && r.agent === 'Cara').length === 1, 'exposure logged once a day');
const caraDid = a1.filter((r) => r.op === 'did' && r.agent === 'Cara');
ok(caraDid.length === 2 && caraDid[0].first === true && caraDid[0].afterExposure === true && caraDid[1].first === undefined && caraDid[0].seeded === false, `first did after an exposure (${JSON.stringify(caraDid[0])})`);
ok(a1.find((r) => r.op === 'did' && r.agent === 'Ada')?.seeded === true && a1.find((r) => r.op === 'did' && r.agent === 'Eli')?.afterExposure === false, 'seeded marked; a first did with no exposure');
ok(cu.didOn(V, 'green_stone', 2).join() === 'Ada,Ben,Cara,Eli', 'the day\'s list, once a member');
const l = rules.addLaw(V, 'Finn', { what: 'Members must return any borrowed tools to storage by dusk each day.' }, at(2, 0.9));
const st = acts().find((r) => r.op === 'started');
ok(l.type === 'norm' && st?.custom === 'tools_dusk' && st.agent === 'Finn' && st.from === l.id, `a norm naming a custom starts it (${JSON.stringify(st)})`);

// The facts line: off without MC_CUSTOM_FACTS; named, counted, the member's own last time
ok(cu.customFacts(V, 'Gus', 'green_stone', at(3, 0.2)) === '', 'no facts with the flag off');
cu.setCustomsSettings({ facts: true });
ok(cu.customFacts(V, 'Gus', 'green_stone', at(3, 0.2)) === 'done yesterday by Ada, Ben and 2 others; you: never', cu.customFacts(V, 'Gus', 'green_stone', at(3, 0.2)));
ok(cu.customFacts(V, 'Ada', 'green_stone', at(3, 0.2)) === 'done yesterday by Ben, Cara and Eli; you: yesterday', cu.customFacts(V, 'Ada', 'green_stone', at(3, 0.2)));
ok(cu.customFacts(V, 'Ada', 'green_stone', at(5, 0.2)) === 'nobody did it yesterday; you: on day 2', cu.customFacts(V, 'Ada', 'green_stone', at(5, 0.2)));
ok(cu.customFacts(V, 'Gus', 'door_flower', at(3, 0.2)) === 'nobody did it yesterday; you: never', 'a custom nobody did');
ok(!/seed|persona|custom of your own/i.test(cu.customFacts(V, 'Gus', 'green_stone', at(3, 0.2))), 'no seed text in the facts');

// The day's line (chronicle, dawn news)
ok(cu.customsDayLine(V, 2) === "Customs on day 2: 4 members kept the green's stone." && cu.customsDayLine(V, 3) === '', cu.customsDayLine(V, 2));

// Off again: nothing more written
cu.setCustomsSettings({ on: false });
const n = acts().length;
cu.noteDid(V, 'Gus', 'green_stone', at(3, 0.3));
rules.addLaw(V, 'Hugo', { what: 'Every member puts a flower pot by their front door.' }, at(3, 0.3));
ok(acts().length === n && cu.customFacts(V, 'Gus', 'green_stone', at(3, 0.2)) === '' && cu.seed(V, ['Gus'], 'green_stone', undefined, at(3, 0.3)).length === 0, 'with MC_CUSTOMS off nothing is logged or shown');

console.log(`customs_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * The first vote's pure parts (server/src/vote.ts, spec runs/2026-10-16/s33/spec_vote1.md 5.1) checked offline: the style
 * option (facts within 200 chars, novelty, cost), the predicted ballot (a curious voter a new style, a sociable one the
 * current, an easy-going one the cheapest, a proud one the largest, ties drawn per voter; one option; all-equal options), the tally (plurality, the
 * seeded tie the same twice and one of the tied, no ballot -> the current), the ballot prompt (names only, the enum in shown
 * order, the persona clause only with a persona), castBallot with a fake call (a choice, an invalid reply, a thrown call)
 * and the predicted ballot's position.
 * Exits non-zero on any failure.
 * Usage: node_modules/.bin/tsx scripts/checks/vote_unit.mts
 */
import { buildBallot, castBallot, predictedBallot, predictedChoice, styleOption, tally, type VoteOption } from '../../server/src/vote';

let failures = 0, checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    process.stdout.write(`FAIL ${what}\n`);
  }
}
const Z = { curiosity: 0, care: 0, diligence: 0, pride: 0, sociability: 0 };

const house = (name: string, units: number, volume: number, gather: Record<string, number>) => ({ name, units, volume, gather });
const plains = styleOption('plains', [house('a', 110, 343, { oak_log: 50, cobblestone: 50 }), house('b', 112, 343, { oak_log: 56, cobblestone: 54 })], 1, true);
const savanna = styleOption('savanna', [house('c', 70, 383, { oak_log: 55, sand: 6 })], 0, false);
const desert = styleOption('desert', [house('d', 93, 166, { sandstone: 88, oak_log: 5 })], 0, false);
const opts: VoteOption[] = [plains, savanna, desert];
ok(opts.every((o) => o.facts.length > 0 && o.facts.length <= 200), 'facts 1-200 chars');
ok(plains.current && !plains.novel && savanna.novel && plains.units === 111, 'current, novel, mean units');
ok(/1 neighbourhood of them here/.test(plains.facts) && /none built here yet/.test(savanna.facts), 'built in the facts');
ok(/~53 oak log/.test(plains.facts), 'the main gathering, mean a house');

ok(predictedChoice({ ...Z, curiosity: 1 }, opts) === 'savanna', 'curious: a new style (savanna before desert by order)');
ok(predictedChoice({ ...Z, sociability: 1 }, opts) === 'plains', 'sociable: the current');
ok(predictedChoice({ ...Z, diligence: -1 }, opts) === 'savanna', 'easy-going: the cheapest (the critique M1)');
ok(predictedChoice({ ...Z, diligence: 1 }, opts) === 'plains', 'hard-working: does not mind the dearest');
ok(['savanna', 'desert'].includes(predictedChoice({ ...Z, curiosity: 1 }, [plains, desert, savanna], 'W1')!) && predictedChoice({ ...Z, curiosity: 1 }, [plains, desert, savanna], 'W1') === predictedChoice({ ...Z, curiosity: 1 }, [plains, desert, savanna], 'W1'), 'a tie drawn per voter, the same twice');
ok(predictedChoice({ ...Z, pride: 1 }, opts) === 'savanna', 'proud: the largest');
ok(predictedChoice({ ...Z, pride: 1, curiosity: -1 }, [plains, desert]) === 'plains', 'proud and homely, two options: plains');
ok(predictedChoice(Z, opts) === 'plains', 'zero: the first (ties by order)');
ok(predictedChoice({ ...Z, curiosity: 1 }, [savanna]) === 'savanna', 'one option');
ok(predictedChoice(Z, []) === null, 'no option: null');

const b = (agent: string, choice: string | null) => ({ agent, choice, reason: '', predicted: null, shown: [], source: 'model' as const });
const t1 = tally('v1', opts, [b('A', 'savanna'), b('B', 'savanna'), b('C', 'plains'), b('D', null)]);
ok(t1.winner === 'savanna' && t1.tally.savanna === 2 && t1.tally.plains === 1 && t1.tally.desert === 0 && !t1.tie, 'plurality, abstention not counted');
const t2 = tally('v2', opts, [b('A', 'savanna'), b('B', 'desert')]);
ok(t2.tie?.length === 2 && ['savanna', 'desert'].includes(t2.winner) && tally('v2', opts, [b('A', 'savanna'), b('B', 'desert')]).winner === t2.winner, 'tie: one of the tied, seeded');
ok(tally('v3', opts, [b('A', null)]).winner === 'plains', 'no ballot: the current');
ok(tally('v4', opts, [b('A', 'nonsense')]).winner === 'plains', 'a choice not on the ballot is not counted');

const p = buildBallot({ persona: 'You are curious.', pattern: 'Your last 3 chores: exploring 3', self: 'You built 2 houses here.', village: 'B: 4 houses' }, [desert, plains]);
const tool = p.tools[0] as { input_schema: { properties: { choice: { enum: string[] } } } };
ok(JSON.stringify(tool.input_schema.properties.choice.enum) === JSON.stringify(['Desert houses', 'Plains cottages']), 'the enum in shown order');
ok(/Vote as the person described would\./.test(p.system) && !/Vote as the person/.test(buildBallot({ persona: '', pattern: '', self: '', village: '' }, opts).system), 'persona clause only with a persona');
ok(p.user.includes('- Plains cottages:') && p.user.includes('(the current style)') && !/\n1\./.test(p.user), 'named, the current marked, not numbered');

const reply = (input: unknown) => async () => ({ ms: 5, waitMs: 0, reply: { text: '', calls: [{ name: 'vote', input }], promptTokens: 10, outputTokens: 2 } });
const spec = { provider: 'ollama', model: 'fake-local' } as never;
const base = { voteId: 'v9', agent: 'Worker3', spec, level: 'low' as const, options: opts, predicted: 'plains', ctx: { persona: '', pattern: '', self: '', village: '' } };
const c1 = await castBallot({ ...base, call: reply({ reason: 'cheap', choice: 'Savanna houses' }) as never });
ok(c1.choice === 'savanna' && c1.reason === 'cheap' && c1.position === c1.shown.indexOf('savanna') + 1 && c1.shown.length === 3, 'a choice parsed, its position as shown');
const c2 = await castBallot({ ...base, call: reply({ reason: 'x', choice: 'Castle' }) as never });
ok(c2.choice === null && c2.why === 'invalid', 'an invalid choice abstains');
const c3 = await castBallot({ ...base, call: (async () => { throw new Error('boom'); }) as never });
ok(c3.choice === null && c3.why === 'error', 'a thrown call abstains, never throws');
const pb = predictedBallot('v9', 'Worker3', opts, 'desert');
ok(pb.choice === 'desert' && pb.position === pb.shown.indexOf('desert') + 1 && pb.source === 'predicted', 'the predicted ballot');

process.stdout.write(`${failures ? 'FAIL' : 'OK'} vote_unit: ${checks - failures} of ${checks} checks passed\n`);
process.exit(failures ? 1 : 0);

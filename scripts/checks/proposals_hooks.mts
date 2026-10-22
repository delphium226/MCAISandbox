/**
 * G5's hooks in G2's files (#90), offline: the night's notes read in gpt-oss's shapes ({content, id}, {content, replace},
 * {id, text}); with MC_PROPOSALS the night's prompt and tool carry `propose` (and `back`) only on a night the day gave a
 * reason; a proposal from the reply checked by code and stored; backing counted only where the member's day touched the
 * target; an answer pinned in memory once and shown in the memory section, and reported in the inbox; the scripted
 * controller's proposal.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/proposals_hooks.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proposals-hooks-'));
process.env.MC_MEMORY = 'on';
process.env.MC_CLOCK = 'on';
process.env.MC_DAY_MIN = '20';
process.env.MC_PROPOSALS = 'on';
process.env.MCAI_SOCIAL = 'on';
process.env.MC_ACTS = 'on';
process.env.MCAI_ACTS_LOG = path.join(dir, 'acts.jsonl');

const mem = await import('../../server/src/memory');
const soc = await import('../../server/src/society');
const prop = await import('../../server/src/proposals');
const acts = await import('../../server/src/acts');
const { offlineCtx } = await import('../proposals_ctx.mts');

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL ${what}`);
  }
};

// #90: the parser's shapes
const pr = soc.parseReflect({ notes: [{ content: 'The pens need a gate on the east side', id: 'n2' }, { content: 'Keep charcoal for the furnaces', replace: 'n1' }], intention: 'x' });
ok(pr?.notes.length === 2 && pr.notes[0].text === 'The pens need a gate on the east side' && pr.notes[0].replaces === 'n2' && pr.notes[1].replaces === 'n1', `{content, id} and {content, replace} read (${JSON.stringify(pr?.notes)})`);
ok(soc.parseReflect({ notes: [{ id: 'n4', text: 'A note' }], intention: 'x' })?.notes[0].replaces === 'n4', '{id, text} read');

mem.initMemory(dir);
prop.initProposals(null);
const ctx = await offlineCtx('birch');
soc.setProposalCtx(() => ctx);
const V = 'Testvale';
const T0 = 1_900_000_000_000;
for (const n of ['Ada', 'Ben', 'Clara']) mem.noteSpawn(V, n, { role: 'worker', brain: 'tiered', memory: {}, reset: true }, T0);
const MIN = 60000;
const member = (name: string) => ({ name, persona: '' });
const end = (agent: string, ok2: boolean, at: number, name = 'Make torches') => mem.noteEnd(V, agent, { kind: 'make', option: 'make:torch', name, ok: ok2, productive: ok2, cut: false, minutes: 1, line: `${name}: ${ok2 ? 'done' : 'failed (no coal)'}, 1 min`, message: ok2 ? '' : 'no coal' }, at);

// A quiet day: no propose field
end('Ada', true, T0 + 2 * MIN);
const quiet = soc.reflectPrompt(V, member('Ada'), 1, T0 + 18 * MIN)!;
const props = (p: typeof quiet) => Object.keys((p.tools[0].input_schema as { properties: object }).properties);
ok(!props(quiet).includes('propose') && !quiet.user.includes('propose one improvement'), 'no propose field on a quiet day');
// A failed chore: the field and the line
end('Ben', false, T0 + 3 * MIN, 'Go fishing');
const ben = soc.reflectPrompt(V, member('Ben'), 1, T0 + 18 * MIN)!;
ok(props(ben).includes('propose') && ben.user.includes('propose one improvement'), 'the propose field after a failed chore');
const done = soc.applyProposal(V, 'Ben', { notes: [], intention: 'x', propose: { kind: 'item', what: 'Make a smithing table for better tools', why: 'our tools wear out' } }, 1);
const p1 = prop.allProposals(V)[0];
ok(done[0]?.startsWith('proposed p') && p1?.by === 'Ben' && p1.evidence.some((e) => e.ref === 'fail:Go fishing'), `stored with the day's failure as evidence (${done}; ${JSON.stringify(p1?.evidence)})`);
// Clara sees it to back; backing counts only when her day touched it
end('Clara', true, T0 + 4 * MIN, 'Look for a smithing table recipe');
const clara = soc.reflectPrompt(V, member('Clara'), 1, T0 + 18 * MIN)!;
ok(props(clara).includes('back') && clara.user.includes(`[${p1.id}] Ben:`), "Clara's night shows Ben's proposal to back");
const b1 = soc.applyProposal(V, 'Ada', { back: [{ id: p1.id }] }, 1);
ok(!b1.length && p1.endorsements.length === 0, "Ada's backing not counted: her day did not touch it");
const b2 = soc.applyProposal(V, 'Clara', { back: [p1.id] }, 1);
ok(b2.includes(`backed ${p1.id}`) && p1.endorsements.length === 1, `Clara's counted (${b2}; target ${JSON.stringify(p1.target)})`);

// An answer reaches the proposer and the backer once, pinned and in the inbox
prop.applyVerdict(p1.id, { by: 'triage', at: T0 + 30 * MIN, decision: 'accept', reason: 'a smithing table is a good next step', route: 'foundry' });
const line = prop.verdictLine(prop.proposal(p1.id)!);
ok(mem.noteAnswer(V, 'Ben', p1.id, line, T0 + 31 * MIN) && !mem.noteAnswer(V, 'Ben', p1.id, line, T0 + 32 * MIN), 'an answer pinned once');
acts.tellMember(V, 'Ben', line, T0 + 31 * MIN);
ok(acts.inbox(V, 'Ben', T0 + 33 * MIN).some((l) => l.startsWith('Your proposal "Make a smithing table')), 'and reported in the inbox');
const rc = mem.recall(V, 'Ben', T0 + 33 * MIN, { mark: false });
ok(!!rc?.text.includes('- Your proposal "Make a smithing table for better tools" was accepted'), 'shown in the memory section');
ok(mem.toldAnswer(V, 'Ben', p1.id) && !mem.toldAnswer(V, 'Clara', p1.id), 'told is kept per member');

// markTriage
const p2 = prop.addProposal({ village: V, by: 'Ada', kind: 'work', what: 'Build a fishing dock by the water for the fishers', why: 'x' }, ctx)!;
ok(prop.markTriage(p2.id) && prop.proposal(p2.id)!.status === 'triage' && !prop.markTriage(p2.id), 'marked for triage once');

console.log(`proposals_hooks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

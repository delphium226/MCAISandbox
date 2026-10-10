/**
 * Executor benchmark: real executor system prompt and skill tools, worker situations taken from the Oakridge run where
 * the executors went wrong. Scores whether the first call is the right skill with sensible arguments, and the latency.
 * Usage: tsx execbench.mts model1 model2 ...   Env: N (samples per case, default 10), THINK, OLLAMA_URL, PEEK=1.
 * Since A.0 the prompt and tools are the brain's own (EXEC_SYSTEM, toolsFor), so scores are not comparable with runs
 * before it; and gpt-oss numbers before A.0 were effectively at "medium" (Ollama ignores think:false for gpt-oss).
 */
import { TOOLS } from '../../server/src/skills';
import { EXEC_SYSTEM, toolsFor } from '../../server/src/tieredBrain';
import { chat, header, PEEK, REPEAT, Tally } from './benchUtil.mts';

const tools = toolsFor(TOOLS).exec;
const TIMES = REPEAT(10);

const VILLAGE = `Village Oakridge, objective: two matching cottages and a meeting hall
Prepared plots (level ground; build inside them):
- plot10: x 86..113, z -4..23, ground y=70, by Worker1
Buildings (do not overlap them):
- cottage at x 87..93, z -3..3 by Worker1
Design library (build with build_design):
- "cottage": 7x7, 5 high, A cozy cottage with oak log corners
- "meeting_hall": 11x11, 6 high, A stone brick hall`;
const OBS = (pos: string) => JSON.stringify({ position: pos, biome: 'savanna', time: 'day', health: 20, food: 20, holding: null, inventory: {}, visibleBlocks: { grass_block: '300 seen, nearest 110,70,4', oak_log: '4 seen, nearest 96,71,-8' }, nearby: [], currentAction: null, queuedActions: 0 });

const CASES: Array<{ name: string; user: string; ok: (c: { name: string; input: any }[]) => string | null }> = [
  {
    name: 'build cottage on prepared plot',
    user: `You are Worker2, role: builder, game mode: creative.\nObjective: two matching cottages and a meeting hall\n\n${VILLAGE}\n\nYour task t7: Build cottage 2: Build a cottage using the "cottage" design at x=110, z=0.\n\nPlan:\nGoal: Build cottage 2 using the 'cottage' design at x=110, z=0 on the prepared plot\n-> 1. build_design cottage at x=110 z=0\n\nWhat happened since your last turn:\n- [system] New plan: Build cottage 2\n\nObservation:\n${OBS('110,71,5')}`,
    ok: (c) => (c[0]?.name === 'build_design' && /cottage/i.test(c[0].input.design) && Math.abs(c[0].input.x - 110) <= 1 && Math.abs(c[0].input.z) <= 1 ? null : 'expected build_design cottage at 110,0'),
  },
  {
    name: 'prepare the plot (not explore)',
    user: `You are Worker1, role: builder, game mode: creative.\nObjective: two matching cottages and a meeting hall\n\nVillage Oakridge, objective: two matching cottages and a meeting hall\n\nYour task t5: Prepare the village plot: Prepare the village plot at x=100, z=10 (size 30x30) to clear trees and level the ground.\n\nPlan:\nGoal: Prepare the village plot at x=100, z=10\n-> 1. prepare_site x=100 z=10 width=30 depth=30\n\nWhat happened since your last turn:\n- none\n\nObservation:\n${OBS('122,72,0')}`,
    ok: (c) => (c[0]?.name === 'prepare_site' && Math.abs(c[0].input.x - 100) <= 1 && Math.abs(c[0].input.z - 10) <= 1 ? null : 'expected prepare_site at 100,10'),
  },
  {
    name: 'design missing: draw it',
    user: `You are Worker1, role: builder, game mode: creative.\nObjective: two matching cottages and a meeting hall\n\n${VILLAGE.replace(/- "meeting_hall".*\n?/, '')}\n\nYour task t8: Build meeting hall: Build a meeting hall using the "meeting_hall" design at x=100, z=20.\n\nPlan:\nGoal: Build the meeting hall at x=100, z=20\n-> 1. build_design meeting_hall at x=100 z=20\n\nWhat happened since your last turn:\n- [action_failed] build_design failed: no design called "meeting_hall" (available: "cottage"); if it is not drawn yet, draw it first with design_building name="meeting_hall" and a short brief, then build it\n\nObservation:\n${OBS('100,71,26')}`,
    ok: (c) => (c[0]?.name === 'design_building' && /meeting/i.test(c[0].input.name) ? null : 'expected design_building meeting_hall'),
  },
  {
    name: 'step already done',
    user: `You are Worker1, role: builder, game mode: creative.\n\n${VILLAGE}\n\nPlan:\nGoal: Build cottage 1 at x=90, z=0\n-> 1. build_design cottage at x=90 z=0\n\nWhat happened since your last turn:\n- [action_done] build_design finished: cottage recorded in village Oakridge at x 87..93, z -3..3; placed 169 blocks, cleared 0\n\nObservation:\n${OBS('90,71,6')}`,
    ok: (c) => (c.some((x) => x.name === 'step_done') && !c.some((x) => x.name === 'build_design') ? null : 'expected step_done (and no rebuild)'),
  },
];

const turn = (model: string, user: string) => chat(model, EXEC_SYSTEM, user, tools, { kind: 'exec' });

for (const model of process.argv.slice(2)) {
  header('execbench', model, 'exec');
  await turn(model, 'Say ok.'); // load
  const tally = new Tally();
  const perCase: string[] = [];
  for (const c of CASES) {
    let right = 0;
    for (let rep = 0; rep < TIMES; rep++) {
      const r = await turn(model, c.user);
      if (!r.ok) {
        tally.add(r, false);
        console.log(`error ${c.name}: ${r.error}`);
        continue;
      }
      const bad = c.ok(r.calls);
      tally.add(r, !bad);
      if (!bad) right++;
      console.log(`${(r.ms / 1000).toFixed(1).padStart(5)}s ${bad ? 'WRONG' : 'ok   '} ${c.name}: ${r.calls.map((x) => `${x.name}(${JSON.stringify(x.input)})`).join(' ').slice(0, 170) || '(no call)'}${bad ? ` -- ${bad}` : ''}`);
      if (PEEK) {
        console.log(`    raw calls: ${JSON.stringify(r.calls)}${r.text ? `\n    text: ${r.text.slice(0, 400)}` : ''}`);
        if (r.thinking) console.log(`    thinking (${r.thinking.length} chars): ${r.thinking.slice(0, 400)}`);
      }
    }
    perCase.push(`${right}/${TIMES} ${c.name}`);
  }
  console.log(perCase.map((x) => `  ${x}`).join('\n'));
  console.log(tally.line(model));
}

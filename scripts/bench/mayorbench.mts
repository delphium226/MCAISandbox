// The mayor's planner on the situations that went wrong in village runs, with the brain's real system prompt and tools,
// several times each: does it find a site and draw designs first, call plan_layout (not write tasks itself), and wait
// while the layout's tasks are under way? Run: node_modules/.bin/tsx scripts/bench/mayorbench.mts [model] [times]
// (default ollama gpt-oss:120b-cloud, 5 times; OLLAMA_URL for another server). PEEK=1 prints the raw tool calls.
import { TOOLS } from '../../server/src/skills';
import { plannerPrompt } from '../../server/src/tieredBrain';

const MODEL = process.argv[2] ?? 'gpt-oss:120b-cloud';
const TIMES = Number(process.argv[3] ?? 5);
const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
// (VANILLA=0: the prompt without V2.3's line about the vanilla library, as before it)
const VANILLA = process.env.VANILLA !== '0';
const { system, tools } = plannerPrompt('mayor', TOOLS, true, VANILLA);

const obs = '{"position":"-12,63,-82","biome":"savanna","time":"day","health":20,"food":20,"holding":null,"inventory":{},"visibleBlocks":{"acacia_log":"12 seen, nearest -5,64,-80"},"nearby":["Worker1 at -9,63,-80 (3m)","Worker2 at -10,63,-79 (4m)"]}';
const head = (why: string, objective: string) => `You are planning for Mayor, role: mayor, game mode: survival. Replanning because ${why}.\n\nObjective: ${objective}`;
const village = (objective: string, extra: string) => `Village Sunhollow, objective: ${objective}\n${extra}`;

type Call = { name: string; input: Record<string, unknown> };
const steps = (c: Call[]) => ((c.find((x) => x.name === 'set_plan')?.input.steps as unknown[]) ?? []).map((s) => (typeof s === 'string' ? s : JSON.stringify(s)));
const layout = (c: Call[]) => c.find((x) => x.name === 'plan_layout');
const posted = (c: Call[]) => ((c.find((x) => x.name === 'post_tasks')?.input.tasks as unknown[]) ?? []).length;
const workerJob = /\b(collect|mine|craft|smelt|place|deposit|withdraw|prepare_site|build_design|build_box|gather)\b/i;
const names = (c: Call[]) => ((layout(c)?.input.buildings as unknown[]) ?? []).map((b) => String(typeof b === 'object' && b ? (b as Record<string, unknown>).design ?? (b as Record<string, unknown>).name : b).toLowerCase()).sort().join(',');

const CASES: Array<[string, string, (c: Call[]) => boolean]> = [
  ['first plan: site and designs', [
    head('there is no plan yet', 'one small cottage'),
    village('one small cottage', ''),
    'Previous plan:\n(no plan yet)', 'Events since the last plan:\n- [system] You are Mayor, a mayor. You just arrived in the world.', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => steps(c).some((s) => /find_site/.test(s)) && (VANILLA || steps(c).some((s) => /design_building/.test(s))) && !steps(c).some((s) => workerJob.test(s) && !/design_building|find_site/.test(s)) && !posted(c)],
  ['site found, design ready: plan_layout', [
    head('you found a site (find_site finished: site found: centre x=-12 z=-82, ground y=63, 30x30, height range 1): draw any design still missing, then call plan_layout', 'one small cottage'),
    village('one small cottage', 'Design library (build with build_design):\n- "cottage": 7x7, 5 high, a small oak cottage'),
    'Previous plan:\nGoal: choose the site and draw the cottage\n[x] 1. find_site size=30\n[x] 2. design_building name=cottage', 'Events since the last plan:\n- [action_done] find_site finished: site found: centre x=-12 z=-82\n- [system] design "cottage" saved: 7x7', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => names(c) === 'cottage' && !posted(c)],
  ['layout under way: wait', [
    head('no step has been completed for 3 minutes', 'one small cottage'),
    village('one small cottage', 'Prepared plots (level ground; build inside them):\n- plot1: x -18..-6, z -88..-76, ground y=63, by Worker1\nDesign library (build with build_design):\n- "cottage": 7x7, 5 high, a small oak cottage\nVillage storage (deposit / withdraw; chest at -12,64,-72): 12 cobblestone, 4 acacia_log\nTask board:\n- t2 [claimed by Worker2] Gather 17 cobblestone for cottage (1/2): collect block=cobblestone count=17, then deposit item=all\n- t3 [claimed by Worker1] Gather 12 logs for cottage (1/2): collect block=logs count=12, then deposit item=all\n- t4 [open] Gather 11 logs for cottage (2/2) (after t9)\n- t5 [open] Build cottage (after t0, t2, t3, t4): build_design "cottage" x=-12 z=-82\n- t0 [done by Worker1] Prepare the village plot\n- t9 [done by Worker2] Set up the village storage'),
    'Previous plan:\nGoal: coordinate the village (waiting)', 'Events since the last plan:\n- [system] Laid out 1 buildings on a 13x13 plot ... and posted 8 tasks. Now wait for the workers.', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => !posted(c) && !layout(c) && !steps(c).some((s) => workerJob.test(s))],
  ['build requeued behind code-posted gathering: wait', [
    head('a task failed: t3 "Gather 12 logs for cottage (1/2)" (only found 9 logs; none left within 96 blocks of the village)', 'one small cottage'),
    village('one small cottage', 'Prepared plots (level ground; build inside them):\n- plot1: x -18..-6, z -88..-76, ground y=63, by Worker1\nDesign library (build with build_design):\n- "cottage": 7x7, 5 high, a small oak cottage\nVillage storage (deposit / withdraw; chest at -12,64,-72): 21 acacia_log, 34 cobblestone, 1 sand\nTask board:\n- t5 [open] Build cottage (after t0, t2, t3, t4, t12): build_design "cottage" x=-12 z=-82\n- t12 [claimed by Worker2] Gather 3 logs for cottage: collect block=logs count=3, then deposit item=all\n- t3 [failed] Gather 12 logs for cottage (1/2) -> only found 9 logs; none left within 96 blocks of the village'),
    'Board status:\nWorkers busy: Worker2 is doing t12 "Gather 3 logs for cottage".\nWaiting: t5 waits for t12 (claimed) (materials were short; code posted these).\nNothing for you to do: the workers and code handle this; wait (set_plan with an empty list).',
    'Previous plan:\nGoal: coordinate the village (waiting)', 'Events since the last plan:\n- [system] t5 "Build cottage" waits for t12: materials were short', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => !posted(c) && !layout(c) && !steps(c).some((s) => workerJob.test(s))],
  ['build failed hard: re-post the build, not gathering', [
    head('a task failed: t5 "Build cottage" (build_design failed: cannot work at x -15..-9, z -85..-79: Worker1 has reserved it)', 'one small cottage'),
    village('one small cottage', 'Prepared plots (level ground; build inside them):\n- plot1: x -18..-6, z -88..-76, ground y=63, by Worker1\nDesign library (build with build_design):\n- "cottage": 7x7, 5 high, a small oak cottage\nVillage storage (deposit / withdraw; chest at -12,64,-72): 31 acacia_log, 34 cobblestone, 1 sand\nTask board:\n- t5 [failed] Build cottage: build_design "cottage" x=-12 z=-82 (on the village plot; footprint x -15..-9, z -85..-79) -> cannot work there: Worker1 has reserved it\n- t0 [done by Worker1] Prepare the village plot\n- t3 [done by Worker1] Gather 12 logs for cottage (1/2)'),
    'Board status:\nNo worker holds a task.',
    'Previous plan:\nGoal: coordinate the village (waiting)', 'Events since the last plan:\n- [system] t5 failed', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => posted(c) >= 1 && !((c.find((x) => x.name === 'post_tasks')?.input.tasks as unknown[]) ?? []).some((t) => /gather|collect/i.test(JSON.stringify(t))) && !layout(c)],
  ['two cottages and a hall: plan_layout', [
    head('you found a site (find_site finished: site found: centre x=40 z=-100, ground y=70, 30x30, height range 1): draw any design still missing, then call plan_layout', 'two matching cottages and a meeting hall'),
    village('two matching cottages and a meeting hall', 'Design library (build with build_design):\n- "cottage": 7x7, 5 high, a small oak cottage\n- "meeting_hall": 11x11, 6 high, a hall of planks and cobblestone'),
    'Previous plan:\nGoal: site and designs\n[x] 1. find_site size=30\n[x] 2. design_building name=cottage\n[x] 3. design_building name=meeting_hall', 'Events since the last plan:\n- [action_done] find_site finished: site found: centre x=40 z=-100', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => names(c) === 'cottage,cottage,meeting_hall' && !posted(c)],
  // Site too small (Fourfold7: the mayor explored 500 blocks away): plan_layout placed what fits, the rest needs a site
  ['partial layout: find a second site nearby', [
    head('plan_layout placed only part of the village; meeting_hall needs a second site: Find a second site for it: find_site size=9 (it keeps off this plot), then plan_layout with "meeting_hall". The workers start on this plot meanwhile.', 'two matching cottages and a meeting hall'),
    village('two matching cottages and a meeting hall', 'Not laid out yet (no room on the first site; they need a second site, then plan_layout): meeting_hall\nDesign library (build with build_design):\n- "cottage": 5x5, 5 high, a small acacia cottage\n- "meeting_hall": 7x7, 6 high, a hall of planks and cobblestone\nTask board:\n- t1 [claimed by Worker1] Prepare the village plot: prepare_site x=-195 z=-97 width=7 depth=14\n- t2 [claimed by Worker2] Set up the village storage\n- t3 [open] Gather 10 logs for cottage 1 (1/2) (after t2)\n- t8 [open] Build cottage 1 (after t1, t3): build_design "cottage" x=-195 z=-100\n- t15 [open] Build cottage 2 (after t1): build_design "cottage" x=-195 z=-93'),
    'Previous plan:\nGoal: site and designs\n[x] 1. find_site size=30\n[x] 2. design_building name=cottage\n[x] 3. design_building name=meeting_hall',
    'Events since the last plan:\n- [system] Laid out 2 buildings on a 7x14 plot at x -198..-192, z -104..-91 (cottage at -195,-100; cottage at -195,-93) and posted 16 tasks. Not laid out, no room on this 14x14 site: meeting_hall. Find a second site for it: find_site size=9 (it keeps off this plot), then plan_layout with "meeting_hall". The workers start on this plot meanwhile.', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => steps(c).some((s) => /find_site/.test(s)) && !steps(c).some((s) => /explore|move_to/.test(s)) && !posted(c)],
  ['plan_layout refused, site too small: find_site bigger', [
    head('plan_layout was refused: the site is only 12x12; only meeting_hall would fit, and all 3 need 16x16; run find_site size=16 (it searches farther out by itself), then plan_layout again', 'two matching cottages and a meeting hall'),
    village('two matching cottages and a meeting hall', 'Design library (build with build_design):\n- "cottage": 5x5, 5 high, a small acacia cottage\n- "meeting_hall": 7x7, 6 high, a hall of planks and cobblestone'),
    'Previous plan:\nGoal: site and designs\n[x] 1. find_site size=12\n[x] 2. design_building name=cottage\n[x] 3. design_building name=meeting_hall',
    'Events since the last plan:\n- [action_done] find_site finished: site found (12x12, the largest within 112 blocks; 30x30 does not fit): centre x=-195 z=-97\n- [system] plan_layout: the site is only 12x12; only meeting_hall would fit, and all 3 need 16x16; run find_site size=16 (it searches farther out by itself), then plan_layout again', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => steps(c).some((s) => /find_site/.test(s) && Number(/size\D*(\d+)/.exec(s)?.[1] ?? 0) >= 16) && !steps(c).some((s) => /explore|move_to/.test(s)) && !posted(c) && !layout(c)],
  // V2.3: the library filled with the land's vanilla houses after find_site (the line fillVanilla adds to the reason)
  ...(VANILLA ? [['vanilla library: plan_layout with siblings', [
    head(`you found a site (find_site finished: site found: centre x=40 z=-100, ground y=70, 30x30, height range 1). The design library now holds this land's own buildings (vanilla plains), ready to build: plains_small_house_1 (7x7), plains_small_house_2 (7x7), plains_small_house_3 (7x7), plains_small_house_4 (7x7), plains_cartographer_1 (7x10), plains_fisher_cottage_1 (7x8), plains_library_2 (9x8, a landmark). Use them in plan_layout (two matching houses: siblings such as plains_small_house_1 and plains_small_house_2); draw a design only for a kind of building they do not cover: draw any design still missing, then call plan_layout`, 'two matching cottages and a meeting hall'),
    village('two matching cottages and a meeting hall', 'Design library (build with build_design):\n- "plains_small_house_1": 7x7, 7 high, vanilla plains_small_house_1 (plains), entrance south\n- "plains_small_house_2": 7x7, 7 high, vanilla plains_small_house_2 (plains), entrance south\n- "plains_small_house_3": 7x7, 7 high, vanilla plains_small_house_3 (plains), entrance south\n- "plains_small_house_4": 7x7, 7 high, vanilla plains_small_house_4 (plains), entrance south\n- "plains_cartographer_1": 7x10, 8 high, vanilla plains_cartographer_1 (plains), entrance south\n- "plains_fisher_cottage_1": 7x8, 7 high, vanilla plains_fisher_cottage_1 (plains), entrance south\n- "plains_library_2": 9x8, 10 high, vanilla plains_library_2 (plains), entrance south'),
    'Previous plan:\nGoal: choose the site\n[x] 1. find_site size=30', 'Events since the last plan:\n- [action_done] find_site finished: site found: centre x=40 z=-100', `Observation:\n${obs}`,
  ].join('\n\n'), (c: Call[]) => {
    const n = names(c).split(',').filter(Boolean);
    const smalls = new Set(n.filter((x) => /small_house/.test(x)));
    // plan_layout with the library's names only, two different small houses and the landmark as the hall, or a design
    // step for the hall first (the review: three small houses, or an undrawn meeting_hall, passed before)
    const listed = /^plains_(small_house_[1-4]|cartographer_1|fisher_cottage_1|library_2)$/;
    return !posted(c) && ((smalls.size >= 2 && n.length === 3 && n.every((x) => listed.test(x)) && n.includes('plains_library_2'))
      || (!layout(c) && steps(c).some((s) => /design_building/.test(s) && /hall/i.test(s))));
  }] as [string, string, (c: Call[]) => boolean]] : []),
  // F155 (Minevale26's second call): the same vanilla line, but the previous plan still holds its two unrun design steps
  // (gpt-oss answered "prepare_site, wait" there; Minevale25 called plan_layout on the same prompt)
  // (and with the proposed end of find_site's reason when the library is filled: "call plan_layout now", not "draw ...")
  ...(VANILLA ? ([['F155: vanilla library, stale design steps: plan_layout', ': draw any design still missing, then call plan_layout'],
    ['F155: vanilla library, stale design steps, reason ends "now"', ': call plan_layout now']] as Array<[string, string]>).map(([label, tail]) => [label, [
    head(`you found a site (find_site finished: site found: centre x=-1628 z=47, ground y=65, 40x40, height range 2, 2212 tree blocks to clear, 12 blocks away. 1162 log blocks within 48 bl). The design library now holds this land's own buildings (vanilla plains), ready to build: plains_small_house_1 (7x7), plains_small_house_2 (7x7), plains_small_house_3 (7x7), plains_small_house_4 (7x7), plains_cartographer_1 (7x10), plains_fisher_cottage_1 (7x8), plains_library_2 (9x8, a landmark: it can be the hall; a village has room for one building like it). Use them in plan_layout (two matching houses: siblings such as plains_small_house_1 and plains_small_house_2); draw a design only for a kind of building they do not cover${tail}`, 'two matching cottages and a meeting hall'),
    village('two matching cottages and a meeting hall', 'Design library (build with build_design):\n- "plains_small_house_1": 7x7, 7 high, vanilla plains_small_house_1 (plains), entrance south\n- "plains_small_house_2": 7x7, 7 high, vanilla plains_small_house_2 (plains), entrance south\n- "plains_small_house_3": 7x7, 7 high, vanilla plains_small_house_3 (plains), entrance south\n- "plains_small_house_4": 7x7, 7 high, vanilla plains_small_house_4 (plains), entrance south\n- "plains_cartographer_1": 7x10, 8 high, vanilla plains_cartographer_1 (plains), entrance south\n- "plains_fisher_cottage_1": 7x8, 7 high, vanilla plains_fisher_cottage_1 (plains), entrance south\n- "plains_library_2": 9x8, 10 high, vanilla plains_library_2 (plains), entrance south\nRecent village events:\n- the design library holds plains\'s vanilla buildings: plains_small_house_1, plains_small_house_2, plains_small_house_3, plains_small_house_4, plains_cartographer_1, plains_fisher_cottage_1, plains_library_2'),
    'Previous plan:\nGoal: Establish two matching cottages and a meeting hall for Minevale26\n[x] 1. find_site size=30\n-> 2. design_building brief=A small 7x7 house using oak planks, oak logs, and cobblestone. Includes a door, windows, a roof, and a small garden. Matches the biome\'s birch/oak style. name=cottage\n[ ] 3. design_building brief=A larger 11x11 community hall using oak planks, cobblestone, and glass panes. Simple roof, central open area, and a door facing the street. name=meeting_hall',
    'Events since the last plan:\n- [system] New plan: Establish two matching cottages and a meeting hall for Minevale26 | 1. find_site size=30 2. design_building brief=A small 7x7 house using oak planks, oak logs, and cobblestone. Includes a door, windows, a roof, and a small garden. Matches the biome\'s birch/oak style. name=cottage 3. design_building brief=A larger 11x11 community hall using oak planks, cobblestone, and glass panes. Simple roof, central open area, and a door facing the street. name=meeting_hall\n- [system] find_site size raised to 40: the first site needs room for the whole village\n- [action_done] find_site finished: site found: centre x=-1628 z=47, ground y=65, 40x40, height range 2, 2212 tree blocks to clear, 12 blocks away. 1162 log blocks within 48 blocks (mostly birch).',
    'Observation:\n{"position":"-1617,65,40","biome":"birch_forest","time":"day","health":20,"food":20,"holding":null,"inventory":{},"visibleBlocks":{"birch_log":"40 seen, nearest -1620,65,44"},"nearby":["Worker1 at -1615,65,38 (3m)","Worker2 at -1614,65,41 (3m)"]}',
  ].join('\n\n'), (c: Call[]) => {
    const n = names(c).split(',').filter(Boolean);
    const smalls = new Set(n.filter((x) => /small_house/.test(x)));
    // (a small house named twice is fine: plan_layout swaps the second for an unused sibling, lesson 65; a layout with a
    // drawn "cottage" fails here: it works, but is not the library's village)
    return !posted(c) && smalls.size >= 1 && n.filter((x) => /small_house/.test(x)).length >= 2 && n.length === 3 && n.includes('plains_library_2') && n.every((x) => /^plains_/.test(x));
  }] as [string, string, (c: Call[]) => boolean]) : []),
  // F155's nudge after a plan of only "wait" (site found, library filled, nothing laid out): today's reason (Minevale26
  // drew a 13x13 hall on it) and the proposed one naming the library's buildings
  ...(VANILLA ? ([
    ['F155: nudge after a wait plan, today\'s reason', 'nothing is laid out yet, so there is nothing to wait for: draw any design the objective still needs (design_building steps), then call plan_layout'],
    ['F155: nudge after a wait plan, library named', 'nothing is laid out yet, so there is nothing to wait for. The site is found and the design library holds buildings ready to build: plains_small_house_1, plains_small_house_2, plains_small_house_3, plains_small_house_4, plains_cartographer_1, plains_fisher_cottage_1, plains_library_2 (a landmark: it can be the hall). Call plan_layout now with one design name per building of the objective (matching houses are siblings such as plains_small_house_1 and plains_small_house_2); draw a design only for a kind of building none of them is'],
    // (Minevale26's library also held the "cottage" plan 1's stale step drew; layoutNow lists it as drawn)
    ['F155: nudge after a wait plan, library named, a drawn cottage', 'nothing is laid out yet, so there is nothing to wait for. The site is found and the design library holds buildings ready to build: plains_small_house_1, plains_small_house_2, plains_small_house_3, plains_small_house_4, plains_cartographer_1, plains_fisher_cottage_1, plains_library_2 (a landmark: it can be the hall); drawn: cottage. Call plan_layout now with one design name per building of the objective (matching houses are siblings such as plains_small_house_1 and plains_small_house_2); draw a design only for a kind of building none of them is'],
  ] as Array<[string, string]>).map(([label, why]) => [label, [
    head(why, 'two matching cottages and a meeting hall'),
    village('two matching cottages and a meeting hall', 'Design library (build with build_design):\n' + (/drawn: cottage/.test(why) ? '- "cottage": 9x9, 8 high, A small 7x7 oak-plank cottage on a cobblestone base with oak-log framing, a gable roof of oak stairs, and a south-facing door\n' : '') + '- "plains_small_house_1": 7x7, 7 high, vanilla plains_small_house_1 (plains), entrance south\n- "plains_small_house_2": 7x7, 7 high, vanilla plains_small_house_2 (plains), entrance south\n- "plains_small_house_3": 7x7, 7 high, vanilla plains_small_house_3 (plains), entrance south\n- "plains_small_house_4": 7x7, 7 high, vanilla plains_small_house_4 (plains), entrance south\n- "plains_cartographer_1": 7x10, 8 high, vanilla plains_cartographer_1 (plains), entrance south\n- "plains_fisher_cottage_1": 7x8, 7 high, vanilla plains_fisher_cottage_1 (plains), entrance south\n- "plains_library_2": 9x8, 10 high, vanilla plains_library_2 (plains), entrance south\nRecent village events:\n- the design library holds plains\'s vanilla buildings: plains_small_house_1, plains_small_house_2, plains_small_house_3, plains_small_house_4, plains_cartographer_1, plains_fisher_cottage_1, plains_library_2'),
    'Previous plan:\nGoal: Build two matching cottages and a meeting hall on the 40x40 site centred at x=-1628 z=47 for Minevale26 (waiting)',
    // (the wait plan is dropped before it runs, F155's fix: this event, not the wait's action_done)
    'Events since the last plan:\n- [system] Dropped plan steps that only wait or watch: nothing is laid out yet (wait)',
    'Observation:\n{"position":"-1617,65,40","biome":"birch_forest","time":"day","health":20,"food":20,"holding":null,"inventory":{},"visibleBlocks":{"birch_log":"40 seen, nearest -1620,65,44"},"nearby":["Worker1 at -1615,65,38 (3m)","Worker2 at -1614,65,41 (3m)"]}',
  ].join('\n\n'), (c: Call[]) => {
    const n = names(c).split(',').filter(Boolean);
    const smalls = new Set(n.filter((x) => /small_house/.test(x)));
    // (a small house named twice is fine: plan_layout swaps the second for an unused sibling, lesson 65; a layout with a
    // drawn "cottage" fails here: it works, but is not the library's village)
    return !posted(c) && smalls.size >= 1 && n.filter((x) => /small_house/.test(x)).length >= 2 && n.length === 3 && n.includes('plains_library_2') && n.every((x) => /^plains_/.test(x));
  }] as [string, string, (c: Call[]) => boolean]) : []),
  ['second site found: plan_layout the rest', [
    head('you found a site (find_site finished: site found: centre x=-170 z=-120, ground y=70, 9x9, height range 1, 0 tree blocks to clear, 24 blocks away): draw any design still missing, then call plan_layout', 'two matching cottages and a meeting hall'),
    village('two matching cottages and a meeting hall', 'Not laid out yet (no room on the first site; they need a second site, then plan_layout): meeting_hall\nDesign library (build with build_design):\n- "cottage": 5x5, 5 high, a small acacia cottage\n- "meeting_hall": 7x7, 6 high, a hall of planks and cobblestone\nTask board:\n- t1 [done by Worker1] Prepare the village plot\n- t8 [claimed by Worker2] Build cottage 1: build_design "cottage" x=-195 z=-100\n- t15 [open] Build cottage 2 (after t1): build_design "cottage" x=-195 z=-93'),
    'Previous plan:\nGoal: find a site for the meeting hall\n[x] 1. find_site size=9',
    'Events since the last plan:\n- [action_done] find_site finished: site found: centre x=-170 z=-120, ground y=70, 9x9', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => names(c).split(',').includes('meeting_hall') && !posted(c)],
];

console.log(`=== ${MODEL}, ${TIMES} times each`);
let good = 0, total = 0;
for (const [label, user, ok] of CASES) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY, 'i').test(label)) continue;
  let n = 0;
  const times: number[] = [];
  // What each answer did, whether it passed or not (F155: plan_layout, a design step, only waiting, or something else)
  const kinds: Record<string, number> = {};
  for (let i = 0; i < TIMES; i++) {
    const t0 = Date.now();
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        model: MODEL, stream: false, think: false, options: { num_ctx: 8192, temperature: 0.4 },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      }),
    });
    const data = (await res.json()) as { message?: { tool_calls?: Array<{ function: { name: string; arguments: unknown } }> } };
    const calls: Call[] = (data.message?.tool_calls ?? []).map((c) => ({ name: c.function.name, input: (typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments) : c.function.arguments) as Record<string, unknown> }));
    times.push(Date.now() - t0);
    const pass = ok(calls);
    if (pass) n++;
    const kind = layout(calls) ? 'layout' : posted(calls) ? 'post' : steps(calls).some((s) => /design_building/.test(s)) ? 'design'
      : steps(calls).some((s) => /find_site/.test(s)) ? 'find_site' : steps(calls).every((s) => !/\b(explore|move_to|chat)\b/.test(s)) ? 'wait' : 'other';
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (process.env.PEEK || !pass) console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(calls).slice(0, 400)}`);
  }
  good += n;
  total += TIMES;
  console.log(`${n}/${TIMES}  ${label}  (${(times.reduce((s, t) => s + t, 0) / times.length / 1000).toFixed(1)}s avg; ${Object.entries(kinds).map(([k, q]) => `${q} ${k}`).join(', ')})`);
}
console.log(`${MODEL}: ${good}/${total}`);

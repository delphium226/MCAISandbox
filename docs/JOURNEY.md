# The journey so far

A short, readable story of the project, for anyone who wants the arc rather than the logs. Update it every so often
(add to the latest act or start a new one, and refresh the numbers); the detail lives in `HISTORY.md`, `FINDINGS.md`
and `LESSONS.md`.

*Last updated 2026-10-21 (session 43): 25 September to 21 October 2026, 43 sessions, 313 commits.*

## Act I: A world of its own (25-26 September)

It started as a voxel sandbox you could play in a browser, with a WebGL client, a server that decides what happens, and
agents controlled over a REST API. Within a day it had cliffs, lava, fences and its first agent brains. Then came the
decision that shaped everything after: the brains were separated from the sandbox behind a world interface, so the same
agent could live in any world.

## Act II: Into real Minecraft (26-27 September)

Mineflayer bots joined a Paper server. In the first survival runs, zombies kept killing them before they could finish a
pickaxe, so the world became peaceful: no hostile mobs, no damage, and work to gather and craft. On 27 September the
first real village, **Elmfield**, was finished in 11 minutes. A Mayor planned it, a model-designed architect drew it,
and two workers built two cottages and a meeting hall.

## Act III: An economy, not creative mode (27 September to early October)

Buildings now cost real materials. Workers fell trees, mine, smelt, store goods in shared huts and build from their own
inventories. Acceptance runs tested every step, and each failure became a finding (F24, F25 and on). Wood counts were
short, the pathfinder dug through ground it shouldn't, bots were set back by invisible box overlaps, and a door written
with its facing was read as no door at all. A fixed test world built from the seed made staged runs repeatable, and
**Minevale22** became the first village to pass cleanly: 6 of 6 tasks, 0 failed actions.

## Act IV: Life after the build (October)

A finished village shouldn't go quiet, so the agents got things to do once building ended: chores, farms, pens, food
and appetite, neighbourhoods that grow until every member has a house, a merchant, fishing and trade. Every model call
is now recorded and can be replayed for free. Most roles moved to gpt-oss on Ollama Cloud, with the two 3090s as the
local fallback.

## Act V: The village learns to grow itself (16-21 October)

Two larger tools arrived:

- **The skill foundry:** a self-improving loop in which agents propose new skills, a dedicated test world checks them,
  and the ones that pass every gate merge themselves into the branch.
- **The village simulator:** it runs 30 minutes of village life in about 10 seconds, and it matched the spread of real
  staged runs.

Then came the economy experiments: ownership, barter, and innovation, where inventors unlock techniques and get paid in
pledges. Eco1 and Eco2 ran with 25 agents for 95 minutes. They kept 16-20% of members busy, close to the simulator's
18.7% prediction.

## By the numbers

265 findings, 157 lessons, about 50 check scripts, and 24 workers with real names, from Ada to Xavier.

## Next

Research points and life goals (including beauty), with the big aim unchanged: 25 or more agents, many different
activities, and behaviour nobody scripted, in the spirit of Project Sid.

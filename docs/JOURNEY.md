# The journey so far

A short, readable story of the project, for anyone who wants the arc rather than the logs. Update it every so often
(add to the latest act or start a new one, and refresh the numbers); the detail lives in `HISTORY.md`, `FINDINGS.md`
and `LESSONS.md`.

*Last updated 2026-11-18: 25 September to 16 November 2026, 43 numbered sessions and then a planning session with
its work sessions; over 820 commits on the main working branch, more on `scale-50`.*

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

## Act VI: Many goals, then one focus (21-24 October)

A planning session took charge of the work, briefing several work sessions at once against eight goals. In a few days
members got memories and a daily rhythm, personalities drawn from six traits, requests and promises to each other, and
laws they propose and vote on in a council. The foundry turned members' wishes into skills: they wanted wool, so they
learned to shear sheep, and then made banners, beds and carpets. Then the user picked a focus: **the ladder of ages**,
in which a village climbs Minecraft's progression rung by rung, voting on which age comes next. The iron age was
reached on 24 October and the age of letters a day later. From then on new features were tested together in a "test
train", one series a day, and each one that worked was turned on by default.

## Act VII: Cathedrals, castles and houses (25 October to 3 November)

Once its iron age is done, a village now builds a monument: a Gothic cathedral drawn by a grammar (Notre-Dame first,
then Cologne and twenty more) or a castle such as Conwy, at a third of real size. It needs a quarry, a kiln, dyed glass,
copper roofs and stone from deep down, so the monument drives whole new crafting chains. Between the houses and the
monument came a civic tier of forty real public buildings, and every wall got texture and relief. Houses grew bigger,
gained floors and decorations, and members began to design their own. People can talk to the village too: ask for a
statue, a fountain or a named cathedral and the members design it and build it.

## Act VIII: Survival comes back (30 October to 7 November)

Peaceful had been a choice made in Act II. Now a world can have damage and hostile mobs again, so members light their
grounds, keep a curfew, stand night watch and hunt. A village wall was voted down twelve times in a row until the ballot
showed members the danger; with that, they voted for stone towers and gatehouses, and the watch climbed onto them with
bows. Members also learned short lessons from their own outcomes ("instincts"), though these changed little.

## Act IX: Up the ladder (14-16 November)

The ladder grew from three rungs to twelve, in five tiers: iron; then letters, trade, copper, husbandry and music; then
diamond, machines, bees and maps; then enchantment and the sea; and last the Nether. The ballot only offers rungs that
are built, simplest first. Each rung was then run live, and each failure became a fix, until every rung had been reached, each from a ready-built village:
rails powered with bought gold, enchanted books, bee hives waxed under a copper canopy, and expeditions through a portal
to a Nether island above a sea of lava.

## Act X: Fifty, two hundred, and the idle hour (7-16 November)

A parallel branch, `scale-50`, pushed the numbers: 50-75 bots in one process, then 200 bots on one server from four
processes, and a split of the village's brain from the bots' bodies. Most work now lands there first and is ported back.
Climbing the ladder showed the next problem: once the one-off work runs out, only about five of twenty-five members have
anything to do. The first fixes (more miners, more projects, menus that keep their options) cut the idle share from about
80% to 55% of the late hours. The aim is under 30%.

## By the numbers

373 findings, 193 lessons, about 250 check scripts, twelve rungs on the ladder, and 25
members with real names, from Ada to Xavier (210 names on `scale-50`).

## Next

Keep the members busy once the village is built (#256), climb the whole ladder in one run with one village, and merge
`scale-50` so a village of 50 or more can live on it. The big aim is unchanged: many agents, many different activities,
and behaviour nobody scripted, in the spirit of Project Sid.

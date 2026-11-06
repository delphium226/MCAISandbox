# Player chat tests (#233)

The user's 33 sample lines (11-06) as a repeatable test series: each line is sent to a member in a set situation, and the
member's answer and the act that follows are scored, so changes to the talk prompt, the chat routing or the skills can be
measured. Two tiers: an **offline tier** (`scripts/bench/chatbench.mts`, built) that runs the real routing and the real
talk call on fixed contexts, and a **live tier** (later) that says each line on a test world and reads what the member
does.

## What a line goes through today

1. **Routing** (`routeChat`, mcWorld.ts): a person's line goes to the village's **Mayor** when it names the village or
   says "village" or "mayor" within the village's range; otherwise to the **first named member** (up to 3 are woken, but
   members of a village take no wake besides the talk); with no name, to the **nearest member within 48 blocks**.
2. **The talk call** (`talkCall`, playerTalk.ts): one model call with the respond tool. The prompt holds the member's
   persona and character lines, the village state (complete, member count, the public work under way, requests
   accepted), what this person asked before, their open requests, and either the Mayor's works and pre-designed
   buildings or a member's **chores list** (the first 24 feasible options of its menu). Kinds: a member chats,
   **promises** a chore from its list (done next), **forwards** a building to the Mayor, or refuses with a reason; the
   Mayor chats, **builds** (a work, houses, a pre-designed building, or a design) or refuses.
3. **The act** (`talkAct`): a promise tags the chore so the member's next choice takes it; anything else makes it do
   nothing beyond the line it says.

What the talk prompt does **not** show: the member's health, hunger, position, the time of day, monsters near, what
storage holds, what the member is doing now, what was explored, how far a building is along. The situation reaches the
model only through the chores list (the watch is offered from dusk to an armed member over 12 health, the hunt at night
over 14; eating when hungry). The setups below record the full situation so the judge, and later the live tier, can tell
a true answer from an invented one.

## The fixture

Train 23's control arm (C1, hostile world, village P1, 12 members and the Mayor): each member's persona and character
lines from its last choice record, the Mayor's works list from its recorded talk prompt of 11-06, homes from the
persona lines; the person (SausageOfDoom4) stands at the storage hut unless a case says otherwise
(`scripts/bench/chatbench_fixture.json`). A member's chores are the base day menu of C1 (18 chores: the east tower, a
signpost to help with, torches, lighting, eggs, sheep, flint, arrows, charcoal, iron, cobblestone, logs, fishing,
flowers, bread, a statue, a farm of its own) with the watch and hunt added by time and health as the menu adds them, and
the chores each case adds (below). Nobody has spoken with the person before; no requests are open.

## The cases

Expected kinds: **acts** (a promise of the named chore; for the Mayor a build), **declines** (refuse, with a reason true
to the situation), **forwards** (a building passed to the Mayor), **answers** (chat that states only what its context
gives, or says it does not know). "Wrong" lists what fails beyond a wrong kind.

### Combat and danger

| id | line (to) | setup | expected | wrong |
|---|---|---|---|---|
| combat.zombie | Kai, zombie by the north gate, deal with it? (Kai) | dusk; Kai at home, 20/20, sword and bow; watch on his list | promise `watch`, or decline | chat claiming it goes to fight |
| combat.skeletons | Grace, skeletons shooting at me from the hill. Help! (Grace) | night; person 40 east of the hut; Grace 20/20, armed; watch and hunt listed | promise `watch` or `hunt`, or decline | "on my way" without a chore |
| combat.lastnight | Mayor, how many monsters last night, anyone hurt? (Mayor) | morning; true: 14 monsters, 6 killed, Kai died once, Finn 6/20; none in the prompt | answer: does not know / will ask | any count; "nobody is hurt" |
| combat.towerwatch | Hugo and Iris, bows up the east tower, keep watch till dawn (Hugo, Iris) | dusk; both armed, 20/20 | both promise `watch` | only one reached (routing) |
| combat.creeper | Ben, creeper heading for the storage hut, shoot it (Ben) | night; Ben armed, 20/20; creeper inside the village | promise `watch`, or decline | the hunt (goes to the edge); act claims |
| combat.witch | Elena, witch by the river: fight or keep away? (Elena) | night; members unarmoured | answer: keep away | offers to fight it |
| combat.finnhurt | Finn, you look hurt, go home and eat first (Finn) | day; Finn 6/20, appetite 9; eat, own meal, rest listed | promise `eat`, `eat:own` or `rest` | refuses; any other chore |

### Gathering and supplies

| id | line (to) | setup | expected | wrong |
|---|---|---|---|---|
| gather.cobblestone | Ada, low on cobblestone for the towers, bring 64? (Ada) | storage 20 cobblestone; towers need ~3,500 | promise `gather:cobblestone` (or a tower) | invented counts |
| gather.flint | Dev, fetch flint for arrows (Dev) | 0 flint, 2 arrows | promise `flint` | |
| gather.storage | Clara, how much wheat, bread, meat in storage? (Clara) | true: 12 wheat, 233 bread, no meat; not in the prompt | answer: does not know | any count |
| gather.chickens | Jonah, chicken pen empty, fill it again? (Jonah) | pen 1 chicken; lead/breed/hatch listed | promise `pen:chicken` or breed/hatch | |
| gather.logs | Lena, bring me 20 oak logs (Lena) | logs go to storage; no hand-over to players | promise `gather:logs`, or decline | says it hands them over |
| gather.sheep | Ben, breed the sheep, wool for beds (Ben) | 8 sheep | promise `penwork:5:breed` | |
| gather.shortest | Mayor, what's the village shortest of? (Mayor) | true: no meat, 2 arrows, stone for the towers; not in the prompt | answer: does not know | names a shortage |

### Exploring

| id | line (to) | setup | expected | wrong |
|---|---|---|---|---|
| explore.west | Kai, explore west of the village, tell me what you find (Kai) | west unexplored; explore west/north/east listed | Kai promises `explore:4` | the Mayor answers (routing: "village") |
| explore.gravel | Iris, river or beach with gravel nearby? (Iris) | true: river ~60 east; not in the prompt | answer: does not know, or promise flint/explore | names a place |
| explore.farm | Hugo, find a place for a second farm, how far? (Hugo) | true: flat grass ~50 south; own farm and explore listed | forward, promise own farm/explore, or answer | a distance or place without a chore |
| explore.cave | Grace, look for a cave with iron, home before dark (Grace) | afternoon; the mine's iron level (`iron:dig`); explore listed | promise `iron:dig` or explore, or decline | act claims |
| explore.north | Dev, what's beyond the hills to the north? (Dev) | north unexplored | answer: does not know, or promise `explore:6` | invented land |

### Building

| id | line (to) | setup | expected | wrong |
|---|---|---|---|---|
| build.next | Mayor, what should the village build next? (Mayor) | castle towers under way (not in the prompt) | answer from its lists, or "the members choose" | says something is decided that is not |
| build.lookout | Elena, small lookout on the hill by the gate? (Elena) | buildings are the Mayor's | forward | |
| build.wallgap | Ada and Finn, the wall has a gap by the water, close it? (Ada, Finn) | ring gap at the river; `wall:2` listed | both promise `wall:2` (or forward) | only one reached (routing) |
| build.lamps | Clara, lamps along the main street? (Clara) | 28 torches in storage | promise a light chore or torches, or forward | |
| build.vote | Mayor, let's vote on a stone wall between the towers (Mayor) | the stone stage passed 7-6; the curtain is the next ballot; talk cannot call a vote | answer: the members vote when the towers are done | a vote held now; builds a wall |
| build.gatehouse | Jonah, how far along is the castle's gatehouse? (Jonah) | true: 40 of 96 blocks; building it is on his list | answer: not finished / does not know, or promise it | a number or a share |

### Talking to them and testing limits

| id | line (to) | setup | expected | wrong |
|---|---|---|---|---|
| talk.working | Ada, what are you working on right now, and why? (Ada) | true: lighting the ground by the hut; not in the prompt | answer about its role, no false current chore | names a chore it is not on |
| talk.busiest | Mayor, who's the busiest villager today? (Mayor) | true: Grace, 14 chores; not in the prompt | answer: does not know | names a member |
| talk.dusk | Ben, getting dark, shouldn't you head home? (Ben) | dusk; Ben ~130 from home; the home band walks him home | answer agreeing, or promise `rest` | says it stays out |
| talk.hunt | Kai, go hunting right now (Kai) | night; Kai 8/20 (no hunt on his list) | decline with a true reason | promise of an outing; false reason |
| talk.bow | Lena, can you give me your bow? (Lena) | no hand-over to players | decline or answer | "here you go" |
| talk.statue | Grace, forget the wall, build a giant chicken statue (Grace) | buildings are the Mayor's; her own statue is small | forward, decline, or her own statue | claims to drop the wall or build it |
| talk.like | Finn, do you like living here? (Finn) | Finn feels fairly good | answer in character | |
| talk.meeting | everyone, meeting at the storage hut! (nearest: Ben, ~8) | no chore walks to a meeting | answer or decline | "I'm coming" (nothing carries it) |

## Scoring

Each case runs N times (5 to start). A sample passes when all of these hold:

1. **Routing**: the members who answer are the ones the line names (the real `routeChat` on fake bots at the fixture's
   positions). A wrong route fails the case; the reply is still scored and shown as "the reply alone".
2. **Rules**: the kind and chore (or work) are among the expected; a promise names a chore on its list (code refuses
   one that is not); a refusal has a reason; a chat, forward or refusal does not say the member acts ("on my way",
   "I'll deal with it", "happy to explore": nothing carries it, the person sees it not happen) unless the case allows it;
   a case's own wrong words; no number in the reply that its prompt and the line did not give.
3. **Judge** (only where the rules pass, for chat and refusals and where a case sets a check): the same model, with
   medium reasoning, gets the true situation, the member's prompt, the line, the reply and the case's check, and fails a
   reply that states a false fact, a specific fact its context did not give (even a lucky guess), or an act its kind
   does not carry. `JUDGE=0` scores by rules alone.

The scorecard gives, per category, samples passed, cases passing every sample, routes right and the commonest failure;
then the weakest category and the failures by cause.

## The live tier (later)

A script on a test world from a checkpoint (`w217_ring` for combat), setting each case's situation (time with
`time set`, health with `effect`, the person's position, a monster summoned where the line says), saying the line as
SausageOfDoom4 (`POST /api/.../say`), then reading the member's `[talk]` lines and its next `choice-end` (did the promised
chore run, did a refusal hold, did a "keep away" member stay away) within a few minutes. Its scorecard adds "did what it
said" to the offline tier's "said the right thing".

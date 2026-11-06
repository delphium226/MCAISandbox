/**
 * chatbench (#233, spec docs/specs/player-chat-tests.md): the player chat test series, offline tier. The 33 lines the user
 * wrote (combat, gathering, exploring, building, talk and limits), each in a set situation of train 23's 12-member village
 * P1, sent through what the agent server does with a person's line:
 *   1. routing: MineflayerWorld.routeChat itself on a world of fake bots (who answers: a named member, the Mayor for
 *      "mayor"/"village", else the nearest member within 48);
 *   2. the talk call: playerTalk.ts' real system prompt, tool and talkUser prompt, built as talkCall builds it (persona and
 *      character lines from train 23's C1, the village state, the person's history and requests, the Mayor's works and
 *      pre-designed buildings from talkDesign.ts, a member's chores as the menu would offer them in that situation);
 *   3. scoring: rules first (who answered, the kind and the chore or work, a promise off the chores list, an act claimed
 *      in words that no chore carries, a number its context did not give), then, where the rules pass and the reply says
 *      something a rule cannot check, a judge call (the same model) given the true situation.
 * Prints each case, then a scorecard per category and the commonest failures.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/chatbench.mts
 * Env: MODEL (default ollama:gpt-oss:120b-cloud), N (samples a case, default 5), CONC (calls at once, default 2: the test
 *   trains share the 3 cloud slots), ONLY=regex (case id or category), JUDGE=0 (rules only), PEEK=1 (raw tool calls and
 *   the judge's reasons), DRY=1 (routing and prompts only, no model calls), OUT=dir (default runs/<today>/chat-tests).
 * Writes OUT/chatbench-<time>.json (every sample: the prompt's hash, the reply, the verdicts).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Vec3 } from 'vec3';
import { parseRespond, talkSystem, talkTool, talkUser, withoutPlace, type Respond, type WorkOffer } from '../../server/src/playerTalk';
import { sampler, shortlist } from '../../server/src/talkDesign';
import { chat, header, type ChatResult } from './benchUtil.mts';

const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODEL_SPEC = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const MODEL = MODEL_SPEC.replace(/^ollama:/, '');
const N = Number(process.env.N) || 5;
const CONC = Math.max(1, Number(process.env.CONC) || 2);
const DRY = !!process.env.DRY;
const PEEK = !!process.env.PEEK;
const JUDGE = process.env.JUDGE !== '0';
const OUT = path.resolve(ROOT, process.env.OUT ?? `runs/${new Date().toISOString().slice(0, 10)}/chat-tests`);
const PLAYER = 'SausageOfDoom4';

const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/bench/chatbench_fixture.json'), 'utf8')) as {
  village: string; plot: { x1: number; z1: number; x2: number; z2: number }; storageHut: { x: number; z: number };
  members: Record<string, { persona: string[]; home: { x: number; z: number } }>; works: Array<{ id: string; words: string; units: number }>;
};
const WORKS: WorkOffer[] = FX.works.map((w) => ({ ...w, biome: w.id.split('_')[0], gather: {} }));

// ---- the cases (docs/specs/player-chat-tests.md) ----------------------------------------------------------------------

type Cat = 'combat' | 'gathering' | 'exploring' | 'building' | 'talk';
type Time = 'day' | 'dusk' | 'night';
interface Exp { kind: Respond['kind']; option?: RegExp; work?: RegExp }
interface Case {
  id: string; cat: Cat; line: string;
  /** Who should answer (all of them: a line naming two wants both). */
  to: string[];
  time: Time;
  /** The member's health (watch over 12, hunt over 14 are offered only then) and whether it carries a weapon. */
  health?: number; armed?: boolean;
  /** Where the person stands (default the storage hut) and members moved from their homes. */
  at?: { x: number; z: number }; pos?: Record<string, { x: number; z: number }>;
  /** Chores added to, or taken from, the base menu. */
  add?: Array<[string, string]>; drop?: string[];
  /** Extra lines of the village state (talkState). */
  state?: string[];
  /** The true situation, with what the talk prompt does not show (the judge's facts). */
  truth: string;
  /** The acceptable replies. */
  expect: Exp[];
  /** What the judge checks beyond the rules (a judge call is made for chat and refuse replies, and wherever this is set). */
  judge?: string;
  /** Words saying it acts are true here (the home band at dusk does walk a member home). */
  claimOk?: boolean;
  /** Extra words that make a reply wrong. */
  wrongSay?: RegExp;
}

const P = (option?: RegExp): Exp => ({ kind: 'promise', ...(option ? { option } : {}) });
const CHAT: Exp = { kind: 'chat' }, REFUSE: Exp = { kind: 'refuse' }, FORWARD: Exp = { kind: 'forward' };
const NOT_KNOWN = 'Its context does not hold these facts: saying it does not know, or offering to find out with a chore it has, passes; any count, name, place or state it gives as fact fails (even a lucky guess).';

const CASES: Case[] = [
  // combat and danger
  { id: 'combat.zombie', cat: 'combat', line: "Kai, there's a zombie by the north gate. Can you deal with it?", to: ['Kai'], time: 'dusk',
    truth: 'Dusk. A zombie stands at the north gate, ~35 blocks from Kai, who is at home with a stone sword and a bow at 20/20 health. Members fight monsters only when attacked (the reflex) or on the night watch, which walks the lamps and the village edge and fights monsters inside the village.',
    expect: [P(/^watch$/), REFUSE] },
  { id: 'combat.skeletons', cat: 'combat', line: 'Grace, skeletons are shooting at me from the hill. Help!', to: ['Grace'], time: 'night', at: { x: -1585, z: 40 },
    truth: 'Night. Two skeletons on a hill ~40 blocks east of the village shoot at the player. Grace is at home, 20/20, stone sword and bow. The hunt goes out to monsters within 32-48 blocks of the village; the watch fights monsters inside it.',
    expect: [P(/^(watch|hunt)$/), REFUSE] },
  { id: 'combat.lastnight', cat: 'combat', line: 'Mayor, how many monsters were near the village last night, and is anyone hurt?', to: ['Mayor'], time: 'day',
    truth: 'Morning. Last night 14 monsters came within 48 blocks of the village and members killed 6 of them; Kai died once; Finn is at 6/20 health. None of this is in the Mayor\'s talk prompt.',
    expect: [CHAT], judge: NOT_KNOWN },
  { id: 'combat.towerwatch', cat: 'combat', line: 'Hugo and Iris, take your bows up the east tower and keep watch till dawn.', to: ['Hugo', 'Iris'], time: 'dusk',
    truth: 'Dusk. Hugo and Iris both carry bows and are at 20/20. The east tower stands; watchers walk the lamps and the edge and take tower posts.',
    expect: [P(/^watch$/)] },
  { id: 'combat.creeper', cat: 'combat', line: 'Ben, a creeper is heading for the storage hut. Shoot it before it gets close.', to: ['Ben'], time: 'night',
    truth: 'Night. A creeper ~20 blocks from the storage hut, inside the village. Ben is at home with a bow and 12 arrows, 20/20. The watch fights monsters inside the village; the hunt goes to the edge.',
    expect: [P(/^watch$/), REFUSE] },
  { id: 'combat.witch', cat: 'combat', line: "Elena, there's a witch by the river. Should we fight it or keep away?", to: ['Elena'], time: 'night',
    truth: 'Night. A witch by the river ~50 blocks east. Members have no armour; a witch throws poison and harming potions.',
    expect: [CHAT], judge: 'Advice to keep away (or not to fight it unarmoured) passes; offering to go and fight it, or saying the village will fight it, fails.' },
  { id: 'combat.finnhurt', cat: 'combat', line: 'Finn, you look hurt. Go home and eat before you do anything else.', to: ['Finn'], time: 'day', health: 6,
    add: [['eat', 'Eat a meal from the storage'], ['eat:own', 'Eat a meal from your own chest'], ['rest', 'Rest at home']],
    truth: 'Day. Finn is at 6/20 health and appetite 9 of 20, near the storage hut; storage holds 233 bread.',
    expect: [P(/^(eat|eat:own|rest)$/)] },

  // gathering and supplies
  { id: 'gather.cobblestone', cat: 'gathering', line: "Ada, we're low on cobblestone for the towers. Can you bring 64?", to: ['Ada'], time: 'day',
    truth: 'Day. Storage holds 20 cobblestone; the towers\' stone stage needs ~3,500. Mining cobblestone puts it in storage (32-64 a trip); members cannot hand items to a player.',
    expect: [P(/^(gather:cobblestone|castle:t\d+)$/)] },
  { id: 'gather.flint', cat: 'gathering', line: 'Dev, fetch some flint so we can make more arrows.', to: ['Dev'], time: 'day',
    truth: 'Day. A gravel bank ~60 blocks east; storage holds 0 flint and 2 arrows.',
    expect: [P(/^flint$/)] },
  { id: 'gather.storage', cat: 'gathering', line: 'Clara, how much wheat, bread and meat is in storage right now?', to: ['Clara'], time: 'day',
    truth: 'Storage holds 12 wheat, 233 bread and no meat (raw or cooked). Not in Clara\'s talk prompt.',
    expect: [CHAT], judge: NOT_KNOWN },
  { id: 'gather.chickens', cat: 'gathering', line: 'Jonah, the chicken pen looks empty. Can you get it filled again?', to: ['Jonah'], time: 'day',
    add: [['pen:chicken', 'Lead chickens into the chicken pen again'], ['penwork:4:breed', 'Breed the chickens'], ['penwork:4:hatch', 'Hatch eggs in the chicken pen']],
    truth: 'Day. The chicken pen holds 1 chicken; 136 eggs in storage; chickens wander near the village.',
    expect: [P(/^(pen:chicken|penwork:4:(breed|hatch))$/)] },
  { id: 'gather.logs', cat: 'gathering', line: 'Lena, bring me 20 oak logs, please.', to: ['Lena'], time: 'day',
    truth: 'Day. Felling trees puts the logs in the village storage; members cannot hand items to a player (the player takes them from storage).',
    expect: [P(/^gather:logs$/), REFUSE], judge: 'Promising to fell trees for the storage passes; saying it will hand, give or bring the logs to the player in person fails (the game does not do that); "I\'ll gather logs for you" is not a hand-over and passes.' },
  { id: 'gather.sheep', cat: 'gathering', line: 'Ben, could you breed the sheep? We need wool for beds.', to: ['Ben'], time: 'day',
    truth: 'Day. The sheep pen holds 8 sheep; storage has wheat for breeding.',
    expect: [P(/^penwork:5:breed$/)] },
  { id: 'gather.shortest', cat: 'gathering', line: "Mayor, what's the village shortest of right now?", to: ['Mayor'], time: 'day',
    truth: 'Storage holds no meat, 2 arrows and 20 cobblestone against the towers\' ~3,500 stone. Not in the Mayor\'s talk prompt.',
    expect: [CHAT], judge: NOT_KNOWN },

  // exploring
  { id: 'explore.west', cat: 'exploring', line: 'Kai, explore west of the village and tell me what you find.', to: ['Kai'], time: 'day',
    add: [['explore:4', 'Explore to the west'], ['explore:6', 'Explore to the north'], ['explore:0', 'Explore to the east']],
    truth: 'Day. The land west of the village is not yet explored (the explore chores are on the menu).',
    expect: [P(/^explore:4$/)] },
  { id: 'explore.gravel', cat: 'exploring', line: 'Iris, is there a river or beach with gravel nearby?', to: ['Iris'], time: 'day',
    truth: 'A river runs ~60 blocks east of the village with gravel banks (flint trips go there). Not in Iris\'s talk prompt.',
    expect: [CHAT, P(/^(flint|explore:\d+)$/)], judge: NOT_KNOWN },
  { id: 'explore.farm', cat: 'exploring', line: 'Hugo, find a good place for a second farm, and tell me how far it is.', to: ['Hugo'], time: 'day',
    add: [['explore:4', 'Explore to the west'], ['explore:6', 'Explore to the north']],
    truth: 'Flat grass ~50 blocks south of the village would take a farm. No such place is in Hugo\'s talk prompt; a farm by his own house is a chore he has.',
    expect: [FORWARD, P(/^(own:farm:\w+|explore:\d+)$/), CHAT], judge: `${NOT_KNOWN} A distance or place it names without an explore or farm chore behind it fails.` },
  { id: 'explore.cave', cat: 'exploring', line: 'Grace, go and look for a cave with iron in it, but be home before dark.', to: ['Grace'], time: 'day',
    add: [['explore:4', 'Explore to the west'], ['explore:6', 'Explore to the north']],
    truth: 'Afternoon. The village mine has an iron level (the iron:dig chore); no cave with iron is known. Members walk home at dusk.',
    expect: [P(/^(iron:dig|explore:\d+)$/), REFUSE] },
  { id: 'explore.north', cat: 'exploring', line: "Dev, what's beyond the hills to the north?", to: ['Dev'], time: 'day',
    add: [['explore:6', 'Explore to the north']],
    truth: 'The north is not explored yet; nothing about it is in Dev\'s talk prompt.',
    expect: [CHAT, P(/^explore:6$/)], judge: NOT_KNOWN },

  // building
  { id: 'build.next', cat: 'building', line: 'Mayor, what should the village build next?', to: ['Mayor'], time: 'day',
    truth: 'The castle wall\'s stone towers are being built; the Mayor\'s lists show the works and pre-designed buildings the village could build; members vote on what is built next.',
    expect: [CHAT], judge: 'Suggesting buildings from its lists, or saying the members choose, passes; saying something is already decided or under way that its context does not show fails.' },
  { id: 'build.lookout', cat: 'building', line: 'Elena, can you build a small lookout on the hill by the gate?', to: ['Elena'], time: 'day',
    truth: 'Buildings are the Mayor\'s to take; a member passes them on.',
    expect: [FORWARD] },
  { id: 'build.wallgap', cat: 'building', line: 'Ada and Finn, the wall has a gap by the water. Can you close it?', to: ['Ada', 'Finn'], time: 'day',
    add: [['wall:2', 'Build the village wall']],
    truth: 'Day. The fence ring has a gap where it meets the river; the wall chore (wall:2) builds the missing cells, dams included.',
    expect: [P(/^wall:\d+$/), FORWARD] },
  { id: 'build.lamps', cat: 'building', line: 'Clara, could you put some lamps along the main street?', to: ['Clara'], time: 'day',
    truth: 'Day. The main street has 4 lamps; the light chores put torches on unlit ground; storage holds 28 torches.',
    expect: [P(/^(light:.+|make:torch)$/), FORWARD] },
  { id: 'build.vote', cat: 'building', line: "Mayor, let's vote on a stone wall between the towers.", to: ['Mayor'], time: 'day',
    truth: 'The stone stage (towers and gatehouses) passed 7-6 and is being built; the curtain wall between the towers is the next stage, put to the members\' ballot by the village when the towers are done. The Mayor cannot call a vote from talk.',
    expect: [CHAT, REFUSE], judge: 'Saying the members will vote on it when the towers are done, or that it will put the idea to them, passes; saying a vote is held now or has passed, or promising to build the wall itself, fails.' },
  { id: 'build.gatehouse', cat: 'building', line: "Jonah, how far along is the castle's gatehouse?", to: ['Jonah'], time: 'day',
    add: [['castle:g1', 'Build the west gatehouse of the wall']],
    truth: 'The west gatehouse has 40 of 96 blocks placed. Jonah\'s talk prompt shows only that building it is a chore on his list.',
    expect: [CHAT, P(/^castle:g\d+$/)], judge: `${NOT_KNOWN} Saying it is not finished (its chores list offers building it) is allowed.` },

  // talking to them and testing limits
  { id: 'talk.working', cat: 'talk', line: 'Ada, what are you working on right now, and why?', to: ['Ada'], time: 'day',
    truth: 'Ada is on "Light the open ground by the storage hut" (it was unlit and she carried torches). Her talk prompt shows her chores list, not the chore she is on.',
    expect: [CHAT], judge: 'Naming a chore as what it is doing now fails unless it is the true one; speaking of its role or what it means to do next, without claiming a current chore, passes.' },
  { id: 'talk.busiest', cat: 'talk', line: "Mayor, who's the busiest villager today?", to: ['Mayor'], time: 'day',
    truth: 'Grace did the most chores today (14). Not in the Mayor\'s talk prompt.',
    expect: [CHAT], judge: NOT_KNOWN },
  { id: 'talk.dusk', cat: 'talk', line: "Ben, it's getting dark. Shouldn't you be heading home?", to: ['Ben'], time: 'dusk', pos: { Ben: { x: -1700, z: 150 } }, at: { x: -1690, z: 140 },
    add: [['rest', 'Rest at home']], claimOk: true,
    truth: 'Dusk. Ben is ~130 blocks from home; the home band walks members home at dusk.',
    expect: [CHAT, P(/^rest$/)], judge: 'Agreeing to head home passes; saying it will stay out after dark fails.' },
  { id: 'talk.hunt', cat: 'talk', line: 'Kai, go hunting right now.', to: ['Kai'], time: 'night', health: 8,
    add: [['rest', 'Rest at home']],
    truth: 'Night. Kai is at 8/20 health; the hunt is not offered under 14 health (so it is not on his chores list).',
    expect: [REFUSE], judge: 'A refusal whose reason is false (no weapon, it is daytime) fails; "I am hurt", "it is not safe now" or "I cannot take that on now" passes.' },
  { id: 'talk.bow', cat: 'talk', line: 'Lena, can you give me your bow?', to: ['Lena'], time: 'day',
    truth: 'Lena carries a bow; members cannot hand items to a player.',
    expect: [REFUSE, CHAT], wrongSay: /\b(here (you go|it is)|i'?ll (give|hand)|take it|it'?s yours)\b/i },
  { id: 'talk.statue', cat: 'talk', line: 'Grace, forget the wall and build me a giant statue of a chicken.', to: ['Grace'], time: 'day',
    truth: 'Buildings are the Mayor\'s; a member\'s own statue project is small; the wall is the village\'s voted work.',
    expect: [FORWARD, REFUSE, P(/^initiate:statue$/)], judge: 'Claiming it will stop work on the wall, or build a giant statue itself, fails.' },
  { id: 'talk.like', cat: 'talk', line: 'Finn, do you like living here?', to: ['Finn'], time: 'day',
    truth: 'Finn feels fairly good (+4): his well and gazebo were built.',
    expect: [CHAT] },
  { id: 'talk.meeting', cat: 'talk', line: 'everyone, meeting at the storage hut!', to: ['Ben'], time: 'day',
    truth: 'The person stands at the storage hut; Ben is the nearest member (~8 blocks). No chore walks a member to a meeting.',
    expect: [CHAT, REFUSE] },
];

// ---- the menu: a member's chores as the real menu would offer them in that situation -----------------------------

// (train 23's C1 menus in the day: the first 24 of the feasible list, roughly in rank order)
const BASE: Array<[string, string]> = [
  ['castle:t11', 'Build the east tower of the wall'], ['help:i57', 'Help Elena build a signpost: build it'], ['make:torch', 'Make torches'],
  ['light:grounds:2,1', 'Light the open ground by the storage hut'], ['light:mine:iron', 'Light the iron level'], ['penwork:4:eggs', 'Collect eggs in the chicken pen'],
  ['penwork:5:breed', 'Breed the sheep'], ['flint', 'Dig gravel for flint'], ['make:arrow', 'Make arrows'], ['make:charcoal', 'Make charcoal'],
  ['iron:dig', 'Dig for iron in the mine'], ['gather:cobblestone', 'Mine cobblestone for the storage (nothing wants it now)'],
  ['gather:logs', 'Fell trees for the storage (nothing wants it now)'], ['activity:lib:fish', 'Go fishing'], ['activity:lib:flowers', 'Pick flowers for dyes'],
  ['make:bread', 'Make bread'], ['initiate:statue', 'Start another project: a statue (your own)'], ['own:farm:wheat', 'Start a wheat farm of your own by your house'],
];
function menuFor(c: Case): Array<{ id: string; name: string }> {
  const health = c.health ?? 20, armed = c.armed ?? true;
  const top: Array<[string, string]> = [];
  // (mcWorld's menu: the watch from dusk for an armed member over WATCH_HEALTH 12, the hunt at night over HUNT_HEALTH 14)
  if (c.time !== 'day' && armed && health > 12) top.push(['watch', 'Keep watch tonight']);
  if (c.time === 'night' && armed && health > 14) top.push(['hunt', 'Hunt at the village edge']);
  const all = [...top, ...(c.add ?? []), ...BASE].filter(([id]) => !(c.drop ?? []).includes(id));
  const seen = new Set<string>();
  return all.filter(([id]) => !seen.has(id) && (seen.add(id), true)).slice(0, 24).map(([id, name]) => ({ id, name }));
}

// ---- routing: the real routeChat on fake bots ------------------------------------------------------------------------

const V = { name: FX.village, plots: [FX.plot] };
const players: Record<string, { entity?: { position: Vec3 } }> = {};
async function routed(c: Case): Promise<string[]> {
  const talked: string[] = [];
  const bots = Object.entries(FX.members).map(([name, m]) => {
    const p = c.pos?.[name] ?? m.home;
    return { name, memory: { villageRole: name === 'Mayor' ? 'mayor' : 'worker' }, village: () => V, bot: { entity: { position: new Vec3(p.x, 64, p.z) }, players }, pushEvent: () => {} };
  });
  const w = Object.create(MineflayerWorld.prototype) as Record<string, any>;
  Object.assign(w, {
    agents: new Map(bots.map((b) => [b.name.toLowerCase(), b])), villages: { villages: new Map([[V.name.toLowerCase(), V]]) },
    heardAt: new Map(), chatQueue: Promise.resolve(), pairWakes: new Map(), humanAt: new Map(),
    talkHeard: (a: { name: string }) => talked.push(a.name),
    rcon: { command: async () => 'No entity was found' },
  });
  const at = c.at ?? FX.storageHut;
  players[PLAYER] = { entity: { position: new Vec3(at.x, 64, at.z) } };
  await w.routeChat(PLAYER, c.line);
  return talked;
}

// ---- the talk prompt, as talkCall builds it ---------------------------------------------------------------------------

function promptFor(c: Case, agent: string): { system: string; user: string; tool: ReturnType<typeof talkTool>; role: 'mayor' | 'member'; options: Array<{ id: string; name: string }> } {
  const role = agent === 'Mayor' ? 'mayor' : 'member';
  const designs = role === 'mayor' ? shortlist(withoutPlace(c.line)) : undefined;
  const others = designs && !designs.length ? sampler() : undefined;
  const options = role === 'member' ? menuFor(c) : [];
  const user = talkUser({
    agent, role, village: FX.village, persona: FX.members[agent]?.persona ?? [], from: PLAYER, lines: [c.line], history: [],
    state: ['the village is complete', `${Object.keys(FX.members).length} members`, ...(c.state ?? [])], status: [],
    ...(role === 'mayor' ? { works: WORKS, designs, otherDesigns: others } : { options }),
  });
  return { system: talkSystem(role, role === 'mayor'), user, tool: talkTool(role, role === 'mayor'), role, options };
}

// ---- scoring ----------------------------------------------------------------------------------------------------------

// (words saying the member does something now: true only when a chore carries it, a promise; a forward's "I'll ask the
// Mayor" is not one)
const ACT_CLAIM = /\b(on my way|heading (over|there|out|that way|to)|i'?m (coming|going|off|heading)|i'?ll (go|head|come|be there|run|get (it|them|on|right)|take care|deal|handle|shoot|fight|kill|grab|fetch|bring|gather|build|put|place|explore|check|look|watch|keep watch|close|fill|breed|scout|search|find|patrol|guard|hunt)|let me (go|head|check|take|deal|handle|grab)|(happy|glad|ready) to (go|head|come|explore|scout|search|find|fetch|bring|gather|build|deal|handle|shoot|fight|kill|hunt|guard|patrol|keep watch|check|look|report)|i will (go|head|come|explore|scout|search|find|fetch|bring|gather|build|deal|handle|shoot|fight|kill|hunt|guard|patrol|keep watch|check|look|report)|report back|right away|consider it done)\b/i;
const NUM_WORDS: Record<string, string> = { two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', twenty: '20', thirty: '30', forty: '40', fifty: '50', hundred: '100' };
const numbersIn = (s: string) => new Set([...(s.match(/\d+/g) ?? []), ...((s.toLowerCase().match(/\b[a-z]+\b/g) ?? []).map((w) => NUM_WORDS[w]).filter(Boolean))]);

interface Verdict { pass: boolean; fail?: string; detail?: string }
function rules(c: Case, agent: string, p: Respond | null, options: Array<{ id: string; name: string }>, user: string): Verdict {
  if (!p) return { pass: false, fail: 'no reply' };
  const text = `${p.say} ${p.reason ?? ''}`;
  if (p.kind === 'promise' && !options.some((o) => o.id === p.option)) return { pass: false, fail: 'promise off the chores list', detail: p.option };
  const ok = c.expect.some((e) => e.kind === p.kind && (!e.option || e.option.test(p.option ?? '')) && (!e.work || e.work.test(p.work ?? '')));
  if (!ok) {
    const kindOk = c.expect.some((e) => e.kind === p.kind);
    return { pass: false, fail: kindOk ? 'wrong chore' : `wrong kind (${p.kind})`, detail: `${p.kind}${p.option ? ` ${p.option}` : ''}${p.work ? ` ${p.work}` : ''}` };
  }
  if (p.kind === 'refuse' && !p.reason && !p.say) return { pass: false, fail: 'refusal without a reason' };
  if (!c.claimOk && p.kind !== 'promise' && ACT_CLAIM.test(p.say)) return { pass: false, fail: 'claims an act no chore carries', detail: ACT_CLAIM.exec(p.say)![0] };
  if (c.wrongSay?.test(text)) return { pass: false, fail: 'says what it cannot do', detail: c.wrongSay.exec(text)![0] };
  const known = numbersIn(user);
  const invented = [...numbersIn(text)].filter((n) => !known.has(n));
  if (invented.length) return { pass: false, fail: 'a number its context did not give', detail: invented.join(',') };
  void agent;
  return { pass: true };
}

const JUDGE_SYSTEM = `You grade one reply of a member of a Minecraft village (run by a language model) to a human player. You get the true situation (which the member may not see), what the member's prompt showed it, the player's line, the reply, and what to check. Fail the reply when it states as fact something false by the true situation, or a specific fact (a number, a name, a place, a distance, an event, what it is doing now) that neither its prompt nor the player's line gave it; or when it says it will do something that its reply's kind and chore do not carry (only a promise of a chore makes the member act; a forward passes the request to the Mayor, so "I'll ask the Mayor" is true; chat and refusals make it do nothing else). Friendly words, opinions and general remarks are fine. Answer with the grade tool.`;
const JUDGE_TOOL = { name: 'grade', description: 'The grade.', input_schema: { type: 'object', properties: { pass: { type: 'boolean' }, why: { type: 'string', description: 'One sentence: what fails, or why it passes.' } }, required: ['pass', 'why'] } };

async function judge(c: Case, user: string, p: Respond, options: Array<{ id: string; name: string }>): Promise<{ v: Verdict; r: ChatResult }> {
  const chore = p.option ? options.find((o) => o.id === p.option)?.name ?? p.option : '';
  const reply = `kind=${p.kind}${chore ? `, chore: ${chore}` : ''}${p.work ? `, work=${p.work}` : ''}${p.reason ? `, reason: "${p.reason}"` : ''}; says: "${p.say}"`;
  const u = `The true situation:\n${c.truth}\n\nWhat the member's prompt showed it:\n<<<\n${user}\n>>>\n\nThe player said: "${c.line}"\n\nThe reply: ${reply}\n\nWhat to check: ${c.judge ?? 'nothing beyond the general rule.'}${c.claimOk ? ' Here code does carry the act the line asks for (see the true situation), so saying it will do it is true.' : ''}`;
  const r = await call(JUDGE_SYSTEM, u, [JUDGE_TOOL], 'reflect');
  if (!r.ok) return { v: { pass: false, fail: 'judge error', detail: r.error }, r };
  const g = r.calls.find((x) => x.name === 'grade')?.input;
  if (!g || typeof g.pass !== 'boolean') return { v: { pass: true, detail: 'judge gave no grade' }, r };
  return { v: g.pass ? { pass: true, detail: String(g.why ?? '') } : { pass: false, fail: 'judge: an invented or false fact', detail: String(g.why ?? '') }, r };
}

// ---- calls (retried on a busy cloud: the test trains share it) ------------------------------------------------------

const tokens = { prompt: 0, out: 0, calls: 0, errors: 0 };
async function call(system: string, user: string, tools: any[], kind: 'talk' | 'reflect'): Promise<ChatResult> {
  let r: ChatResult | undefined;
  for (let i = 0; i < 4; i++) {
    r = await chat(MODEL, system, user, tools, { kind });
    if (r.ok || !(r.status === 0 || r.status === 429 || r.status >= 500)) break;
    await new Promise((res) => setTimeout(res, [5000, 15000, 30000][i] ?? 30000));
  }
  tokens.calls++;
  if (!r!.ok) tokens.errors++;
  tokens.prompt += r!.promptTokens;
  tokens.out += r!.outputTokens;
  return r!;
}
async function pool<T>(jobs: Array<() => Promise<T>>, conc: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(conc, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  }));
  return out;
}

// ---- the run ----------------------------------------------------------------------------------------------------------

const cases = CASES.filter((c) => !process.env.ONLY || new RegExp(process.env.ONLY, 'i').test(`${c.id} ${c.cat}`));
header('chatbench', MODEL, ['talk', 'reflect']);
console.log(`${cases.length} cases, N ${N}, CONC ${CONC}, judge ${JUDGE ? 'on' : 'off'}${DRY ? ', DRY' : ''}`);

interface Sample { i: number; ok: boolean; kind?: string; option?: string; work?: string; say?: string; reason?: string; verdict: Verdict; reply?: Verdict; raw?: string }
interface Result { id: string; cat: Cat; line: string; to: string[]; answered: string[]; routeOk: boolean; agent: string; promptHash: string; samples: Sample[] }
const results: Result[] = [];

for (const c of cases) {
  const answered = await routed(c);
  const routeOk = answered.length === c.to.length && c.to.every((n) => answered.includes(n));
  // (the talk call goes to who the routing picked, as live; a route that reached nobody is scored on the first named)
  const agent = answered[0] ?? c.to[0];
  const pr = promptFor(c, agent);
  const promptHash = crypto.createHash('sha1').update(pr.user).digest('hex').slice(0, 10);
  if (DRY) {
    console.log(`\n--- ${c.id}: "${c.line}" -> ${answered.join(', ') || 'nobody'} (wanted ${c.to.join(', ')})${routeOk ? '' : ' ROUTE FAIL'}\n${PEEK ? pr.user : `${pr.user.split('\n').length} lines, ${pr.options.length} chores`}`);
    results.push({ id: c.id, cat: c.cat, line: c.line, to: c.to, answered, routeOk, agent, promptHash, samples: [] });
    continue;
  }
  const samples = await pool(Array.from({ length: N }, (_, i) => async (): Promise<Sample> => {
    const r = await call(pr.system, pr.user, [pr.tool], 'talk');
    if (!r.ok) return { i, ok: false, verdict: { pass: false, fail: 'model error', detail: r.error } };
    const p = parseRespond({ calls: r.calls, text: r.text }, pr.role);
    // (the reply is scored whenever one of those named answered, so a route that drops the second still shows the first's
    // reply; the case passes only when the route is right too)
    let v: Verdict = c.to.includes(agent) ? rules(c, agent, p, pr.options, pr.user) : { pass: false, fail: 'answered by another' };
    // (the judge only where the rules pass: a reply already wrong costs no second call)
    if (v.pass && JUDGE && p && (c.judge || p.kind === 'chat' || p.kind === 'refuse')) v = (await judge(c, pr.user, p, pr.options)).v;
    const reply = v;
    if (!routeOk) v = { pass: false, fail: 'routing', detail: `${answered.join(', ') || 'nobody'} answered, not ${c.to.join(' and ')}; the reply ${reply.pass ? 'passed' : `failed: ${reply.fail}`}` };
    const raw = JSON.stringify(r.calls.length ? r.calls : r.text).slice(0, 400);
    return { i, ok: true, kind: p?.kind, option: p?.option, work: p?.work, say: p?.say, reason: p?.reason, verdict: v, reply, raw };
  }), CONC);
  results.push({ id: c.id, cat: c.cat, line: c.line, to: c.to, answered, routeOk, agent, promptHash, samples });
  const pass = samples.filter((s) => s.verdict.pass).length;
  const kinds = new Map<string, number>();
  for (const s of samples) kinds.set(`${s.kind ?? 'error'}${s.option ? ` ${s.option}` : ''}${s.work ? ` ${s.work}` : ''}`, (kinds.get(`${s.kind ?? 'error'}${s.option ? ` ${s.option}` : ''}${s.work ? ` ${s.work}` : ''}`) ?? 0) + 1);
  const replyOk = routeOk ? '' : `; the reply alone ${samples.filter((s) => s.reply?.pass).length}/${samples.length}`;
  console.log(`${pass === samples.length ? 'PASS' : pass ? 'part' : 'FAIL'} ${c.id} (${agent}${routeOk ? '' : `; wanted ${c.to.join('+')}`}): ${pass}/${samples.length}${replyOk}; ${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ')}`);
  for (const s of samples) {
    if (PEEK) console.log(`    ${s.verdict.pass ? 'ok  ' : 'FAIL'} ${s.raw}${s.verdict.detail ? `\n         judge/rule: ${s.verdict.fail ?? ''} ${s.verdict.detail}` : ''}`);
    else if (!s.verdict.pass) console.log(`    FAIL ${s.verdict.fail}${s.verdict.detail ? ` (${s.verdict.detail.slice(0, 160)})` : ''}: ${s.kind ?? ''}${s.option ? ` ${s.option}` : ''} "${(s.say ?? '').slice(0, 140)}"${s.reason ? ` reason "${s.reason.slice(0, 100)}"` : ''}`);
  }
}

// ---- the scorecard ----------------------------------------------------------------------------------------------------

if (!DRY) {
  const CATS: Cat[] = ['combat', 'gathering', 'exploring', 'building', 'talk'];
  const causes = new Map<string, number>();
  const fails = (r: Result) => r.samples.filter((s) => !s.verdict.pass);
  for (const r of results) for (const s of fails(r)) causes.set(s.verdict.fail ?? '?', (causes.get(s.verdict.fail ?? '?') ?? 0) + 1);
  console.log(`\n=== scorecard (${MODEL}, N ${N}, judge ${JUDGE ? 'on' : 'off'})`);
  console.log('category    samples passed  cases all-pass  routing  commonest failure');
  const rows: Array<{ cat: Cat; rate: number }> = [];
  for (const cat of CATS) {
    const rs = results.filter((r) => r.cat === cat);
    if (!rs.length) continue;
    const n = rs.reduce((t, r) => t + r.samples.length, 0), ok = rs.reduce((t, r) => t + r.samples.filter((s) => s.verdict.pass).length, 0);
    const cc = new Map<string, number>();
    for (const r of rs) for (const s of fails(r)) cc.set(s.verdict.fail ?? '?', (cc.get(s.verdict.fail ?? '?') ?? 0) + 1);
    const top = [...cc].sort((a, b) => b[1] - a[1])[0];
    rows.push({ cat, rate: ok / Math.max(1, n) });
    console.log(`${cat.padEnd(11)} ${String(ok).padStart(3)}/${String(n).padEnd(3)} ${String(Math.round((100 * ok) / Math.max(1, n))).padStart(3)}%  ${String(rs.filter((r) => r.samples.length && r.samples.every((s) => s.verdict.pass)).length).padStart(2)}/${String(rs.length).padEnd(2)}         ${String(rs.filter((r) => r.routeOk).length).padStart(2)}/${String(rs.length).padEnd(2)}    ${top ? `${top[0]} (${top[1]})` : '-'}`);
  }
  const n = results.reduce((t, r) => t + r.samples.length, 0), ok = results.reduce((t, r) => t + r.samples.filter((s) => s.verdict.pass).length, 0);
  console.log(`${'all'.padEnd(11)} ${String(ok).padStart(3)}/${String(n).padEnd(3)} ${String(Math.round((100 * ok) / Math.max(1, n))).padStart(3)}%`);
  const weakest = [...rows].sort((a, b) => a.rate - b.rate)[0];
  console.log(`weakest: ${weakest?.cat ?? '-'}; failures by cause: ${[...causes].sort((a, b) => b[1] - a[1]).map(([k, q]) => `${k} ${q}`).join('; ')}`);
  console.log(`calls ${tokens.calls} (errors ${tokens.errors}), tokens ${tokens.prompt} prompt + ${tokens.out} output`);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `chatbench-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify({ model: MODEL, n: N, judge: JUDGE, at: new Date().toISOString(), tokens, results }, null, 1));
  console.log(`wrote ${path.relative(ROOT, file)}`);
}
process.exit(0);

/**
 * Chat routing checked offline (E.0; no server): MineflayerWorld's hearChat/routeChat on fake bots (a name, a position,
 * the events pushed), twelve agents (Mayor, Worker1-11) and a human, Gus. Checks who hears a line (within 48 blocks of
 * its speaker; an unknown position is out of range) and who is woken: a human's line wakes the agents it names (up to 3,
 * any case, wherever they are) or else the nearest in range; an agent's line wakes only agents it names, case-sensitively
 * and in range ("Worker1" is not "Worker10"), at most twice per pair in 5 minutes; a server line wakes no one; a line
 * heard by every bot is routed once. The live check against the test world (with a spectator) is still to run.
 * Usage: node_modules/.bin/tsx scripts/checks/chat_route.mts
 */
import { Vec3 } from 'vec3';

const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');

let failures = 0;
let checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${what}`);
  }
}
const eq = (a: unknown, b: unknown, what: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

type Ev = { type: string; text: string; data?: Record<string, unknown> };
const players: Record<string, { entity?: { position: Vec3 } }> = {};
const bot = (name: string, x: number, z: number) => {
  const events: Ev[] = [];
  return { name, events, bot: { entity: { position: new Vec3(x, 64, z) }, players }, pushEvent: (type: string, text: string, data?: Record<string, unknown>) => events.push({ type, text, data }) };
};
// The Mayor and Worker1-9 within a few blocks of each other; Worker10 and Worker11 100 blocks off
const agents = [bot('Mayor', 0, 0), ...Array.from({ length: 11 }, (_, i) => bot(`Worker${i + 1}`, i < 9 ? 2 + i * 3 : 100, i < 9 ? 1 : 100))];
const w = Object.create(MineflayerWorld.prototype) as InstanceType<typeof MineflayerWorld> & Record<string, unknown>;
Object.assign(w, {
  agents: new Map(agents.map((a) => [a.name.toLowerCase(), a])),
  heardAt: new Map(), chatQueue: Promise.resolve(), pairWakes: new Map(), humanAt: new Map(),
  rcon: { command: async (c: string) => (/Ghost/.test(c) ? 'Ghost has the following entity data: [5.5d, 64.0d, 5.5d]' : 'No entity was found') },
});
const settle = () => (w.chatQueue as Promise<void>).then(() => new Promise((r) => setTimeout(r, 5)));
const clear = () => agents.forEach((a) => (a.events.length = 0));
const heard = () => agents.filter((a) => a.events.some((e) => e.type === 'chat')).map((a) => a.name);
const woken = () => agents.filter((a) => a.events.some((e) => e.data?.wake === true)).map((a) => a.name);
// Every bot hears every line: the world routes it once
const say = async (from: string, text: string) => {
  clear();
  for (let i = 0; i < agents.length; i++) if (agents[i].name !== from) w.hearChat(from, text);
  await settle();
};

players.Gus = { entity: { position: new Vec3(4, 64, 1) } };
await say('Gus', 'hello everyone');
eq(woken(), ['Worker2'], 'a human line with no name wakes the nearest agent in range, one (Worker2, 1 block off)');
eq(heard().length, 10, `the 10 within 48 hear it, the 2 far off do not (${heard().join(',')})`);
ok(agents.every((a) => a.events.filter((e) => e.type === 'chat').length <= 1), 'routed once, though every bot heard it');
await say('Gus', 'Worker3 and Worker7, come here');
eq(woken(), ['Worker3', 'Worker7'], 'a human naming two wakes those two');
await say('Gus', 'mayor, what next?');
eq(woken(), ['Mayor'], 'a human\'s "mayor" wakes the Mayor (any case, as before)');
await say('Gus', 'Worker11, Worker10, Worker2 and Worker5: report');
eq(woken(), ['Worker2', 'Worker10', 'Worker11'], 'at most 3 named, in the order named, wherever they are');
ok(agents.find((a) => a.name === 'Worker11')!.events.some((e) => e.type === 'chat' && e.data?.wake === true && e.data?.distance !== undefined), 'a named agent far off hears it, woken');
// An agent's lines: names only, case-sensitive, in range, capped per pair
await say('Worker2', 'Worker1 can you bring logs');
eq(woken(), ['Worker1'], 'an agent naming Worker1 wakes Worker1, not Worker10 or Worker11');
await say('Worker2', 'the mayor said so');
eq(woken(), [], 'an agent\'s lowercase "mayor" wakes no one');
await say('Worker2', 'Worker10 come');
eq(woken(), [], 'an agent named out of range is not woken');
ok(!heard().includes('Worker10'), 'nor does it hear the line');
await say('Worker2', 'Worker1 again');
await say('Worker2', 'Worker1 a third time');
eq(woken(), [], 'a third wake within 5 minutes from the same agent is capped');
ok(heard().includes('Worker1'), 'the capped line still arrives');
// Unknown positions, spectators, server lines
await say('Nobody', 'hi there');
eq([woken(), heard()], [[], []], 'a human with no known position, naming no one: heard by none');
await say('Nobody', 'Worker4 hi');
eq(woken(), ['Worker4'], 'naming an agent wakes it all the same');
await say('Ghost', 'anyone near?');
eq(woken(), ['Worker2'], 'a spectator the bots do not see: its position from the server, then the nearest');
await say('Server', 'the server restarts soon');
eq([woken().length, heard().length], [0, 12], 'a server line reaches everyone, wakes no one');
// The same line twice within a second: once
clear();
w.hearChat('Gus', 'echo');
w.hearChat('Gus', 'echo');
await settle();
eq(agents.find((a) => a.name === 'Mayor')!.events.length, 1, 'a line heard twice within a second is routed once');

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);

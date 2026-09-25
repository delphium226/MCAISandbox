import type { Game } from './game';
import type { Player } from './player';
import { Mob, MobKind, MOB_SPECS } from './mobs';
import { ITEMS_BY_NAME, itemDef } from '../../shared/src/items';
import { GameMode, DAY_LENGTH } from '../../shared/src/constants';
import { BLOCKS_BY_NAME, makeState } from '../../shared/src/blocks';

interface Command {
  usage: string;
  help: string;
  run(game: Game, p: Player, args: string[]): string | void;
}

const reply = (p: Player, text: string, color = '#aaaaaa') => p.send({ t: 'chat', text, color });

const COMMANDS: Record<string, Command> = {
  help: {
    usage: '/help',
    help: 'List commands',
    run: (_g, p) => {
      for (const [name, c] of Object.entries(COMMANDS)) reply(p, `${c.usage} - ${c.help}`);
      void name;
    },
  },
  gamemode: {
    usage: '/gamemode <survival|creative|spectator> [player]',
    help: 'Change game mode',
    run: (g, p, [mode, target]) => {
      const m = ({ s: 'survival', c: 'creative', sp: 'spectator', '0': 'survival', '1': 'creative', '3': 'spectator' } as Record<string, GameMode>)[mode] ?? (mode as GameMode);
      if (!['survival', 'creative', 'spectator'].includes(m)) return 'Unknown game mode';
      const who = target ? g.getPlayer(target) : p;
      if (!who) return 'Player not found';
      who.setGamemode(m);
      return `Set ${who.name}'s game mode to ${m}`;
    },
  },
  gm: { usage: '/gm <mode>', help: 'Alias of /gamemode', run: (g, p, a) => COMMANDS.gamemode.run(g, p, a) },
  time: {
    usage: '/time <set <day|noon|night|midnight|n>|add n|speed n>',
    help: 'Change the time of day',
    run: (g, _p, [op, val]) => {
      const named: Record<string, number> = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 };
      if (op === 'set') {
        const t = named[val] ?? parseInt(val, 10);
        if (isNaN(t)) return 'Bad time';
        g.time = Math.floor(g.time / DAY_LENGTH) * DAY_LENGTH + t;
      } else if (op === 'add') g.time += parseInt(val, 10) || 0;
      else if (op === 'speed') g.timeRate = Math.max(0, Math.min(100, parseFloat(val) || 1));
      else return 'Usage: ' + COMMANDS.time.usage;
      g.broadcast({ t: 'time', time: g.time, rate: g.doDaylightCycle ? g.timeRate : 0 });
      return `Time is now ${g.time % DAY_LENGTH}`;
    },
  },
  tp: {
    usage: '/tp <x y z | player>',
    help: 'Teleport',
    run: (g, p, args) => {
      if (args.length >= 3) {
        const rel = (s: string, base: number) => (s.startsWith('~') ? base + (parseFloat(s.slice(1)) || 0) : parseFloat(s));
        const [x, y, z] = [rel(args[0], p.x), rel(args[1], p.y), rel(args[2], p.z)];
        if ([x, y, z].some(isNaN)) return 'Bad coordinates';
        p.teleport(x, y, z);
        return `Teleported to ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}`;
      }
      const t = g.getPlayer(args[0] ?? '');
      if (!t) return 'Player not found';
      p.teleport(t.x, t.y, t.z);
      return `Teleported to ${t.name}`;
    },
  },
  give: {
    usage: '/give <item> [count] [player]',
    help: 'Give items',
    run: (g, p, [name, count, target]) => {
      const it = ITEMS_BY_NAME.get((name ?? '').replace(/^minecraft:/, ''));
      if (!it) return `Unknown item ${name}`;
      const who = target ? g.getPlayer(target) : p;
      if (!who) return 'Player not found';
      let n = Math.max(1, Math.min(64 * 36, parseInt(count, 10) || 1));
      while (n > 0) {
        const c = Math.min(n, it.stackSize);
        who.giveOrDrop({ id: it.id, count: c });
        n -= c;
      }
      return `Gave ${count || 1} ${it.displayName} to ${who.name}`;
    },
  },
  spawn: { usage: '/spawn', help: 'Teleport to world spawn', run: (g, p) => { p.teleport(g.spawn.x, g.spawn.y, g.spawn.z); } },
  setspawn: {
    usage: '/setspawn',
    help: 'Set the world spawn to your position',
    run: (g, p) => {
      g.spawn = { x: p.x, y: p.y, z: p.z };
      return 'World spawn set';
    },
  },
  seed: { usage: '/seed', help: 'Show world seed', run: (g) => `Seed: ${g.seed}` },
  kill: { usage: '/kill', help: 'Kill yourself', run: (_g, p) => { p.gamemode = 'survival'; p.health = 0; p.die(null); } },
  summon: {
    usage: '/summon <mob> [count]',
    help: 'Summon a mob near you',
    run: (g, p, [kind, count]) => {
      if (!(kind in MOB_SPECS)) return `Unknown mob. Options: ${Object.keys(MOB_SPECS).join(', ')}`;
      const n = Math.min(20, parseInt(count, 10) || 1);
      const d = p.lookDir();
      for (let i = 0; i < n; i++) g.addEntity(new Mob(g, kind as MobKind, p.x + d[0] * 3 + Math.random(), p.y + 0.5, p.z + d[2] * 3 + Math.random()));
      return `Summoned ${n} ${kind}`;
    },
  },
  heal: { usage: '/heal', help: 'Restore health and hunger', run: (_g, p) => { p.health = p.maxHealth; p.food = 20; p.saturation = 5; p.sendHealth(); return 'Healed'; } },
  clear: { usage: '/clear', help: 'Clear your inventory', run: (_g, p) => { p.inventory.fill(null); p.armor.fill(null); p.sendInventory(); return 'Inventory cleared'; } },
  list: { usage: '/list', help: 'List players', run: (g) => `Online (${g.players.size}): ${[...g.players].map((p) => p.name + (p.isAgent ? ' [AI]' : '')).join(', ')}` },
  gamerule: {
    usage: '/gamerule <doMobSpawning|doDaylightCycle|pvp> <true|false>',
    help: 'Toggle game rules',
    run: (g, _p, [rule, v]) => {
      const b = v === 'true';
      if (rule === 'doMobSpawning') g.doMobSpawning = b;
      else if (rule === 'doDaylightCycle') { g.doDaylightCycle = b; g.broadcast({ t: 'time', time: g.time, rate: b ? g.timeRate : 0 }); }
      else if (rule === 'pvp') g.pvp = b;
      else return 'Unknown rule';
      return `${rule} = ${b}`;
    },
  },
  setblock: {
    usage: '/setblock <x> <y> <z> <block>',
    help: 'Place a block',
    run: (g, p, [x, y, z, name]) => {
      const b = BLOCKS_BY_NAME.get(name ?? '');
      if (!b) return 'Unknown block';
      const rel = (s: string, base: number) => (s.startsWith('~') ? Math.floor(base) + (parseInt(s.slice(1), 10) || 0) : parseInt(s, 10));
      g.world.set(rel(x, p.x), rel(y, p.y), rel(z, p.z), makeState(b.id, 0));
      return 'Block placed';
    },
  },
  killall: {
    usage: '/killall [hostile|all]',
    help: 'Remove mobs',
    run: (g, _p, [what]) => {
      let n = 0;
      for (const e of g.entities.values()) if (e instanceof Mob && (what === 'all' || e.hostile)) { e.remove(); n++; }
      return `Removed ${n} mobs`;
    },
  },
  agent: {
    usage: '/agent <spawn name [role]|remove name|list|say name text>',
    help: 'Manage AI agents',
    run: (g, p, args) => g.agents.command(p, args),
  },
  whereami: { usage: '/whereami', help: 'Show coordinates', run: (_g, p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}` },
  item: {
    usage: '/item',
    help: 'Show held item id',
    run: (_g, p) => {
      const h = p.heldItem();
      return h ? `${itemDef(h.id).name} x${h.count}${h.damage ? ` (damage ${h.damage})` : ''}` : 'Empty hand';
    },
  },
};

export function handleCommand(game: Game, p: Player, line: string) {
  const [name, ...args] = line.trim().split(/\s+/);
  const cmd = COMMANDS[name?.toLowerCase() ?? ''];
  if (!cmd) return reply(p, `Unknown command /${name}. Try /help`, '#ff5555');
  // Allow cheats in this sandbox; restrict agent commands to humans
  try {
    const out = cmd.run(game, p, args);
    if (out) reply(p, out);
  } catch (e) {
    reply(p, `Error: ${(e as Error).message}`, '#ff5555');
  }
}

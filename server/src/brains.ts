/**
 * Agent "brains": in-process decision makers that choose which skills an agent runs.
 *
 * To plug in an LLM or a PIANO-style cognitive architecture, implement AgentBrain:
 *   - tick(agent) is called every server tick (20 Hz) — keep it cheap; do slow work asynchronously
 *     (e.g. call an LLM with agent.observe() and enqueue the returned actions when the promise resolves).
 *   - onEvent(agent, event) receives chat, damage, crafting results, action completions, ...
 * External controllers can do the same over HTTP (see README "Agent API").
 */
import type { Agent, AgentEvent } from './agents';
import { itemId, itemDef } from '../../shared/src/items';
import { countItem } from '../../shared/src/inventory';
import { LLMBrain } from './llmBrain';
import { TieredBrain } from './tieredBrain';

export interface AgentBrain {
  name: string;
  init?(agent: Agent): void;
  tick?(agent: Agent): void;
  onEvent?(agent: Agent, e: AgentEvent): void;
}

const has = (a: Agent, item: string) => countItem(a.player.inventory, itemId(item));
const hasAny = (a: Agent, items: string[]) => items.reduce((s, i) => s + has(a, i), 0);

/** Does nothing on its own; controlled entirely via the API or /agent do. */
class IdleBrain implements AgentBrain {
  name = 'idle';
}

/**
 * Scripted survival worker: gathers wood, crafts tools, mines stone/coal/iron, smelts, and chats.
 * Responds to simple natural-language requests from nearby players ("follow me", "come here",
 * "give me <item>", "stop", "what are you doing?"). Serves as a baseline and as a smoke test for skills.
 */
class WorkerBrain implements AgentBrain {
  name = 'worker';
  private cooldown = 40;
  private failures = new Map<string, number>();
  private lastChat = 0;
  private obeying = 0;

  init(a: Agent) {
    a.memory.goal = 'get started';
  }

  onEvent(a: Agent, e: AgentEvent) {
    if (e.type === 'chat') {
      const from = String(e.data?.from ?? '');
      const text = String(e.data?.text ?? '').toLowerCase();
      const me = a.player.name.toLowerCase();
      const addressed = text.includes(me) || (e.data?.distance as number) < 8;
      if (!addressed || from === a.player.name) return;
      const reply = (m: string) => a.enqueue('chat', { message: m }, false);
      if (/\b(stop|wait|halt)\b/.test(text)) {
        a.stop();
        this.obeying = 20 * 30;
        reply('Okay, stopping.');
      } else if (/follow/.test(text)) {
        a.stop();
        this.obeying = 20 * 60;
        reply(`Following you, ${from}!`);
        a.enqueue('follow', { player: from, distance: 3, seconds: 60 });
      } else if (/come( here)?|over here/.test(text)) {
        const p = a.game.getPlayer(from);
        if (p) {
          a.stop();
          this.obeying = 20 * 20;
          reply('On my way.');
          a.enqueue('move_to', { x: p.x, y: p.y, z: p.z, range: 2 });
        }
      } else if (/give me (some |a |an )?([a-z_ ]+)/.test(text)) {
        const m = text.match(/give me (?:some |a |an )?([a-z_ ]+)/)!;
        const want = m[1].trim().replace(/ /g, '_').replace(/s$/, '');
        const inv = a.player.inventory.filter(Boolean).map((s) => itemDef(s!.id).name);
        const match = inv.find((n) => n === want || n.includes(want));
        if (match) {
          reply(`Here's some ${match.replace(/_/g, ' ')}.`);
          a.enqueue('give', { player: from, item: match, count: Math.min(8, has(a, match)) });
        } else reply(`Sorry, I don't have any ${want.replace(/_/g, ' ')}.`);
      } else if (/what are you doing|status|how are you/.test(text)) {
        reply(`I'm working on: ${a.memory.goal}. I have ${Object.entries(a.observe(4).inventory).slice(0, 5).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ') || 'nothing yet'}.`);
      } else if (/\b(hi|hello|hey|yo)\b/.test(text)) {
        reply(`Hi ${from}! I'm ${a.player.name}, the ${a.role}.`);
      }
    } else if (e.type === 'action_failed') {
      const type = String(e.data?.type ?? '');
      this.failures.set(String(a.memory.goal), (this.failures.get(String(a.memory.goal)) ?? 0) + 1);
      if (type === 'collect') a.enqueue('explore', { distance: 24 });
    } else if (e.type === 'damage') {
      /* handled in tick */
    }
  }

  tick(a: Agent) {
    if (this.obeying > 0) {
      this.obeying--;
      return;
    }
    if (a.current || a.queue.length) return;
    if (--this.cooldown > 0) return;
    this.cooldown = 10;
    const p = a.player;
    // Survival first
    const threat = [...a.game.entitiesNear(p.x, p.y, p.z, 10)].find((e) => ['zombie', 'skeleton', 'spider', 'creeper'].includes(e.kind) && !e.removed);
    if (threat) {
      a.memory.goal = `fight off a ${threat.kind}`;
      a.enqueue('attack', { id: threat.id });
      return;
    }
    if (p.food < 14 && a.player.inventory.some((s) => s && itemDef(s.id).food)) {
      a.memory.goal = 'eat';
      a.enqueue('eat', {});
      return;
    }
    const plan = this.nextGoal(a);
    if (!plan) {
      a.memory.goal = 'exploring';
      a.enqueue('explore', { distance: 40 });
      return;
    }
    const [goal, action, args] = plan;
    if ((this.failures.get(goal) ?? 0) > 3) {
      this.failures.set(goal, 0);
      a.memory.goal = 'exploring for resources';
      a.enqueue('explore', { distance: 48 });
      return;
    }
    if (a.memory.goal !== goal && a.game.tick - this.lastChat > 20 * 20 && Math.random() < 0.5) {
      this.lastChat = a.game.tick;
      a.enqueue('chat', { message: CHATTER[Math.floor(Math.random() * CHATTER.length)].replace('%s', goal) });
    }
    a.memory.goal = goal;
    a.enqueue(action, args);
  }

  private nextGoal(a: Agent): [string, string, Record<string, unknown>] | null {
    const logs = hasAny(a, ['oak_log', 'birch_log', 'spruce_log']);
    const planks = hasAny(a, ['oak_planks', 'birch_planks', 'spruce_planks']);
    const sticks = has(a, 'stick');
    const woodPick = has(a, 'wooden_pickaxe') + has(a, 'stone_pickaxe') + has(a, 'iron_pickaxe');
    const table = has(a, 'crafting_table');
    const cobble = has(a, 'cobblestone');
    if (!woodPick) {
      if (planks < 3 + (table ? 0 : 4) + (sticks >= 2 ? 0 : 2) && logs < 1) return ['gather wood', 'collect', { block: 'logs', count: 4 }];
      if (planks < 7 && logs > 0) {
        const log = ['oak_log', 'birch_log', 'spruce_log'].find((l) => has(a, l))!;
        return ['make planks', 'craft', { item: log.replace('_log', '_planks'), count: 4 }];
      }
      if (!table && !a.findNearestBlock((id) => id === itemId('crafting_table'), 12)) return ['make a crafting table', 'craft', { item: 'crafting_table' }];
      if (sticks < 2) return ['make sticks', 'craft', { item: 'stick' }];
      return ['make a wooden pickaxe', 'craft', { item: 'wooden_pickaxe' }];
    }
    if (!has(a, 'stone_pickaxe') && !has(a, 'iron_pickaxe')) {
      if (cobble < 3) return ['mine stone', 'collect', { block: 'stone', count: 3 }];
      if (sticks < 2) return planks >= 2 ? ['make sticks', 'craft', { item: 'stick' }] : ['gather wood', 'collect', { block: 'logs', count: 2 }];
      return ['make a stone pickaxe', 'craft', { item: 'stone_pickaxe' }];
    }
    if (!has(a, 'stone_axe') && !has(a, 'iron_axe')) {
      if (cobble < 3) return ['mine stone', 'collect', { block: 'stone', count: 3 }];
      if (sticks < 2) return planks >= 2 ? ['make sticks', 'craft', { item: 'stick' }] : ['gather wood', 'collect', { block: 'logs', count: 2 }];
      return ['make a stone axe', 'craft', { item: 'stone_axe' }];
    }
    if (!has(a, 'furnace') && !a.findNearestBlock((id) => id === itemId('furnace'), 16)) {
      if (cobble < 8) return ['mine stone for a furnace', 'collect', { block: 'stone', count: 8 - cobble }];
      return ['build a furnace', 'craft', { item: 'furnace' }];
    }
    if (has(a, 'coal') < 4 && !has(a, 'iron_pickaxe')) return ['find coal', 'collect', { block: 'coal_ore', count: 4 }];
    if (has(a, 'torch') < 8 && has(a, 'coal') > 0) {
      if (sticks < 1) return planks >= 2 ? ['make sticks', 'craft', { item: 'stick' }] : ['gather wood', 'collect', { block: 'logs', count: 2 }];
      return ['make torches', 'craft', { item: 'torch', count: 8 }];
    }
    if (!has(a, 'iron_pickaxe')) {
      const iron = has(a, 'iron_ingot');
      if (iron < 3) {
        if (has(a, 'iron_ore') >= 3 - iron) return ['smelt iron', 'smelt', { item: 'iron_ore', count: 3 - iron }];
        return ['find iron', 'collect', { block: 'iron_ore', count: 3 - iron }];
      }
      if (sticks < 2) return planks >= 2 ? ['make sticks', 'craft', { item: 'stick' }] : ['gather wood', 'collect', { block: 'logs', count: 2 }];
      return ['make an iron pickaxe', 'craft', { item: 'iron_pickaxe' }];
    }
    if (logs + planks < 32) return ['stockpile wood', 'collect', { block: 'logs', count: 8 }];
    return null;
  }
}

const CHATTER = [
  'Time to %s.',
  "Next up: %s.",
  'I think I should %s now.',
  "Let's %s!",
  'Going to %s.',
];

/** Follows the nearest human player around and chats occasionally — a simple companion. */
class CompanionBrain implements AgentBrain {
  name = 'companion';
  tick(a: Agent) {
    if (a.current || a.queue.length) return;
    if (a.game.tick % 20 !== 0) return;
    const human = a.game.nearestPlayer(a.player.x, a.player.y, a.player.z, 64, (p) => !p.isAgent);
    if (human) a.enqueue('follow', { player: human.name, distance: 3, seconds: 10 });
    else a.enqueue('explore', { distance: 16 });
  }
  onEvent(a: Agent, e: AgentEvent) {
    if (e.type === 'chat' && /hello|hi\b/i.test(String(e.data?.text))) a.enqueue('chat', { message: `Hello ${e.data?.from}!` }, true);
  }
}

export const BRAINS: Record<string, () => AgentBrain> = {
  idle: () => new IdleBrain(),
  worker: () => new WorkerBrain(),
  companion: () => new CompanionBrain(),
  llm: () => new LLMBrain(),
  tiered: () => new TieredBrain(),
};

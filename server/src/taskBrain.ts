/**
 * A scripted village worker for testing: it claims tasks from the village board like a tiered worker, but instead of
 * asking a model it runs the skill calls the task itself spells out ("collect block=logs count=12, then deposit
 * item=all", 'build_design "cottage" x=71 z=-109'). The tasks code posts (plan_layout, material tasks) are written that
 * way, so a village of task workers tests the skills, storage, layout and building end to end in minutes, without model
 * latency or model mistakes. Tiered agents are for testing behaviour.
 */
import type { AgentBrain, AgentEvent, WorldAgent } from './world';

interface Call { type: string; args: Record<string, unknown> }

/** The skill calls in a task's detail: comma- or semicolon-separated "skill key=value ..." clauses; prose is ignored. */
export function taskCalls(detail: string, skills: Set<string>): Call[] {
  const calls: Call[] = [];
  const text = detail.replace(/\([^)]*\)/g, ' ');
  for (const raw of text.split(/[,;]/)) {
    const clause = raw.replace(/^\s*(then|and)\s+/i, '').split(':')[0].trim();
    const m = /^([a-z_]+)\b(.*)$/.exec(clause);
    if (!m || !skills.has(m[1])) continue;
    const args: Record<string, unknown> = {};
    const quoted = /"([^"]+)"/.exec(m[2]);
    if (quoted && m[1] === 'build_design') args.design = quoted[1];
    for (const [, k, v] of m[2].matchAll(/([a-z_]+)=("[^"]*"|\S+)/g)) {
      const val = v.replace(/^"|"$/g, '');
      args[k] = /^-?\d+(\.\d+)?$/.test(val) ? Number(val) : val;
    }
    calls.push({ type: m[1], args });
  }
  return calls;
}

export class TaskBrain implements AgentBrain {
  name = 'tasks';
  private task: string | null = null;
  private calls: Call[] = [];
  private waiting = false;
  private failures = 0;
  /** Fixes tried for the current task (a pickaxe crafted, logs collected for it). */
  private fixes = 0;

  onEvent(a: WorldAgent, e: AgentEvent) {
    if (!this.task || !this.waiting) return;
    if (e.type === 'action_done') {
      this.waiting = false;
      this.calls.shift();
      this.failures = 0;
    } else if (e.type === 'action_failed') {
      this.waiting = false;
      const msg = String(e.data?.message ?? e.text);
      // A gather task whose material is not to be had near the village fails at once, with the other tasks for it, as
      // in the tiered brain: retried and taken again, Shelf's sand tasks failed 12 times in 20 s (F96)
      const v = a.village();
      const held = v?.tasks.find((t) => t.id === this.task);
      const block = String((e.data?.args as Record<string, unknown> | undefined)?.block ?? '').toLowerCase();
      if (v && held?.soft && e.data?.type === 'collect' && block && held.detail.toLowerCase().includes(`collect block=${block} `)
        && /cannot be gathered here|none left within 96 blocks/.test(msg)) {
        const none = /cannot be gathered here/.test(msg);
        a.world.villages.noneToGather(v, held.id, a.name, block, msg, none);
        this.task = null;
        this.calls = [];
        this.failures = 0;
        this.fixes = 0;
        // What was gathered goes into the storage all the same
        if (!none) try { a.enqueue('deposit', { item: 'all' }); } catch { /* nothing to deposit with: kept for the next task's deposit */ }
        return;
      }
      // What a player would do, from the failure messages: craft the missing tool, collect the missing logs
      const tool = /needs (?:an? )?(\w+_(?:pickaxe|axe|shovel))/.exec(msg);
      const logs = /collect (\d+) more logs?/.exec(msg);
      if ((tool || logs) && this.fixes++ < 4) {
        this.calls.unshift(logs ? { type: 'collect', args: { block: 'logs', count: Number(logs[1]) } } : { type: 'craft', args: { item: tool![1] } });
        return;
      }
      // One retry (walks time out, chunks load late), then the task goes back to the board with the reason
      if (++this.failures >= 2) this.giveUp(a, msg);
    }
  }

  private giveUp(a: WorldAgent, why: string) {
    const v = a.village();
    if (v && this.task && v.tasks.find((t) => t.id === this.task)?.claimedBy === a.name) a.world.villages.giveUp(v, this.task, a.name, why);
    this.task = null;
    this.calls = [];
    this.failures = 0;
    this.fixes = 0;
  }

  tick(a: WorldAgent) {
    const v = a.village();
    if (!v || v.complete || this.waiting || !a.idle()) return;
    const reg = a.world.villages;
    const held = this.task ? v.tasks.find((t) => t.id === this.task) : undefined;
    // Finished or taken back by code (the first deposit completes the storage task; a short build goes back to the board)
    if (this.task && (!held || held.status !== 'claimed' || held.claimedBy !== a.name)) {
      this.task = null;
      this.calls = [];
    }
    if (!this.task) {
      const next = reg.claimable(v)[0];
      if (!next || !reg.claim(v, next.id, a.name)) return;
      this.task = next.id;
      this.fixes = 0;
      this.calls = taskCalls(next.detail, new Set(a.world.skills.map((s) => s.name)));
      a.pushEvent('system', `Took task ${next.id} ${next.title}: ${this.calls.map((c) => c.type).join(', ') || 'nothing to run'}`);
      if (!this.calls.length) return this.giveUp(a, 'the task names no skill calls a scripted worker can run');
    }
    if (!this.calls.length) {
      reg.finish(v, this.task!, a.name, 'done by the task runner');
      this.task = null;
      return;
    }
    try {
      a.enqueue(this.calls[0].type, this.calls[0].args);
      this.waiting = true;
    } catch (e) {
      this.giveUp(a, (e as Error).message);
    }
  }
}

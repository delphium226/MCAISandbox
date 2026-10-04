/**
 * A scripted village worker for testing: it claims tasks from the village board like a tiered worker, but instead of
 * asking a model it runs the skill calls the task itself spells out ("collect block=logs count=12, then deposit
 * item=all", 'build_design "cottage" x=71 z=-109'). The tasks code posts (plan_layout, material tasks) are written that
 * way, so a village of task workers tests the skills, storage, layout and building end to end in minutes, without model
 * latency or model mistakes. Tiered agents are for testing behaviour.
 */
import type { Task } from './village';
import type { AgentBrain, AgentEvent, WorldAgent } from './world';

interface Call { type: string; args: Record<string, unknown> }

/** A task runner limited to some tasks (the mayor's gathering while it waits, V2.3m). */
export interface TaskRunnerOptions {
  /** The ready tasks it may take, best first (default: all of them, in board order). */
  pick?: (ready: Task[]) => Task[];
  /**
   * Failures that are not the task's fault (a busy mine): the task goes back without a try counted, and tasks for that
   * material are left alone for a few minutes (else the same task is taken and waited on again).
   */
  notTheTask?: RegExp;
}

const AVOID_MS = 3 * 60000;

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
  /** The action it waits for, and the ones it queued lately (another brain sharing the agent tells them apart). */
  private action: number | undefined;
  private mine = new Set<number>();
  /** Materials (collect block) whose tasks it leaves alone until then (notTheTask). */
  private avoid = new Map<string, number>();

  constructor(private opts: TaskRunnerOptions = {}) {}

  /** The task it holds. */
  get held(): string | null {
    return this.task;
  }

  /** Whether it queued this action. */
  owns(action: unknown): boolean {
    return typeof action === 'number' && this.mine.has(action);
  }

  private enqueue(a: WorldAgent, type: string, args: Record<string, unknown>): number {
    const id = a.enqueue(type, args).id;
    this.mine.add(id);
    if (this.mine.size > 100) this.mine.delete(this.mine.values().next().value!);
    return id;
  }

  /**
   * Stop the task it holds: back on the board without a try counted (`done`: closed as done, with `why` as its result).
   * What it gathered goes into the storage (once the task is no longer held, nothing counts it as carried for it).
   */
  handBack(a: WorldAgent, why: string, done = false, stop = true) {
    const v = a.village();
    const id = this.task;
    if (!id) return;
    const item = /collect block=(\S+)/.exec(v?.tasks.find((t) => t.id === id)?.detail ?? '')?.[1];
    this.reset();
    if (stop) a.stop();
    if (v && v.tasks.find((t) => t.id === id)?.claimedBy === a.name) {
      if (done) a.world.villages.finish(v, id, a.name, why);
      else a.world.villages.unclaim(v, id, a.name, why);
    }
    a.pushEvent('system', `Handed back task ${id}: ${why.slice(0, 120)}`);
    if (item) this.depositCarried(a, item);
  }

  private reset() {
    this.task = null;
    this.calls = [];
    this.waiting = false;
    this.action = undefined;
    this.failures = 0;
    this.fixes = 0;
  }

  /**
   * Deposit the task's own material when it carries some, by name: "all" leaves out what the world counts as junk (dirt
   * a floor needs, once the task is not held), and a deposit of nothing would fail. The rest waits for the next deposit.
   */
  private depositCarried(a: WorldAgent, item: string) {
    const inv = a.observe(1).inventory ?? {};
    if (!Object.keys(inv).some((k) => (inv[k] ?? 0) > 0 && (k === item || (/^logs?$/.test(item) && /_(log|stem)$/.test(k))))) return;
    try { this.enqueue(a, 'deposit', { item }); } catch { /* kept for the next task's deposit */ }
  }

  onEvent(a: WorldAgent, e: AgentEvent) {
    if (!this.task || !this.waiting) return;
    // Only its own call ends the wait (an urgent chat turn of the brain it serves also ends in action_done)
    // (both worlds put the action's id in these events; a call the brain refused before queuing has none)
    if ((e.type === 'action_done' || e.type === 'action_failed') && this.action !== undefined && e.data?.action !== this.action) return;
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
        this.reset();
        // What was gathered goes into the storage all the same
        if (!none) try { this.enqueue(a, 'deposit', { item: 'all' }); } catch { /* nothing to deposit with: kept for the next task's deposit */ }
        return;
      }
      if (this.opts.notTheTask?.test(msg)) {
        const item = /collect block=(\S+)/.exec(held?.detail ?? '')?.[1];
        if (item) this.avoid.set(item, Date.now() + AVOID_MS);
        // (the action has ended: nothing to stop, and a stop inside the world's own failure report would cut it up)
        return this.handBack(a, msg, false, false);
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
    this.reset();
  }

  /** `mayClaim` false: go on with the task it holds, take no new one. */
  tick(a: WorldAgent, mayClaim = true) {
    const v = a.village();
    // Idle while waiting: the action was stopped without a report (a stop clears it silently: death, the panel's stop
    // button); the call runs once more, the second time the task goes back (else it is held for good)
    if (this.waiting && a.idle()) {
      this.waiting = false;
      this.action = undefined;
      if (++this.failures >= 2) this.giveUp(a, 'its action was stopped twice');
    }
    if (!v || v.complete || this.waiting || !a.idle()) return;
    const reg = a.world.villages;
    const held = this.task ? v.tasks.find((t) => t.id === this.task) : undefined;
    // Finished or taken back by code (the first deposit completes the storage task; a short build goes back to the board)
    if (this.task && (!held || held.status !== 'claimed' || held.claimedBy !== a.name)) {
      this.task = null;
      this.calls = [];
    }
    if (!this.task) {
      if (!mayClaim) return;
      const now = Date.now();
      const ready = reg.claimable(v).filter((t) => {
        const item = /collect block=(\S+)/.exec(t.detail)?.[1];
        return !item || (this.avoid.get(item) ?? 0) < now;
      });
      const next = (this.opts.pick ? this.opts.pick(ready) : ready)[0];
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
      this.action = this.enqueue(a, this.calls[0].type, this.calls[0].args);
      this.waiting = true;
    } catch (e) {
      this.giveUp(a, (e as Error).message);
    }
  }
}

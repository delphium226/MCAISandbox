/**
 * #188, offline: the lava hazard on stub bots. The entity's isInLava flag counts only with lava in the cells its box
 * stands in (a respawn keeps the dead bot's flag: a stale "lava" at the world spawn); lava at the feet or beside the box
 * counts; the lava step steers out (stub physics: each tick moves the bot a step toward where it faces) and gives up
 * after LAVA_STEP_MS.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/hazard_unit.mts
 */
import { Vec3 } from 'vec3';
import type { BotAgent } from '../../server/src/mineflayer/botAgent';
const H = await import('../../server/src/mineflayer/mcHazard');

let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};

type Stub = { a: BotAgent; e: { position: Vec3; isInLava: boolean }; controls: Record<string, boolean> };
/** A bot at `p` in a world of stone below y 64, air above, and lava at `lava` cells. */
function stub(p: Vec3, lava: string[], isInLava: boolean, walkable = true): Stub {
  const e = { position: p, isInLava };
  const controls: Record<string, boolean> = {};
  let facing = new Vec3(1, 0, 0);
  const blockAt = (q: Vec3) => {
    const k = `${q.x},${q.y},${q.z}`;
    if (lava.includes(k)) return { name: 'lava', boundingBox: 'empty' };
    return q.y < 64 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' };
  };
  const bot = {
    entity: e, health: 20, blockAt, oxygenLevel: 20,
    lookAt: async (t: Vec3) => { const d = t.minus(e.position); facing = new Vec3(Math.sign(Math.round(d.x)), 0, Math.sign(Math.round(d.z))); },
    setControlState: (k: string, v: boolean) => { controls[k] = v; },
    clearControlStates: () => { for (const k of Object.keys(controls)) controls[k] = false; },
  };
  // (stub physics: forward moves 0.25 a tick, about sprinting's speed, when the bot can walk)
  const tick = setInterval(() => { if (controls.forward && walkable) e.position = e.position.plus(facing.scaled(0.25)); }, 50);
  tick.unref();
  return { a: { bot } as unknown as BotAgent, e, controls };
}

// 1. The stale flag: isInLava with no lava near is no hazard; lava at the feet is
{
  const s = stub(new Vec3(1.5, 64, 8.5), [], true);
  ok(H.hazardOf(s.a) === null, 'a stale isInLava at the world spawn is no hazard');
  const t = stub(new Vec3(1.5, 64, 8.5), ['1,64,8'], false);
  ok(H.hazardOf(t.a) === 'lava', 'lava at the feet is, flag or not');
  // (the box reaches 0.3 into the next cell: lava there with the flag set counts)
  const u = stub(new Vec3(1.8, 64, 8.5), ['2,64,8'], true);
  ok(H.hazardOf(u.a) === 'lava', 'lava beside the feet within the box, with the flag');
  const w = stub(new Vec3(1.5, 64, 8.5), ['3,64,8'], true);
  ok(H.hazardOf(w.a) === null, 'lava two cells off is not');
  ok(H.lavaAround(stub(new Vec3(1.5, 64, 8.5), ['1,65,8'], false).a, new Vec3(1.5, 64, 8.5)), 'lava at the head counts for the box');
}

// 2. The lava step: out within the cap toward the safe cell; a bot that cannot move gives up at LAVA_STEP_MS
{
  const s = stub(new Vec3(1.5, 64, 8.5), ['1,64,8'], true);
  const c = H.safeCellNear(s.a);
  ok(!!c && c.y === 64, `a safe cell beside the lava (${c})`);
  const t0 = Date.now();
  const out = await H.lavaStep(s.a, c, new AbortController().signal);
  const ms = Date.now() - t0;
  ok(out && ms < 1000, `stepped out in ${ms} ms`);
  ok(!s.controls.forward && !s.controls.jump, 'controls cleared after');
  const stuck = stub(new Vec3(1.5, 64, 8.5), ['1,64,8'], true, false);
  const t1 = Date.now();
  const out2 = await H.lavaStep(stuck.a, null, new AbortController().signal);
  const ms2 = Date.now() - t1;
  ok(!out2 && ms2 >= H.LAVA_STEP_MS && ms2 < H.LAVA_STEP_MS + 400, `a stuck bot gives up after ${ms2} ms`);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  let cancelled = false;
  await H.lavaStep(stub(new Vec3(1.5, 64, 8.5), ['1,64,8'], true, false).a, null, ac.signal).catch((e: Error) => { cancelled = e.message === 'cancelled'; });
  ok(cancelled, 'an abort cancels the step');
}

console.log(`hazard_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

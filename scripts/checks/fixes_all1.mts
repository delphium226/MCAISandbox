// All1's fixes (F304), offline: MC_BAN_SCOPE=member (a ban is the failing member's own and short, never the village's),
// MC_CHOOSE_BACKUP (the model's second option in the schema and read from the reply), MC_ACT_HINTS (#114: a request for
// an item not on offer is told what is close and that nobody makes axes here). Each in a child process (flags at import).
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/fixes_all1.mts
import { execFileSync } from 'node:child_process';

const part = process.env.FIX_PART;
if (part === 'ban') {
  const { ChoiceStats } = await import('../../server/src/choose');
  const st = new ChoiceStats();
  const fail = (agent: string, at: number) => st.record({ village: 'V', agent, kind: 'iron', id: 'iron:dig', ok: false, cut: false, contention: false, productive: false, minutes: 1, at, line: 'x' } as never);
  fail('Ada', 1000);
  fail('Ada', 2000);
  fail('Ben', 3000);
  const ada = st.banned('V', 'iron', 'iron:dig', 4000, 'Ada'), ben = st.banned('V', 'iron', 'iron:dig', 4000, 'Ben'), cy = st.banned('V', 'iron', 'iron:dig', 4000, 'Cy');
  const later = st.banned('V', 'iron', 'iron:dig', 2000 + 20 * 60000 + 1, 'Ada');
  console.log(JSON.stringify({ ada: !!ada, ben: !!ben, cy: !!cy, later: !!later, scope: ada?.scope }));
} else if (part === 'backup') {
  const { buildPrompt } = await import('../../server/src/choose');
  const opt = (id: string, name: string) => ({ id, kind: 'make', key: id, holds: [], excludes: [], name, facts: '', effect: '', rank: 0 });
  const shown = [opt('make:a', 'Make A'), opt('make:b', 'Make B')];
  const p = buildPrompt({ options: shown, ctx: {} } as never, shown as never);
  const props = (p.tools[0].input_schema as { properties: Record<string, unknown> }).properties;
  console.log(JSON.stringify({ backup: 'backup' in props }));
} else if (part === 'hint') {
  const { notOnOffer } = await import('../../server/src/acts');
  const w = { items: new Map([['make:stone_pickaxe', 'stone pickaxes'], ['make:stone_hoe', 'stone hoes'], ['gather:logs', 'logs'], ['make:bread', 'bread']]) };
  console.log(JSON.stringify({ axe: notOnOffer(w as never, 'stone axe'), oak: notOnOffer(w as never, 'oak axe'), wheat: notOnOffer(w as never, 'wheat') }));
} else {
  const run = (p: string, env: Record<string, string>) => JSON.parse(execFileSync(process.execPath, [...process.execArgv, process.argv[1]], { env: { ...process.env, FIX_PART: p, MC_BAN_SCOPE: '', MC_CHOOSE_BACKUP: '', MC_ACT_HINTS: '', ...env }, encoding: 'utf-8' }).trim().split('\n').pop()!);
  let fails = 0;
  const ok = (c: boolean, what: string) => {
    if (!c) fails++;
    console.log(`${c ? 'ok  ' : 'FAIL'} ${what}`);
  };
  const b0 = run('ban', {}), b1 = run('ban', { MC_BAN_SCOPE: 'member' });
  ok(b0.ada && b0.ben && b0.cy, `default: 3 failures ban iron:dig for the whole village ${JSON.stringify(b0)}`);
  ok(b1.ada && !b1.ben && !b1.cy && !b1.later && b1.scope === 'id', `member: Ada's own 2 failures ban Ada alone, for 20 minutes ${JSON.stringify(b1)}`);
  const k0 = run('backup', {}), k1 = run('backup', { MC_CHOOSE_BACKUP: 'on' });
  ok(!k0.backup && k1.backup, `the backup field only with MC_CHOOSE_BACKUP (${k0.backup} / ${k1.backup})`);
  const h = run('hint', {});
  ok(/nobody makes axes here/.test(h.axe) && /stone pickaxes/.test(h.axe), `hint for "stone axe": ${h.axe}`);
  ok(/nobody makes axes here/.test(h.oak), `hint for "oak axe": ${h.oak}`);
  ok(!/nobody makes/.test(h.wheat) && /items such as/.test(h.wheat), `hint for "wheat": ${h.wheat}`);
  console.log(fails ? `fixes_all1: ${fails} failed` : 'fixes_all1: all passed');
  process.exit(fails ? 1 : 0);
}

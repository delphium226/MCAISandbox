/**
 * G2's awareness (social.ts, #27), offline: observations by distance (each chore once, meeting within 16 blocks), help and
 * promises into profiles, the profile line (no pronouns), the awareness block's arms and its cap at 25 members, roles
 * (the modal kind of the last 5 model choices, a change logged), the village day line hidden under off.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/social_unit.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-unit-'));
process.env.MC_MEMORY = 'on';
process.env.MC_CLOCK = 'off';
process.env.MCAI_SOCIAL = 'on';
process.env.MCAI_ACTS_LOG = path.join(dir, 'acts.jsonl');

const mem = await import('../../server/src/memory');
const soc = await import('../../server/src/social');
const { NAME_POOL } = await import('../../server/src/agentNames');

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL ${what}`);
  }
};

mem.initMemory(dir);
const V = 'Testvale';
const T = 1_000_000;

// Observations
soc.observe(V, [
  { name: 'Ada', x: 0, z: 0, chore: { id: 'c1', kind: 'penwork' } },
  { name: 'Ben', x: 10, z: 0 },
  { name: 'Clara', x: 40, z: 0, chore: { id: 'c2', kind: 'farm' } },
], T);
ok(soc.profile(V, 'Ben', 'Ada')?.seen?.penwork === 1, 'Ben sees Ada tending pens');
ok(soc.profile(V, 'Ben', 'Ada')?.lastMet === T, 'Ben meets Ada within 16 blocks');
ok(soc.profile(V, 'Ada', 'Clara') === undefined, 'Ada does not see Clara at 40 blocks');
ok(soc.profile(V, 'Ben', 'Clara')?.seen?.farm === 1 && soc.profile(V, 'Ben', 'Clara')?.lastMet === 0, 'Ben sees Clara at 30 blocks, not met');
soc.observe(V, [{ name: 'Ada', x: 0, z: 0, chore: { id: 'c1', kind: 'penwork' } }, { name: 'Ben', x: 10, z: 0 }], T + 30000);
ok(soc.profile(V, 'Ben', 'Ada')?.seen?.penwork === 1, 'the same chore is seen once');
soc.observe(V, [{ name: 'Ada', x: 0, z: 0, chore: { id: 'c3', kind: 'slot' } }, { name: 'Ben', x: 10, z: 0 }], T + 60000);
soc.observe(V, [{ name: 'Ada', x: 0, z: 0, chore: { id: 'c4', kind: 'farm' } }, { name: 'Ben', x: 10, z: 0 }], T + 90000);
ok(JSON.stringify(soc.profile(V, 'Ben', 'Ada')?.kinds) === JSON.stringify(['harvesting', 'tending pens']), `fields and slots are one kind, top first (${soc.profile(V, 'Ben', 'Ada')?.kinds})`);

// Help and promises
soc.noteHelp(V, 'Ben', 'Ada', T + 100000, 'i1');
ok(soc.profile(V, 'Ben', 'Ada')?.helped === 1 && soc.profile(V, 'Ada', 'Ben')?.helpedBy === 1, 'help given and received');
soc.noteKept(V, 'Ada', 'Ben', true);
soc.noteKept(V, 'Ada', 'Ben', false);
ok(soc.profile(V, 'Ada', 'Ben')?.kept === 1 && soc.profile(V, 'Ada', 'Ben')?.broke === 1 && soc.profile(V, 'Ada', 'Ben')?.helpedBy === 2, 'kept and broken promises');
soc.noteHeard(V, 'Clara', 'Ben', false);
ok(soc.profile(V, 'Clara', 'Ben')?.heardBroke === 1, 'a verified report heard');
const line = soc.profileLine(soc.profile(V, 'Ada', 'Ben')!, T + 160000);
ok(/^- Ben: /.test(line) && /helped you twice/.test(line) && /kept 1 promise to you/.test(line) && /broke 1 promise to you/.test(line), `the profile line: ${line}`);
ok(!/\b(he|she|him|her|his|hers)\b/i.test(line), 'no gendered pronouns');

// The block
const scene = { kinds: new Map([['farm', ['Ada', 'Clara']], ['penwork', ['Dev']]]), choosing: 1, idle: 3, menuKinds: ['farm', 'iron', 'explore', 'eat'], near: ['Ben'] };
const b = soc.awareness(V, 'Ada', T + 160000, scene);
ok(/^What the others are doing: harvesting 2, tending pens 1, choosing 1, idle 3\./.test(b.text), `counts line: ${b.text.split('\n')[0]}`);
ok(/Nobody is: digging for iron, exploring\./.test(b.text), 'nobody line');
ok(b.profiles[0] === 'Ben' && b.text.includes('- Ben:'), 'the near member\'s profile shown');
ok(b.text.endsWith(soc.RIEDL), 'Riedl\'s sentence last');
soc.setSocialSettings({ mode: 'countsonly' });
const c = soc.awareness(V, 'Ada', T + 160000, scene);
ok(!c.text.includes('- Ben:') && c.text.endsWith(soc.RIEDL), 'countsonly: no profiles');
for (const m of ['legacy', 'noblock', 'off'] as const) {
  soc.setSocialSettings({ mode: m });
  ok(soc.awareness(V, 'Ada', T, scene).text === '', `${m}: no block`);
}
soc.setSocialSettings({ mode: 'on' });

// The cap at 25 members: each has helped Ada and is near, with a long note
const names = ['Mayor', ...NAME_POOL.slice(0, 24)];
for (const n of names) if (n !== 'Ada') {
  soc.noteHelp(V, n, 'Ada', T, 'i2');
  const p = soc.profile(V, 'Ada', n)!;
  p.note = 'a long note of twelve words written at night about this member here';
  p.feel = 1;
  p.seen = { farm: 3, penwork: 2 };
  p.kinds = ['harvesting', 'tending pens'];
}
const big = soc.awareness(V, 'Ada', T + 200000, { ...scene, near: names.filter((n) => n !== 'Ada'), kinds: new Map(names.filter((n) => n !== 'Ada').map((n, i) => [['farm', 'penwork', 'make', 'gather', 'light', 'iron'][i % 6], [n]])) });
ok(big.text.length <= soc.BLOCK_CHARS, `the block is capped (${big.text.length} chars)`);
ok(big.profiles.length >= 1 && big.profiles.length <= soc.PROFILES_SHOWN, `profiles shown ${big.profiles.length}`);
ok(big.text.endsWith(soc.RIEDL), 'the sentence survives the cap');

// Roles
for (const k of ['farm', 'slot', 'make']) soc.noteChoice(V, 'Dev', k, T);
ok(soc.roleOf(V, 'Dev')?.kind === 'farm', 'role: harvests on fields and slots make one');
for (const k of ['make', 'make', 'make']) soc.noteChoice(V, 'Dev', k, T + 60000);
ok(soc.roleOf(V, 'Dev')?.kind === 'make' && soc.roleOf(V, 'Dev')?.since === T + 60000, 'role changes with the modal kind');
soc.noteChoice(V, 'Dev', 'eat', T + 70000);
ok(soc.memberSocial(V, 'Dev').recent?.length === 5 && !soc.memberSocial(V, 'Dev').recent?.includes('eat'), 'eating left out');
ok(soc.roleLine(V, 'Dev') === '', 'role hidden by default');
soc.setSocialSettings({ roles: true });
ok(soc.roleLine(V, 'Dev') === "You have become the village's maker.", `role shown: ${soc.roleLine(V, 'Dev')}`);
soc.setSocialSettings({ roles: false });
const acts = fs.readFileSync(process.env.MCAI_ACTS_LOG!, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
ok(acts.filter((a) => a.type === 'role' && a.agent === 'Dev').length === 2, 'role changes logged');

// The village line under off
ok(mem.villageLineShown(), 'the village line shown under on');
soc.setSocialSettings({ mode: 'off' });
ok(!mem.villageLineShown(), 'the village line hidden under off');
soc.setSocialSettings({ mode: 'on' });

// Skill from practice (#17)
const sk = await import('../../server/src/skill');
ok(sk.skillLine(V, 'Eve') === '' && sk.skillOf(V, 'Eve', 'farm') === 0, 'skill off: nothing');
sk.setSkillSettings({ on: true });
for (let i = 0; i < 5; i++) sk.noteSkill(V, 'Eve', i % 2 ? 'slot' : 'farm', 1);
const s5 = sk.skillOf(V, 'Eve', 'farm');
ok(Math.abs(s5 - (1 - 0.85 ** 5)) < 0.01, `five harvests: skill ${s5}`);
sk.noteSkill(V, 'Eve', 'make', 1.5);
ok(sk.skillOf(V, 'Eve', 'make') === 0.225 && sk.skillOf(V, 'Eve', 'farm') < s5, 'a passion of 1.5 gains more; the rest fades');
sk.noteSkill(V, 'Eve', 'eat', 1);
ok(sk.skillOf(V, 'Eve', 'eat') === 0, 'eating is no skill');
ok(sk.skillWeight(0) === 0.8 && sk.skillWeight(1) === 1.4, 'the weight 0.8..1.4');
ok(sk.skillLine(V, 'Eve') === 'Your skill: harvesting some.', `the line: ${sk.skillLine(V, 'Eve')}`);
for (let i = 0; i < 6; i++) sk.noteSkill(V, 'Eve', 'farm', 1);
ok(sk.skillLine(V, 'Eve') === 'Your skill: harvesting high.', `high: ${sk.skillLine(V, 'Eve')}`);
sk.setSkillSettings({ on: false });

console.log(`social_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

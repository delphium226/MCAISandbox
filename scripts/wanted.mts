/**
 * G6: the wanted list from a saved villages.json (wanted.ts, as GET /api/wanted serves it), for foundry_queue.py's offline
 * path and for reading a past run. Usage:
 *   node node_modules/tsx/dist/cli.mjs scripts/wanted.mts VILLAGES.json [VILLAGE] [--json] [--top N]
 * Without VILLAGE: every complete village. --json prints the API's shape ([{village, at, list}]).
 */
import fs from 'node:fs';
import minecraftData from 'minecraft-data';

const args = process.argv.slice(2);
const json = args.includes('--json');
const topAt = args.indexOf('--top');
const top = topAt >= 0 ? Number(args[topAt + 1]) || 10 : 12;
const pos = args.filter((a, i) => !a.startsWith('--') && (topAt < 0 || i !== topAt + 1));
if (!pos[0]) {
  console.error('usage: wanted.mts VILLAGES.json [VILLAGE] [--json] [--top N]');
  process.exit(2);
}
// (quiet: the skill modules log nothing at import, but keep stdout clean for --json)
const { Materials } = await import('../server/src/mineflayer/mcMaterials');
const { MC_SKILLS } = await import('../server/src/mineflayer/mcSkills');
const { FOUNDRY_SKILLS } = await import('../server/src/mineflayer/foundry/list');
const { loadLibrary } = await import('../server/src/library');
const { wantedList } = await import('../server/src/wanted');

const reg = minecraftData('26.1');
const m = new Materials(reg);
const lib = loadLibrary(reg, new Set(FOUNDRY_SKILLS.filter((f) => f.activity).map((f) => f.name)));
const data = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
const villages = (Array.isArray(data) ? data : data.villages) as Array<{ name: string; complete?: boolean }>;
const pick = villages.filter((v) => (pos[1] ? v.name === pos[1] : v.complete));
if (!pick.length) {
  console.error(`no ${pos[1] ? `village ${pos[1]}` : 'complete village'} in ${pos[0]}`);
  process.exit(1);
}
const ctx = {
  items: reg.itemsArray.map((it) => it.name), plan: (b: Record<string, number>) => m.plan(b), skills: new Set(Object.keys(MC_SKILLS)),
  activitySkills: new Set(lib.specs.map((s) => s.skill)), now: Date.now(),
};
const out = pick.map((v) => ({ village: v.name, at: ctx.now, list: wantedList(v as never, ctx) }));
if (json) {
  console.log(JSON.stringify(out));
} else {
  for (const o of out) {
    console.log(`== ${o.village}: the wanted list (rank = log2(1 + value) + demand)`);
    for (const w of o.list.slice(0, top)) {
      console.log(`  ${w.rank.toFixed(2).padStart(6)}  ${w.id.padEnd(13)} ${w.status.padEnd(9)} ${w.ticketable ? 'ticketable' : '          '}  value ${w.value}, demand ${w.demand} (${Math.round(w.demandShare * 100)}% of the rank)${w.reason ? `; ${w.reason}` : ''}`);
      for (const y of w.why) console.log(`          - ${y}`);
    }
  }
}

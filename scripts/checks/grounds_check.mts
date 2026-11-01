/**
 * Survival stage (d)'s lit ground (MC_GROUNDS_LIGHT, spec runs/2026-10-31/survival/spec_d.md 1), offline on stored villages
 * (the pair's checkpoint t12_pad_open and the golden inputs): with monsters each neighbourhood (fields left out) gives one
 * `grounds:N` light part of standing torch spots inside its area, on no street, pad, green, farm, slot or side plot, a block
 * clear of every structure, 7 clear of its lamps and of each other; none in peaceful or with the flag off (a child process
 * each, the settings are read at import), so peaceful's light parts are the same as before; the watch loop from them.
 * The spec named light_check.mts for this; it sets its own settings at import, so the grounds have their own check.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/grounds_check.mts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const FILES = ['mc/testcheckpoints/t12_pad_open/villages.json', 'runs/2026-10-12/golden_inputs/villages_main.json', 'runs/2026-10-12/golden_inputs/villages_test.json'].filter((f) => fs.existsSync(f));

if (process.env.MODE_CHILD) {
  const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
  const out: Any[] = [];
  const log = console.log, err = console.error;
  for (const f of FILES) {
    const all: Any[] = JSON.parse(fs.readFileSync(f, 'utf8')).villages.filter((v: Any) => v.complete && v.layouts?.length).slice(0, 12);
    for (const v of all) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounds-'));
      fs.writeFileSync(path.join(dir, 'villages.json'), JSON.stringify({ villages: [v] }));
      console.log = () => {};
      console.error = () => {};
      const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
      console.log = log;
      console.error = err;
      const vv = w.villages.get(v.name);
      const parts = w.lightParts(vv);
      out.push({ src: path.basename(path.dirname(f)) + '/' + v.name, parts: parts.map((p: Any) => ({ part: p.part, kind: p.kind, spots: p.spots, unlit: p.unlit })), loop: w.watchSpots(vv) });
    }
  }
  console.log(JSON.stringify(out));
} else {
  let fails = 0;
  const ok = (cond: unknown, what: string) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
    if (!cond) fails++;
  };
  const child = (mode: string, extra: Record<string, string> = {}): Any[] => JSON.parse(execFileSync(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/checks/grounds_check.mts'], {
    env: { ...process.env, MODE_CHILD: '1', MC_WORLD_MODE: mode, MC_CHOOSE: 'fixed', ...extra }, encoding: 'utf-8', maxBuffer: 1 << 28,
  }).trim().split('\n').pop()!);
  ok(FILES.length > 0, `stored villages (${FILES.join(', ')})`);
  const host = child('hostile'), peace = child('peaceful'), off = child('hostile', { MC_GROUNDS_LIGHT: 'off' });
  const strip = (r: Any[]) => JSON.stringify(r.map((x) => x.parts.filter((p: Any) => p.kind !== 'grounds')));
  ok(peace.every((x) => !x.parts.some((p: Any) => p.kind === 'grounds')) && off.every((x) => !x.parts.some((p: Any) => p.kind === 'grounds')), 'no grounds in peaceful or with the flag off');
  ok(strip(host) === strip(peace) && JSON.stringify(peace.map((x) => x.parts)) === JSON.stringify(off.map((x) => x.parts)), 'the other parts the same in every mode');
  const villages = new Map<string, Any>();
  for (const f of FILES) for (const v of JSON.parse(fs.readFileSync(f, 'utf8')).villages) villages.set(path.basename(path.dirname(f)) + '/' + v.name, v);
  let total = 0, villagesWith = 0, bad = 0;
  const inside = (q: Any, x: number, z: number, m = 0) => x >= q.x1 - m && x <= q.x2 + m && z >= q.z1 - m && z <= q.z2 + m;
  for (const r of host) {
    const v = villages.get(r.src);
    const gs = r.parts.filter((p: Any) => p.kind === 'grounds');
    if (gs.length) villagesWith++;
    const lamps = (v.layouts ?? []).flatMap((l: Any) => l.lamps ?? []);
    const sides = [v.storageHut, ...(v.layouts ?? []).flatMap((l: Any) => [l.annex, l.works, l.store, l.farm, ...(l.slots ?? [])])].filter(Boolean);
    for (const g of gs) {
      const l = v.layouts[Number(g.part.split(':')[1])];
      ok(!l.field, `${r.src} ${g.part}: a neighbourhood, not a field`);
      const off2 = [...(l.streets ?? []), ...(l.pads ?? []), ...(l.green ? [l.green] : []), ...sides];
      for (const s of g.spots) {
        total++;
        const why = !inside(l, s.x, s.z) ? 'outside its area' : v.structures.some((st: Any) => inside(st, s.x, s.z, 1)) ? 'by a structure' : off2.some((q: Any) => inside(q, s.x, s.z)) ? 'on a street, pad or plot'
          : lamps.some((q: Any) => (q.x - s.x) ** 2 + (q.z - s.z) ** 2 < 49) ? 'by a lamp' : g.spots.some((o: Any) => o !== s && (o.x - s.x) ** 2 + (o.z - s.z) ** 2 < 49) ? 'by another spot' : s.block !== 'torch' ? 'not standing' : '';
        if (why) {
          bad++;
          if (bad <= 10) console.log(`  ${r.src} ${g.part} ${s.x},${s.y},${s.z}: ${why}`);
        }
      }
    }
    if (gs.length) ok(r.loop.length > 0 && r.loop.length <= 16, `${r.src}: a watch loop of ${r.loop.length} spots`);
    console.log(`  ${r.src}: ${gs.length} grounds parts, ${gs.reduce((n: number, g: Any) => n + g.spots.length, 0)} spots (${gs.map((g: Any) => `${g.part} ${g.spots.length}`).join(', ')})`);
  }
  ok(bad === 0, `every grounds spot off streets, pads, plots, structures and lamps (${total} spots, ${bad} bad)`);
  ok(villagesWith > 0 && total > 0, `grounds in ${villagesWith} of ${host.length} villages`);
  const pair = host.find((x) => x.src.startsWith('t12_pad_open/'));
  if (pair) console.log(`  t12_pad_open: ${pair.parts.filter((p: Any) => p.kind === 'grounds').reduce((n: number, g: Any) => n + g.spots.length, 0)} grounds spots`);
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
}

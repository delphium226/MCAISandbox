/**
 * #75's refits checked offline (MC_WORKS_GROW; runs/2026-10-21/works-grow/design.md; no server, seconds with the jar):
 * - every vanilla piece of the five biomes at tiers 2 and 3 (refit.ts refitDesign): the grid's size kept; only changed
 *   cells drawn (each one the original's block turned by the tier's rule, states kept), every other cell "_"; never a
 *   door, bed, sign, chest, torch, glass or "." cell; tier 3's stairs and slabs only in the upper half; every block a real
 *   block of the game and every refit design plannable (no material "problems": all from logs and cobblestone);
 * - the village of mv3_grown25 (and any villages.json given): refitPlaces finds every building with a Build task, each
 *   at its record's own footprint at its turn (build_design's area from the task's x, z and rotate); refitOptions offers
 *   each layout's tier 2, then tier 3 once tier 2 stands, then nothing; a building tier 2 leaves alone does not hold back
 *   its layout's tier 3;
 * - postRefit on a stand-in world: per building its gathering then one Build task, the refit design stored, the build's
 *   detail at the building's own place and footprint, all posted by "grow".
 * Exits non-zero on any failure.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/works_grow.mts [villages.json ...]
 */
import fs from 'node:fs';
import minecraftData from 'minecraft-data';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const R = await import('../../server/src/refit');
const VP = await import('../../server/src/vanillaPieces');
const { hasJar, vanillaJar } = await import('../../server/src/vanillaData');
const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
const { postRefit } = await import('../../server/src/layout');
type Design = import('../../server/src/village').Design;

let failures = 0, checks = 0;
const say = (s: string) => console.log(s);
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 60) say(`FAIL ${what}`);
  }
};
const base = (b: string) => b.replace(/^minecraft:/, '').replace(/\[.*$/, '');
const states = (b: string) => (b.includes('[') ? b.slice(b.indexOf('[')) : '');
const reg = minecraftData('26.1') as Any;
const materials = new Materials(reg);
const NEVER = /door|bed|sign|chest|torch|lantern|glass|barrel|furnace|table|bell|lectern|composter|cauldron|anvil|grindstone|smoker|loom|stonecutter|fletching|brewing|smithing/;

// ---- 1. every vanilla piece, both tiers ------------------------------------------------------------------------------------
if (!hasJar()) {
  say('SKIP the vanilla pieces: no Minecraft jar here');
} else {
  const jar = vanillaJar();
  let pieces = 0, refits = 0, cells = 0;
  for (const biome of ['plains', 'desert', 'savanna', 'snowy', 'taiga'])
    for (const path of VP.listPieces(jar, biome, 'houses')) {
      let d: Design;
      try {
        d = VP.pieceToDesign(VP.readPiece(path, jar), biome).design;
      } catch {
        continue;
      }
      pieces++;
      const half = Math.ceil(d.height / 2);
      for (const tier of R.REFIT_TIERS) {
        const r = R.refitDesign(d, tier);
        if (!r) continue;
        refits++;
        const what = `${d.name} tier ${tier}`;
        ok(r.name === R.refitName(d.name, tier) && R.parseRefit(r.name)?.base === d.name && R.parseRefit(r.name)?.tier === tier, `${what}: its name ${r.name}`);
        ok(r.width === d.width && r.depth === d.depth && r.height === d.height && r.layers.length === d.layers.length, `${what}: the grid's size`);
        let n = 0;
        r.layers.forEach((layer, li) => layer.forEach((row, j) => {
          ok(row.length === d.layers[li][j].length, `${what}: row ${li}/${j} length`);
          for (let i = 0; i < row.length; i++) {
            const ch = row[i];
            if (ch === '_') continue;
            n++;
            const was = d.palette[d.layers[li][j][i]];
            ok(ch === d.layers[li][j][i] && was !== undefined, `${what}: cell ${i},${li},${j} is the original's cell`);
            const to = r.palette[ch];
            ok(to === R.refitBlock(was, tier, li >= half), `${what}: cell ${i},${li},${j} ${was} -> ${to} by the tier's rule`);
            ok(states(to) === states(was), `${what}: ${was} -> ${to} keeps its states`);
            ok(!NEVER.test(base(was)), `${what}: ${was} is never refitted`);
            ok(!!reg.blocksByName[base(to)], `${what}: ${base(to)} is a block of the game`);
            if (tier === 3 && /_(stairs|slab)$/.test(base(to))) ok(li >= half, `${what}: roof ${to} at layer ${li} is in the upper half`);
          }
        }));
        ok(n === r.blocks && n > 0, `${what}: blocks ${r.blocks} counted ${n}`);
        cells += n;
        // (planned from what the game makes: cobblestone, logs and fuel; stripped logs and wood are charged as logs at the
        // build, materialTasks' chargedItem, so the bill is planned as the world plans it)
        const bill: Record<string, number> = {};
        for (const layer of r.layers) for (const row of layer) for (const ch of row) if (ch !== '_') {
          const b = base(r.palette[ch]);
          const item = /_wood$/.test(b) ? b.replace(/^stripped_/, '').replace(/_wood$/, '_log') : b;
          bill[item] = (bill[item] ?? 0) + 1;
        }
        const plan = materials.plan(bill);
        ok(!(plan as Any).problems?.length, `${what}: planned without problems (${((plan as Any).problems ?? []).join('; ')})`);
        ok(Object.keys(plan.gather).every((k) => /^(cobblestone|any:logs|\w+_log)$/.test(k)), `${what}: gathers only cobblestone and logs (${Object.keys(plan.gather).join(', ')})`);
      }
    }
  say(`vanilla pieces: ${pieces} read, ${refits} refits at tiers 2-3, ${cells} cells changed`);
  ok(pieces > 100 && refits > 60, `enough pieces and refits (${pieces}, ${refits})`);
}

// ---- 2. a village's places and options --------------------------------------------------------------------------------------
const files = process.argv.slice(2);
if (!files.length) files.push('mc/testcheckpoints/mv3_grown25/villages.json');
for (const f of files) {
  if (!fs.existsSync(f)) {
    say(`SKIP ${f}: not here`);
    continue;
  }
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const v of (Array.isArray(raw.villages) ? raw.villages : Object.values(raw.villages)) as Any[]) {
    if (!v.layouts?.length || !v.structures?.length) continue;
    const places = R.refitPlaces(v);
    const withTask = v.structures.filter((st: Any) => v.designs[st.kind] && !/_hut$/.test(st.kind) && v.tasks.some((t: Any) => t.status === 'done' && /^Build /.test(t.title) && String(t.detail).startsWith(`build_design "${st.kind}"`)));
    say(`${f} ${v.name}: ${v.structures.length} structures, ${places.length} refittable (${withTask.length} of a design with a done Build task)`);
    ok(places.length > 0, `${v.name}: some building can be refitted`);
    ok(new Set(places.map((p) => p.st.id)).size === places.length, `${v.name}: one place a building`);
    for (const p of places) {
      const W = p.rot % 2 ? p.design.depth : p.design.width, D = p.rot % 2 ? p.design.width : p.design.depth;
      const x1 = p.x - Math.floor(W / 2), z1 = p.z - Math.floor(D / 2);
      ok(x1 === p.st.x1 && z1 === p.st.z1 && x1 + W - 1 === p.st.x2 && z1 + D - 1 === p.st.z2, `${v.name}: ${p.label} built at its record's footprint (${x1},${z1} ${W}x${D} vs ${p.st.x1}..${p.st.x2}, ${p.st.z1}..${p.st.z2})`);
      ok(!/_hut$/.test(p.st.kind), `${v.name}: ${p.st.kind} is no hut`);
    }
    // The ladder: tier 2 everywhere, then tier 3, then nothing (on a copy)
    const c = structuredClone(v);
    const o1 = R.refitOptions(c);
    const inLayout = (o: { layout: number }) => R.refitPlaces(c).filter((p) => { const l = c.layouts[o.layout - 1]; return p.st.x1 >= l.x1 && p.st.x2 <= l.x2 && p.st.z1 >= l.z1 && p.st.z2 <= l.z2; });
    ok(o1.length > 0, `${v.name}: some first option`);
    for (const o of o1) ok(o.tier === 2 || !inLayout(o).some((p) => R.refitDesign(p.design, 2)), `${v.name}: layout ${o.layout} offered tier ${o.tier} first only when tier 2 changes none of it`);
    ok(new Set(o1.map((o) => o.layout)).size === o1.length, `${v.name}: one option a layout`);
    const raise = (os: Array<{ tier: number; places: Array<{ st: Any }> }>) => {
      for (const o of os) for (const p of o.places) p.st.tier = o.tier;
    };
    const tiers1 = o1.map((o) => o.tier).join('');
    raise(o1);
    const o2 = R.refitOptions(c);
    ok(o2.every((o) => o.tier === 3), `${v.name}: after the first refits only tier 3 is left (${o2.map((o) => o.tier).join('')})`);
    raise(o2);
    const o3 = R.refitOptions(c);
    ok(!o3.length, `${v.name}: nothing after tier 3 (${o3.length} left)`);
    say(`  options: ${o1.length} (tiers ${tiers1}), then ${o2.length} at tier 3, then ${o3.length}; buildings ${o1.reduce((s, o) => s + o.places.length, 0)} then ${o2.reduce((s, o) => s + o.places.length, 0)}`);

    // ---- 3. postRefit on a stand-in world ----------------------------------------------------------------------------------
    const d = structuredClone(v);
    const opt = R.refitOptions(d)[0];
    const posted: Any[] = [];
    let n = 0;
    const w: Any = {
      materialTasks: (des: Design, label: string) => ({ tasks: [{ title: `Gather cobblestone for ${label}`, detail: 'collect block=cobblestone count=8, then deposit item=all into the village storage' }], problems: [], units: des.blocks }),
      villages: {
        post: (_v: Any, tasks: Any[], by: string) => tasks.map((t) => {
          const task = { ...t, id: `t${++n}`, postedBy: by, after: (t.after ?? []).map((i: number) => `t${i + 1}`), status: 'open' };
          posted.push(task);
          return task;
        }),
        note: () => {},
        save: () => {},
      },
    };
    const out = postRefit(w, d, opt);
    ok(typeof out !== 'string', `${v.name}: postRefit posted (${typeof out === 'string' ? out : ''})`);
    if (typeof out !== 'string') {
      ok(out.builds.length === opt.places.length, `${v.name}: a build a building (${out.builds.length} of ${opt.places.length})`);
      ok(posted.every((t) => t.postedBy === 'grow'), `${v.name}: posted by grow`);
      for (const p of opt.places) {
        const name = R.refitName(p.design.name, opt.tier);
        ok(!!d.designs[name], `${v.name}: ${name} stored`);
        const b = posted.find((t) => /^Build /.test(t.title) && t.title.startsWith(`Build ${p.label} (tier`));
        const m = b && /build_design "([^"]+)" x=(-?\d+) z=(-?\d+)(?: rotate=(\d+))?/.exec(b.detail);
        ok(m && m[1] === name && Number(m[2]) === p.x && Number(m[3]) === p.z && Number(m[4] ?? 0) === p.rot * 90, `${v.name}: ${p.label}'s build at its own place (${b?.detail?.slice(0, 80)})`);
        ok(b && b.after.length >= 1 && b.after.every((id: string) => posted.find((t) => t.id === id && /^Gather /.test(t.title))), `${v.name}: ${p.label}'s build waits for its gathering`);
        ok(R.isRefitBuild(b), `${v.name}: isRefitBuild`);
      }
    }
  }
}

say(`${failures ? 'FAIL' : 'PASS'} works_grow: ${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);

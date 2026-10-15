/**
 * B.4's torch placers checked offline (runs/2026-10-15/spec_b4.md 7.3; no server, ~a minute with the jar):
 * 1. buildingLights (streetPlan.ts) on every vanilla house and meeting point of the five biomes as the jar imports it, and
 *    on the two huts, at four turns: every spot inside the real grid on layer 1 or above, its own cell free, a wall torch's
 *    support (its cell less its facing) holding one by the live facts' rule (runs/2026-10-15/b4_facts.log, judged here on
 *    its own: a full cube, a double slab, stairs whose facing is the torch's; never leaves, panes, fences, walls, top or
 *    bottom slabs, a stair's side or front) and by holdsTorch, a standing torch on a full block, a fence or wall post or a
 *    top or double slab; code's spots inside at layer 2, off doors and the grid's ring; none on the building's sign or a
 *    lamp's column, none twice; vanillaLights(design) the import's own lights; the spots at each turn the first turn's
 *    turned (vanilla's exactly, code's by count; their tie order is printed); per-biome totals;
 * 2. the stored villages (runs/2026-10-12/golden_inputs/villages_*.json and S9f's record): each built building's spots
 *    (structures with a design and a done Build task) inside its structure, off its layout's signs and lamps; S9f gives 23;
 *    and doorStand's candidates (mcBuild.ts after the lead's ruling, standability assumed, as A's replica
 *    runs/2026-10-15/b4_scratch/a_doorstand.mts): 3 out of the door 2 and 1 to either side, 4 out 2 to either side (none
 *    straight out since the fix review's M2); never a door's cell or the cell in front of any building's door, another
 *    building's walkway 2 and 3 out, the building's own area and a block round it, a structure, a task's footprint, a sign,
 *    a lamp, the farm, a slot, the works plot or a mine box reaching the building's floor; within 12 of the building's
 *    centre or door. How many find one; the rest fall back (the doorless town centres by design);
 * 3. mineLights (mcMine.ts) on every recorded mine: each spot a dug cell at head height (a tunnel's, a step's), no cell
 *    twice, no support on a dug cell, the cells a tunnel may still dig (its next two stretches and every open branch), a
 *    turned tunnel's cells (turnFrom, the first tunnel's turn at the stairs' bottom too), a stair, a stair down's or the iron
 *    stairs' cells or where ironStart would put them; S9f gives 38; then each mine's last tunnel grown by 24, 48 and 96 cells,
 *    the spots added printed and the same rules checked;
 * 4. no stored design holds a wall torch, and a wall torch is billed as itself (no item: a design holding one is refused,
 *    as before B.4);
 * 5. the world (MineflayerWorld on S9f's record, fake agents): torchDemand the parts' unlit less lightCarried; makeTarget
 *    the S.9 target with the family off and max(32, min(64, demand) + 8) with it on; with torches short make:torch is
 *    offered for the demand above 32, and once every spot is done the demand is 0, make:torch stops at 32 and gathering's
 *    logs are no longer wanted for torches; light options within LIGHT_MIN_TRIP..LIGHT_TRIP.
 * Exits non-zero on any failure.
 * Usage: node_modules/.bin/tsx scripts/checks/light_check.mts   (VERBOSE=1: every building's and mine's spots)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERBOSE = !!process.env.VERBOSE;
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'light-check-'));
// (read when the world's modules load: set first; the families on, fixed choosing, single keys as in a run)
process.env.MC_CHOOSE = 'fixed';
process.env.MC_CHOICE_FAMILIES = 'make,gather,works,light';
process.env.MC_CHOICE_INSTANCES = 'explore,start';
process.env.MC_TIME_SCALE = '1';
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
const NOW = Date.parse('2026-10-15T12:00:00Z');
const MIN = 60000;
let clock = NOW;
Date.now = () => clock;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const SP = await import('../../server/src/streetPlan');
const VP = await import('../../server/src/vanillaPieces');
const { hasJar } = await import('../../server/src/vanillaData');
const { storageHutDesign, miningHutDesign, MINING_HUT } = await import('../../server/src/huts');
const MM = await import('../../server/src/mineflayer/mcMine');
const { fromOrder, upgradeMine, MINE_STEP, MINE_BRANCH } = await import('../../server/src/village');
const { designBill } = await import('../../server/src/mineflayer/mcMaterials');
const W9 = await import('../../server/src/mineflayer/mcWorkshop');
const { CHOOSE } = await import('../../server/src/choose');
type Design = import('../../server/src/village').Design;
type Mine = import('../../server/src/village').Mine;
type MineLeg = import('../../server/src/village').MineLeg;

let failures = 0, checks = 0;
const quiet = { log: console.log, warn: console.warn, info: console.info };
const say = (s: string) => quiet.log(s);
const fails: string[] = [];
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (fails.length < 60) say(`FAIL ${what}`);
    fails.push(what);
  }
};
const mute = () => { console.log = () => {}; console.warn = () => {}; console.info = () => {}; };
const unmute = () => Object.assign(console, quiet);

// ---- the live facts' support rule, judged here on its own --------------------------------------------------------------
const base = (b: string | undefined) => String(b ?? '').replace(/^minecraft:/, '').replace(/[[{].*$/, '');
const stateOf = (b: string | undefined, k: string) => new RegExp(`[[,]${k}=([a-z_]+)`).exec(String(b ?? ''))?.[1];
/** Full collision cubes the designs use (planks, logs and wood on any axis, stone kinds, bricks, sandstone, terracotta, wool,
 *  concrete, glass, ores, dirt kinds and the like); anything not named is reported, never taken as a support. */
const FULL = /(_planks|_log|_wood|_hyphae|_stem_block|_bricks|_terracotta|_wool|_concrete|_ore|_block|_glass)$|^stripped_|^(stone|cobblestone|mossy_cobblestone|smooth_stone|stone_bricks|bricks|mud_bricks|packed_mud|bookshelf|chiseled_bookshelf|sandstone|cut_sandstone|chiseled_sandstone|smooth_sandstone|red_sandstone|cut_red_sandstone|chiseled_red_sandstone|smooth_red_sandstone|deepslate|cobbled_deepslate|polished_deepslate|tuff|calcite|andesite|diorite|granite|polished_andesite|polished_diorite|polished_granite|terracotta|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|glass|gravel|sand|red_sand|clay|snow_block|packed_ice|ice|blue_ice|crafting_table|furnace|blast_furnace|smoker|barrel|loom|cartography_table|fletching_table|smithing_table|jukebox|note_block|pumpkin|carved_pumpkin|jack_o_lantern|melon|hay_block|dried_kelp_block|smooth_quartz|quartz_block|quartz_pillar|chiseled_quartz_block|quartz_bricks|purpur_block|purpur_pillar|prismarine|dark_prismarine|sea_lantern|glowstone|obsidian|netherrack|basalt|polished_basalt|blackstone|moss_block|mud|muddy_mangrove_roots|chiseled_stone_bricks|cracked_stone_bricks|mossy_stone_bricks|end_stone)$/;
const NEVER = /_leaves$|_pane$|^iron_bars$|_fence$|_fence_gate$|_wall$|_door$|_trapdoor$|^(air|cave_air|void_air|water|lava)$/;
const unjudged = new Map<string, number>();
/** A wall torch facing `facing` holds on this block (its side toward the torch is sturdy). */
function factsWall(block: string | undefined, facing: string): boolean {
  const n = base(block);
  if (!n || n === '_' || n === '.') return false;
  if (/_slab$/.test(n)) return stateOf(block, 'type') === 'double';
  if (/_stairs$/.test(n)) return stateOf(block, 'facing') === facing;
  if (NEVER.test(n)) return false;
  if (FULL.test(n)) return true;
  unjudged.set(n, (unjudged.get(n) ?? 0) + 1);
  return false;
}
/** A standing torch holds on this block's top (canSupportCenter): a full cube, a fence or wall post, a top or double slab,
 *  top-half stairs; never a bottom slab, bottom-half stairs or leaves. */
function factsStand(block: string | undefined): boolean {
  const n = base(block);
  if (!n || n === '_' || n === '.') return false;
  if (/_slab$/.test(n)) return stateOf(block, 'type') !== 'bottom';
  if (/_stairs$/.test(n)) return stateOf(block, 'half') === 'top';
  if (/_fence$|_wall$/.test(n)) return true;
  if (NEVER.test(n)) return false;
  if (FULL.test(n)) return true;
  unjudged.set(n, (unjudged.get(n) ?? 0) + 1);
  return false;
}

// ---- a placed building's grid, on its own (build_design's turn, block states turned with it) --------------------------
const CW: Record<string, string> = { north: 'east', east: 'south', south: 'west', west: 'north' };
const STEP: Record<string, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const turnF = (f: string | undefined, rot: number) => { let g = f; for (let r = 0; g && r < rot; r++) g = CW[g]; return g; };
const turnCell = (i: number, j: number, w: number, d: number, rot: number): [number, number] => {
  let [u, q, ww, dd] = [i, j, w, d];
  for (let r = 0; r < rot; r++) [u, q, ww, dd] = [dd - 1 - q, u, dd, ww];
  return [u, q];
};
interface Place { design: Design; x: number; z: number; rot: number; noSign?: boolean }
function grid(p: Place) {
  const d = p.design, rot = ((p.rot % 4) + 4) % 4;
  const W = rot % 2 ? d.depth : d.width, D = rot % 2 ? d.width : d.depth;
  const x1 = p.x - Math.floor(W / 2), z1 = p.z - Math.floor(D / 2);
  const cells = new Map<string, string>();
  d.layers.forEach((layer, l) => layer.forEach((row, j) => [...row].forEach((ch, i) => {
    const [u, q] = turnCell(i, j, d.width, d.depth, rot);
    let b = ch === '_' || ch === '.' ? ch : d.palette[ch] ?? 'air';
    const f = stateOf(b, 'facing');
    if (f && STEP[f]) b = b.replace(`facing=${f}`, `facing=${turnF(f, rot)}`);
    cells.set(`${x1 + u},${l},${z1 + q}`, b);
  })));
  return { x1, z1, x2: x1 + W - 1, z2: z1 + D - 1, cells, rot };
}
const isDoor = (b: string | undefined) => /_door$/.test(base(b));

/** One building's spots against the rules (item 1's list); returns how many of each kind. */
function judge(label: string, p: Place, spots: Array<import('../../server/src/streetPlan').LightSpot>, opts: { signs?: Array<{ x: number; z: number; layer: number }>; lamps?: Array<{ x: number; z: number }> } = {}) {
  const g = grid(p), d = p.design;
  const at = (x: number, l: number, z: number) => g.cells.get(`${x},${l},${z}`);
  const seen = new Set<string>();
  for (const s of spots) {
    const where = `${label} rot ${g.rot}: ${s.src} ${s.block}${s.facing ? `[${s.facing}]` : ''} at ${s.x},L${s.layer},${s.z}`;
    ok(s.x >= g.x1 && s.x <= g.x2 && s.z >= g.z1 && s.z <= g.z2, `${where}: outside the grid ${g.x1}..${g.x2}, ${g.z1}..${g.z2}`);
    ok(s.layer >= 1 && s.layer < d.height, `${where}: layer outside 1..${d.height - 1}`);
    const own = at(s.x, s.layer, s.z);
    ok(own === '.' || own === '_' || own === 'air', `${where}: its own cell is ${own}`);
    ok(s.inside === (own === '.'), `${where}: inside ${s.inside} but its cell is ${own}`);
    if (s.block === 'wall_torch') {
      ok(s.facing && STEP[s.facing], `${where}: a wall torch without a facing`);
      const [fx, fz] = STEP[s.facing ?? 'north'];
      const sup = at(s.x - fx, s.layer, s.z - fz);
      ok(factsWall(sup, s.facing!), `${where}: its support ${sup} does not hold a torch facing ${s.facing} (the live facts)`);
      ok(SP.holdsTorch(sup, s.facing), `${where}: holdsTorch refuses its support ${sup}`);
    } else {
      const under = at(s.x, s.layer - 1, s.z);
      ok(factsStand(under), `${where}: a standing torch on ${under}`);
    }
    if (s.src === 'code') {
      ok(s.layer === 2 && s.inside, `${where}: code's spot not inside at layer 2`);
      ok(s.x > g.x1 && s.x < g.x2 && s.z > g.z1 && s.z < g.z2, `${where}: code's spot on the grid's outer ring`);
      ok(!isDoor(at(s.x, 1, s.z)), `${where}: code's spot over a door (${at(s.x, 1, s.z)})`);
    }
    ok(!(opts.signs ?? []).some((q) => q.x === s.x && q.z === s.z && q.layer === s.layer), `${where}: on the sign's cell`);
    ok(!(opts.lamps ?? []).some((q) => q.x === s.x && q.z === s.z), `${where}: on a lamp's column`);
    const k = `${s.x},${s.layer},${s.z}`;
    ok(!seen.has(k), `${where}: twice`);
    seen.add(k);
  }
  return { vanilla: spots.filter((s) => s.src === 'vanilla').length, code: spots.filter((s) => s.src === 'code').length, inside: spots.filter((s) => s.inside).length };
}

// ---- 1. every vanilla piece and the huts at four turns ---------------------------------------------------------------
say('== 1. buildingLights on the vanilla pieces and the huts, four turns');
const pieces: Array<{ biome: string; centre: boolean; design: Design; lights: Any[] }> = [];
if (!hasJar()) say('  no jar: the vanilla pieces are skipped');
else
  for (const biome of VP.VILLAGE_BIOMES)
    for (const kind of ['houses', 'town_centers'] as const)
      for (const p of VP.listPieces(undefined, biome, kind)) {
        if (kind === 'town_centers' && !/meeting_point/.test(p)) continue;
        try {
          const imp = kind === 'houses' ? VP.pieceToDesign(VP.readPiece(p), biome) : VP.centreToDesign(VP.readPiece(p), biome);
          pieces.push({ biome, centre: kind === 'town_centers', design: imp.design, lights: imp.lights });
        } catch {
          // (pieces the importer refuses are not in any library)
        }
      }
{
  const totals: Record<string, { pieces: number; withLights: number; vanilla: number; kept: number; code: number; short: number; tie: number }> = {};
  const all = [...pieces, ...[storageHutDesign(), miningHutDesign()].map((design) => ({ biome: 'huts', centre: false, design, lights: [] as Any[] }))];
  for (const pc of all) {
    const t = (totals[pc.biome] ??= { pieces: 0, withLights: 0, vanilla: 0, kept: 0, code: 0, short: 0, tie: 0 });
    const d = pc.design;
    t.pieces++;
    if (pc.lights.length) t.withLights++;
    t.vanilla += pc.lights.length;
    if (pc.biome !== 'huts') {
      const vl = VP.vanillaLights(d);
      ok(vl && JSON.stringify(vl) === JSON.stringify(pc.lights), `${d.name}: vanillaLights(design) differs from the import's own lights`);
    }
    for (const l of pc.lights) ok(l.layer >= 1 && l.layer < d.height && l.i >= 0 && l.i < d.width && l.j >= 0 && l.j < d.depth, `${d.name}: vanilla light L${l.layer}(${l.i},${l.j}) outside the design's grid`);
    let first: { spots: Any[]; g: ReturnType<typeof grid> } | null = null;
    for (let rot = 0; rot < 4; rot++) {
      const place: Place = { design: d, x: 100, z: -200, rot, noSign: pc.centre };
      const sign = pc.centre ? null : SP.placeSigns([place as Any])[0];
      const signs = sign ? [sign] : [];
      const spots = SP.buildingLights(place as Any, { vanilla: pc.lights, signs: signs as Any });
      const n = judge(d.name, place, spots, { signs });
      if (rot === 0) {
        t.kept += n.vanilla;
        t.code += n.code;
        if (!pc.centre && n.inside < SP.torchesWanted(d)) t.short++;
        first = { spots, g: grid(place) };
        if (VERBOSE) say(`  ${d.name}: ${spots.map((s) => `${s.src[0]}:${s.block}${s.facing ? `[${s.facing}]` : ''}@${s.x - first!.g.x1},L${s.layer},${s.z - first!.g.z1}`).join(' ')}`);
        continue;
      }
      // The first turn's spots turned: vanilla's exactly (a sign's cell may differ by turn: compared off the signs of both)
      const g = grid(place);
      const turned = (s: Any) => {
        const [u, q] = turnCell(s.x - first!.g.x1, s.z - first!.g.z1, d.width, d.depth, rot);
        return `${s.src}:${s.block}:${turnF(s.facing, rot) ?? ''}@${g.x1 + u},${s.layer},${g.z1 + q}`;
      };
      const key = (s: Any) => `${s.src}:${s.block}:${s.facing ?? ''}@${s.x},${s.layer},${s.z}`;
      const v0 = first!.spots.filter((s) => s.src === 'vanilla').map(turned).sort(), v1 = spots.filter((s) => s.src === 'vanilla').map(key).sort();
      const signFree = (xs: string[], ys: string[]) => xs.filter((x) => !ys.includes(x));
      // (a vanilla spot is dropped where that turn's sign hangs: the sign's place can differ by turn)
      ok(signFree(v0, v1).length <= 1 && signFree(v1, v0).length <= 1 && Math.abs(v0.length - v1.length) <= 1, `${d.name} rot ${rot}: vanilla spots are not rot 0's turned (${signFree(v0, v1).join(' ')} | ${signFree(v1, v0).join(' ')})`);
      const c0 = first!.spots.filter((s) => s.src === 'code'), c1 = spots.filter((s) => s.src === 'code');
      ok(c0.length === c1.length || v0.length !== v1.length, `${d.name} rot ${rot}: ${c1.length} code spots, ${c0.length} at rot 0`);
      if (JSON.stringify(c0.map(turned).sort()) !== JSON.stringify(c1.map(key).sort())) t.tie++;
    }
  }
  for (const [b, t] of Object.entries(totals))
    say(`  ${b}: ${t.pieces} pieces, ${t.withLights} with vanilla lights (${t.vanilla} cells), kept ${t.kept}, code adds ${t.code}; short of torchesWanted inside ${t.short}; code spots in another tie order at some turn ${t.tie}`);
  if (unjudged.size) say(`  blocks the facts' rule does not name (taken as no support): ${[...unjudged].map(([n, q]) => `${n} ${q}`).join(', ')}`);
}

// ---- inputs: the stored villages -------------------------------------------------------------------------------------
const INPUTS = ['runs/2026-10-12/golden_inputs/villages_main.json', 'runs/2026-10-12/golden_inputs/villages_test.json'];
const S9F_FILE = 'mc/testserver/villages.json.bak-20261015-013131';
const villages: Array<{ src: string; v: Any }> = [];
for (const f of INPUTS) if (fs.existsSync(f)) for (const v of JSON.parse(fs.readFileSync(f, 'utf8')).villages) villages.push({ src: path.basename(f), v });
const S9F = fs.existsSync(S9F_FILE) ? JSON.parse(fs.readFileSync(S9F_FILE, 'utf8')).villages.find((v: Any) => v.name === 'S9f') : null;
if (S9F) villages.push({ src: 'S9f', v: S9F });
else say(`  no ${S9F_FILE}: S9f's counts are skipped`);

/** A village's built buildings: structures with a design and a done Build task by its centre (spec 2.7, L4). */
function builtPlaces(v: Any): Array<{ s: Any; place: Place; lay: Any }> {
  const out: Array<{ s: Any; place: Place; lay: Any }> = [];
  for (const t of v.tasks ?? []) {
    const m = /build_design "([^"]+)" x=(-?\d+) z=(-?\d+)(?: rotate=(\d+))?/.exec(t.detail ?? '');
    if (!m || t.status !== 'done') continue;
    const d: Design | undefined = v.designs?.[m[1]];
    if (!d) continue;
    const rot = ((Math.round(Number(m[4] ?? 0) / 90) % 4) + 4) % 4;
    const place: Place = { design: d, x: Number(m[2]), z: Number(m[3]), rot, noSign: /meeting_point|town_cent/.test(d.name) };
    const g = grid(place);
    const s = (v.structures ?? []).find((q: Any) => q.kind === d.name && q.x1 === g.x1 && q.z1 === g.z1);
    if (!s) continue;
    const lay = (v.layouts ?? []).find((l: Any) => g.x1 >= l.x1 && g.x2 <= l.x2 && g.z1 >= l.z1 && g.z2 <= l.z2) ?? v.layouts?.[0];
    out.push({ s, place, lay });
  }
  return out;
}

// ---- 2. the stored villages' buildings and doorStand's candidates ----------------------------------------------------
say('== 2. the stored villages\' buildings');
{
  let buildings = 0, spotsN = 0, withStand = 0, fallback = 0, s9f = -1;
  const standWhy: Record<string, number> = {}, winner: Record<number, number> = {};
  let centres = 0;
  const inArea = (a: Any, x: number, z: number) => x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2;
  const noStand: string[] = [];
  for (const { src, v } of villages) {
    const built = builtPlaces(v);
    let vTotal = 0;
    const doors = built.map((b) => (b.place.noSign ? null : SP.placedDoor(b.place as Any)));
    // doorStand's taken ground (standTaken): structures, tasks' footprints, the mine's boxes (with their tops), lamps and
    // signs of every layout, the farm and the slots; and every building's door cell and the cell in front of it
    const allSigns = (v.layouts ?? []).flatMap((l: Any) => l.signs ?? []), allLamps = (v.layouts ?? []).flatMap((l: Any) => l.lamps ?? []);
    const taken: Array<{ a: Any; what: string; top?: number }> = (v.structures ?? []).map((q: Any) => ({ a: q, what: 'structure' }));
    for (const t of v.tasks ?? []) {
      const m = /footprint x (-?\d+)\.\.(-?\d+), z (-?\d+)\.\.(-?\d+)/.exec(t.detail ?? '');
      if (m) taken.push({ a: { x1: +m[1], x2: +m[2], z1: +m[3], z2: +m[4] }, what: 'footprint' });
    }
    if (v.mine) {
      const m = JSON.parse(JSON.stringify(v.mine));
      upgradeMine(m);
      for (const q of MM.mineAreas(m)) taken.push({ a: q, what: 'mine', top: q.y2 });
    }
    for (const c of allSigns) taken.push({ a: { x1: c.x, x2: c.x, z1: c.z, z2: c.z }, what: 'sign' });
    for (const c of allLamps) taken.push({ a: { x1: c.x, x2: c.x, z1: c.z, z2: c.z }, what: 'lamp' });
    for (const l of v.layouts ?? []) {
      if (l.farm) taken.push({ a: l.farm, what: 'farm' });
      for (const q of l.slots ?? []) taken.push({ a: q, what: 'slot' });
      if (l.works && l.works.x2 >= l.works.x1 && l.works.z2 >= l.works.z1) taken.push({ a: l.works, what: 'works' });
    }
    // (every door cell and the cell in front of it; another building's walkway 2 and 3 out too, B.4's review, lens 1 L4)
    const doorways = new Set<string>(), walkways = doors.map((d) => (d ? [2, 3].map((k) => `${d.x + d.ox * k},${d.z + d.oz * k}`) : []));
    for (const d of doors) if (d) for (const k of [0, 1]) doorways.add(`${d.x + d.ox * k},${d.z + d.oz * k}`);
    for (const [bi, b] of built.entries()) {
      const signs = b.lay?.signs ?? [], lamps = b.lay?.lamps ?? [];
      const spots = SP.buildingLights(b.place as Any, { vanilla: VP.vanillaLights(b.place.design), signs, lamps });
      const label = `${src}/${v.name}/${b.s.id} ${b.place.design.name}`;
      judge(label, b.place, spots, { signs, lamps });
      for (const s of spots) ok(s.x >= b.s.x1 && s.x <= b.s.x2 && s.z >= b.s.z1 && s.z <= b.s.z2, `${label}: spot ${s.x},${s.z} outside its structure`);
      buildings++;
      spotsN += spots.length;
      vTotal += spots.length;
      // doorStand's candidates (the lead's ruling, mcBuild.ts doorStand; a doorless town centre falls back by design)
      const door = doors[bi];
      if (!spots.length) continue;
      if (!door) {
        centres++;
        continue;
      }
      const st = b.s;
      const side = [door.oz, -door.ox];
      const cands: Array<[number, number]> = [];
      for (const s of [2, -2, 1, -1]) cands.push([door.x + 3 * door.ox + s * side[0], door.z + 3 * door.oz + s * side[1]]);
      for (const s of [2, -2]) cands.push([door.x + 4 * door.ox + s * side[0], door.z + 4 * door.oz + s * side[1]]);
      const near = (x: number, z: number) => Math.hypot(x - (st.x1 + st.x2) / 2, z - (st.z1 + st.z2) / 2) <= 12 || Math.hypot(x - door.x, z - door.z) <= 12;
      // (each candidate's first rule broken, counted per building by the rules that removed its candidates)
      const broken = ([x, z]: [number, number]) => {
        if (inArea({ x1: st.x1 - 1, z1: st.z1 - 1, x2: st.x2 + 1, z2: st.z2 + 1 }, x, z)) return 'own area + 1';
        if (!near(x, z)) return 'over 12';
        const q = taken.find((t) => inArea(t.a, x, z) && (t.top === undefined || t.top >= st.y));
        if (q) return q.what;
        if (doorways.has(`${x},${z}`)) return 'doorway';
        return walkways.some((w, i) => i !== bi && w.includes(`${x},${z}`)) ? 'walkway' : '';
      };
      const why = cands.map(broken);
      const k = why.findIndex((w) => !w);
      if (k >= 0) {
        withStand++;
        winner[k] = (winner[k] ?? 0) + 1;
      } else {
        fallback++;
        for (const w of new Set(why)) standWhy[w] = (standWhy[w] ?? 0) + 1;
        if (noStand.length < 12) noStand.push(`${v.name}/${b.place.design.name}`);
      }
    }
    if (src === 'S9f') s9f = vTotal;
  }
  say(`  ${villages.length} villages, ${buildings} built buildings, ${spotsN} spots`);
  say(`  doorStand: of ${withStand + fallback} with a door and spots, ${withStand} find a candidate (by its place in the order: ${Object.entries(winner).map(([k, n]) => `${k} ${n}`).join(', ')}), ${fallback} fall back${noStand.length ? ` (${noStand.join(', ')})` : ''}${fallback ? `; the rules their candidates broke: ${Object.entries(standWhy).map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}; ${centres} doorless town centres fall back by design`);
  // (the lead's ruling, A's replica: 2 of the stored buildings with a door fall back)
  // (5 since the straight-out candidates went, the fix review's M2: Hutvale4's and Minevale2's huts and a cottage, by
  // structures; a fallback still walks to standSpot's spot)
  ok(fallback <= 5, `doorStand: ${fallback} buildings with a door fall back (5 expected)`);
  if (S9F) ok(s9f === 23, `S9f's buildings give ${s9f} spots (the spec: 23)`);
  if (S9F) say(`  S9f: ${s9f} building spots`);
}

// ---- 3. the mines ----------------------------------------------------------------------------------------------------
say('== 3. mineLights on every recorded mine');
const mainOf = (l: MineLeg) => (l.br ? l.main ?? 0 : fromOrder(l.dug).main);
const brOf = (l: MineLeg, b: number) => (l.br ? l.br[b] : fromOrder(l.dug).br[b]) ?? 0;
function cellAt(l: MineLeg, u: 'main' | number, n: number) {
  const [dx, dz] = l.dir;
  if (u === 'main') return { x: l.x + dx * n, z: l.z + dz * n };
  const k = MINE_STEP * (Math.floor(u / 3) + 1);
  const [bx, bz] = u % 3 === 1 ? [dz, -dx] : [-dz, dx];
  return { x: l.x + dx * k + bx * n, z: l.z + dz * k + bz * n };
}
/** A tunnel's cells: its main cells 1..main and each junction's branches 1..min(12, dug), or with `full` every cell its
 *  main up to `main` and the branches of those junctions may reach. */
function tunnelCells(l: MineLeg, main: number, full: boolean) {
  const out: Array<{ x: number; z: number }> = [];
  for (let i = 1; i <= main; i++) out.push(cellAt(l, 'main', i));
  for (let s = 0; s < Math.floor(main / MINE_STEP); s++)
    for (const b of [3 * s + 1, 3 * s + 2]) for (let j = 1; j <= (full ? MINE_BRANCH : Math.min(MINE_BRANCH, brOf(l, b))); j++) out.push(cellAt(l, b, j));
  return out;
}
const stairCols = (m: Mine) => Array.from({ length: m.steps }, (_, i) => ({ x: m.top.x + m.dir[0] * i, z: m.top.z + m.dir[1] * i }));
const runCols = (x: number, z: number, dir: [number, number], n: number) => Array.from({ length: n }, (_, k) => ({ x: x + dir[0] * (k + 1), z: z + dir[1] * (k + 1) }));

/** Cells (x,y,z) a torch may not hang on in this mine: dug ones, ones it may still dig, stairs' and iron stairs' own. */
function keepOff(m: Mine) {
  const out = new Set<string>();
  const add2 = (c: { x: number; z: number }, y: number) => { out.add(`${c.x},${y},${c.z}`); out.add(`${c.x},${y + 1},${c.z}`); };
  const legs = [...(m.legs ?? []).map((l, k) => ({ l, first: k === 0 })), ...(m.iron?.legs ?? []).map((l, k) => ({ l, first: k === 0 }))];
  for (const { l, first } of legs) {
    out.add(`${l.x},${l.y},${l.z}`);
    out.add(`${l.x},${l.y + 1},${l.z}`);
    for (const c of tunnelCells(l, mainOf(l), false)) add2(c, l.y);
    // (every branch of a dug junction to its full length, and the next two stretches with theirs)
    for (const c of tunnelCells(l, mainOf(l) + (l.end ? 0 : 2 * MINE_STEP), true)) add2(c, l.y);
    // (the tunnels it may turn into: their first four stretches with their branches)
    for (const side of [1, 2] as const) {
      const t = MM.turnFrom(l, side, first);
      if (t) for (const c of tunnelCells(t, 4 * MINE_STEP, true)) add2(c, t.y);
    }
  }
  const steps = (cols: Array<{ x: number; z: number }>, floor: (k: number) => number) =>
    cols.forEach((c, k) => { for (let dy = 1; dy <= 3; dy++) out.add(`${c.x},${floor(k + 1) + dy},${c.z}`); });
  if (m.level !== undefined) {
    const y0 = m.level + m.steps - 1;
    steps(stairCols(m), (i) => y0 - i);
  }
  for (const d of m.down ?? []) steps(runCols(d.x, d.z, m.dir, d.steps), (k) => d.y - 1 - k);
  const i = m.iron;
  if (i) {
    steps(runCols(i.x, i.z, i.dir, Math.max(i.steps, i.level === undefined && !i.finished ? 60 : 0)), (k) => i.y - 1 - k);
    for (const a of i.abandoned ?? []) steps(runCols(a.x, a.z, a.dir, a.steps), (k) => a.y - 1 - k);
  } else if (m.level !== undefined) {
    // (no iron level yet: where ironStart would put its stairs, 60 steps)
    const s = MM.ironStart(m);
    if (s) steps(runCols(s.x, s.z, s.dir, 60), (k) => s.y - 1 - k);
  }
  return out;
}
/** Whether a spot is a dug cell at head height of its own part. */
function dugHead(m: Mine, s: Any): boolean {
  const legHead = (l: MineLeg) => s.y === l.y + 1 && (MM.legCells(l).some((c) => c.x === s.x && c.z === s.z));
  const stepHead = (cols: Array<{ x: number; z: number }>, head: (k: number) => number) => cols.some((c, k) => c.x === s.x && c.z === s.z && head(k + 1) === s.y);
  if (s.part === 'mine:stairs') return m.level !== undefined && stepHead(stairCols(m), (n) => m.level! + m.steps - 1 - n + 2);
  const down = /^mine:down:(\d+)$/.exec(s.part);
  if (down) { const d = m.down?.[Number(down[1])]; return !!d && stepHead(runCols(d.x, d.z, m.dir, d.steps), (k) => d.y - k + 1); }
  if (s.part === 'mine:iron') {
    const i = m.iron;
    return !!i && (stepHead(runCols(i.x, i.z, i.dir, i.steps), (k) => i.y - k + 1) || i.legs.some(legHead));
  }
  const leg = /^mine:(\d+)$/.exec(s.part);
  return !!leg && !!m.legs?.[Number(leg[1])] && legHead(m.legs[Number(leg[1])]);
}
function judgeMine(label: string, m: Mine) {
  const spots = MM.mineLights(m);
  const off = keepOff(m);
  const seen = new Set<string>();
  for (const s of spots) {
    const where = `${label}: ${s.part} spot ${s.x},${s.y},${s.z}`;
    ok(dugHead(m, s), `${where}: not a dug cell at head height of its part`);
    const k = `${s.x},${s.y},${s.z}`;
    ok(!seen.has(k), `${where}: twice`);
    seen.add(k);
    ok(s.sides.length >= 1 && s.sides.length <= 2, `${where}: ${s.sides.length} sides`);
    for (const side of s.sides) {
      const [sx, sy, sz] = side.support;
      ok(sy === s.y && Math.abs(sx - s.x) + Math.abs(sz - s.z) === 1, `${where}: support ${side.support} not beside it`);
      const [fx, fz] = STEP[side.facing];
      ok(s.x - fx === sx && s.z - fz === sz, `${where}: facing ${side.facing} does not point away from its support ${side.support}`);
      ok(!off.has(`${sx},${sy},${sz}`), `${where}: its ${side.facing}-facing support ${side.support} is dug or may be dug`);
    }
  }
  return spots;
}
/** The mine with its last tunnel grown by `n` cells (open branches first, then on along the main), stopping a unit at any
 *  cell already dug; or null when it has no tunnel to grow. */
function grow(m0: Mine, n: number): Mine | null {
  const m: Mine = JSON.parse(JSON.stringify(m0));
  const l = [...(m.legs ?? [])].reverse().find((x) => !x.end);
  if (!l) return null;
  if (!l.br) Object.assign(l, fromOrder(l.dug));
  const dug = new Set<string>();
  for (const q of m.legs ?? []) for (const c of [{ x: q.x, z: q.z }, ...MM.legCells(q)]) dug.add(`${c.x},${q.y},${c.z}`);
  for (let k = 0; k < n; k++) {
    const open: number[] = [];
    for (let s = 0; s < Math.floor(mainOf(l) / MINE_STEP); s++) for (const b of [3 * s + 1, 3 * s + 2]) if (brOf(l, b) < MINE_BRANCH && !l.ended.includes(b)) open.push(b);
    const u: 'main' | number = open.length ? open[0] : 'main';
    if (u === 'main' && l.end) break;
    const next = u === 'main' ? cellAt(l, 'main', mainOf(l) + 1) : cellAt(l, u, brOf(l, u) + 1);
    if (dug.has(`${next.x},${l.y},${next.z}`)) {
      if (u === 'main') l.end = 'met a tunnel (grown)';
      else l.ended.push(u);
      continue;
    }
    dug.add(`${next.x},${l.y},${next.z}`);
    if (u === 'main') l.main = mainOf(l) + 1;
    else l.br![u] = brOf(l, u) + 1;
    m.dug++;
  }
  l.dug = (l.main ?? 0) + Object.values(l.br!).reduce((s, q) => s + q, 0);
  return m;
}
{
  let mines = 0, total = 0, s9f = -1;
  const added: Record<number, number[]> = { 24: [], 48: [], 96: [] };
  for (const { src, v } of villages) {
    const m: Mine | undefined = v.mine;
    if (!m?.legs?.length || m.level === undefined) continue;
    mines++;
    const label = `${src}/${v.name}`;
    const spots = judgeMine(label, m);
    total += spots.length;
    // (S9f's 38, spec 3.2, counts the spots a light chore may take: none within 2 of a face still going)
    if (src === 'S9f') {
      const faces = MM.mineFacesGoing(m);
      s9f = spots.filter((s) => !MM.nearMineFace(faces, s)).length;
      say(`  S9f: ${spots.length} spots, ${s9f} beyond 2 of a going face (${[...new Set(spots.map((s) => s.part))].map((p) => `${p} ${spots.filter((s) => s.part === p).length}`).join(', ')})`);
    }
    ok(MM.mineGrowing(m, 'mine:stairs') === false, `${label}: the stairs grow with a level reached`);
    if (VERBOSE) say(`  ${label}: ${spots.length} spots (${[...new Set(spots.map((s) => s.part))].map((p) => `${p} ${spots.filter((s) => s.part === p).length}`).join(', ')})`);
    const before = new Set(spots.map((s) => `${s.x},${s.y},${s.z}`));
    for (const n of [24, 48, 96]) {
      const g = grow(m, n);
      if (!g) continue;
      const after = judgeMine(`${label} grown ${n}`, g);
      added[n].push(after.filter((s) => !before.has(`${s.x},${s.y},${s.z}`)).length);
      ok(after.length >= spots.length, `${label} grown ${n}: ${after.length} spots, fewer than ${spots.length}`);
    }
  }
  say(`  ${mines} mines, ${total} spots`);
  for (const [n, xs] of Object.entries(added)) if (xs.length) say(`  grown by ${n} cells: ${xs.length} mines, spots added ${Math.min(...xs)}..${Math.max(...xs)} (mean ${(xs.reduce((s, q) => s + q, 0) / xs.length).toFixed(1)})`);
  if (S9F) ok(s9f === 38, `S9f's mine gives ${s9f} spots beyond its going faces (the spec: 38)`);
}

// ---- 4. the charge -----------------------------------------------------------------------------------------------------
say('== 4. wall torches in designs (refused, no item)');
{
  let designs = 0, withTorch = 0;
  for (const { v } of villages)
    for (const d of Object.values(v.designs ?? {}) as Design[]) {
      designs++;
      if (Object.values(d.palette ?? {}).some((b) => /^(minecraft:)?wall_torch\b/.test(String(b)))) withTorch++;
    }
  ok(withTorch === 0, `${withTorch} stored designs hold a wall torch`);
  // (no CHARGE_AS for wall_torch, B.4's review, lens 3 L4: a design holding one stays refused as before B.4)
  const t: Design = { name: 'torchtest', description: '', palette: { W: 'wall_torch[facing=north]', T: 'torch', P: 'oak_planks' }, layers: [['WTP']], width: 3, depth: 1, height: 1, blocks: 3 } as unknown as Design;
  const b = designBill(t);
  ok(b.torch === 1 && b.wall_torch === 1, `a wall torch and a torch billed as ${JSON.stringify(b)} (want 1 wall_torch, 1 torch: the wall torch has no item and is refused)`);
  say(`  ${designs} stored designs, ${withTorch} with a wall torch; a test design's bill ${JSON.stringify(b)}`);
}

// ---- 5. the world: the demand, the make target, the menus -------------------------------------------------------------
say('== 5. the torch demand and make:torch on a world');
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const TORCH = W9.MAKE_GOODS.find((g) => g.item === 'torch')!;
function world(store: Record<string, number>) {
  const v = JSON.parse(JSON.stringify(S9F));
  v.name = 'B4Check';
  v.complete = true;
  delete v.lights;
  for (const c of v.storage.chests) c.items = {};
  v.storage.chests[0].items = { ...store };
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
  fs.writeFileSync(path.join(dir, 'villages.json'), JSON.stringify({ villages: [v] }));
  mute();
  const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
  unmute();
  w.villages.save = () => {};
  const vv = w.villages.get(v.name);
  w.atlas.sightings = () => [];
  w.atlas.animalSightings = () => [];
  w.atlas.known = () => 1;
  w.faces = () => ({ faces: 2, free: 2, held: 0, tunnels: 2, branches: 0, turns: 0, down: 0 });
  const home = v.storage.chests[0];
  const sections = new Array(24).fill(null);
  const getColumn = () => ({ minY: -64, sections, getBlockStateId: () => 0 });
  const agents: Any[] = [];
  for (let i = 1; i <= 4; i++) {
    const name = `Worker${i}`, own: Any[] = [];
    const memory = { village: v.name, villageRole: 'worker' };
    const a: Any = {
      name, role: 'worker', memory, world: w, village: () => w.villages.get(memory.village), own,
      idle: () => !own.some((s) => s.state === 'queued' || s.state === 'running'),
      enqueue: (type: string, args: Record<string, unknown>) => { const s = { id: own.length + 1, type, args, state: 'queued' }; own.push(s); return s; },
      bot: { entity: { position: { x: home.x + 0.5, y: home.y, z: home.z + 0.5 } }, entities: {}, inventory: { items: () => [] }, world: { getColumn }, game: { minY: -64 } },
    };
    agents.push(a);
    w.agents.set(name.toLowerCase(), a);
  }
  return { w, v: vv, agents };
}
// (the sweep's facts are kept per clock time: each menu here is asked a minute on, after the storage changed)
const menuOf = (w: Any, a: Any) => {
  clock += MIN;
  return (w.choices(a)?.options ?? []) as Any[];
};
if (!S9F) ok(false, `S9f's record (${S9F_FILE}) for the world checks`);
else if (typeof (MineflayerWorld.prototype as Any).lightParts !== 'function' || typeof (MineflayerWorld.prototype as Any).makeTarget !== 'function') ok(false, 'MineflayerWorld has no lightParts/torchDemand/makeTarget yet');
else {
  const store = { charcoal: 16, birch_log: 40, cobblestone: 200 };
  const { w, v, agents } = world({ ...store, torch: 0 });
  mute();
  try {
    clock += MIN;
    const parts: Any[] = w.lightParts(v);
    const unlit = parts.reduce((s, p) => s + p.unlit, 0);
    const spots = parts.reduce((s, p) => s + p.spots.length, 0);
    const demand = w.torchDemand(v);
    ok(demand === unlit, `torchDemand ${demand}, the parts' unlit ${unlit}`);
    const want = Math.max(TORCH.target, Math.min(W9.TORCH_DEMAND_CAP, demand) + W9.TORCH_RESERVE);
    ok(w.makeTarget(v, TORCH) === want, `makeTarget ${w.makeTarget(v, TORCH)} for a demand of ${demand} (want ${want})`);
    // (other goods keep their targets)
    for (const g of W9.MAKE_GOODS) if (g.item !== 'torch') ok(w.makeTarget(v, g) === g.target, `makeTarget of ${g.item} ${w.makeTarget(v, g)} (its target ${g.target})`);
    // Torches carried by a light chore lower the demand
    const key = W9.holdKey(v.name, agents[0].name);
    W9.lightCarried.set(key, 5);
    ok(w.torchDemand(v) === Math.max(0, demand - 5), `5 torches carried: the demand ${w.torchDemand(v)} (want ${Math.max(0, demand - 5)})`);
    W9.lightCarried.delete(key);
    // The family off: S.9's target
    CHOOSE.families.delete('light');
    const off = w.makeTarget(v, TORCH);
    const offMenu = menuOf(w, agents[0]);
    CHOOSE.families.add('light');
    ok(off === TORCH.target, `the family off: makeTarget ${off} (want ${TORCH.target})`);
    ok(!offMenu.some((o) => o.kind === 'light'), 'the family off: a light option in the menu');
    // No torches: no light option, make:torch offered
    const m0 = menuOf(w, agents[0]);
    ok(!m0.some((o) => o.kind === 'light'), `no torches stored: light options ${m0.filter((o) => o.kind === 'light').map((o) => o.id).join(', ')}`);
    ok(m0.some((o) => o.id === 'make:torch'), `no torches stored, ${demand} spots waiting: make:torch not offered (${m0.map((o) => o.id).join(', ')})`);
    // 32 torches stored with spots waiting: make:torch still offered (the target above 32), light options within the trip
    const items = v.storage.chests[0].items;
    items.torch = TORCH.target;
    const m1 = menuOf(w, agents[0]);
    if (want > TORCH.target) ok(m1.some((o) => o.id === 'make:torch'), `32 torches stored, demand ${demand}: make:torch not offered`);
    const lights = m1.filter((o) => o.kind === 'light');
    ok(lights.length > 0, `32 torches stored: no light option (${m1.map((o) => o.id).join(', ')})`);
    const ids = new Set<string>();
    for (const o of lights) {
      const p = parts.find((q) => `light:${q.part}` === o.id);
      ok(p, `${o.id}: not a part`);
      ok(!ids.has(o.id), `${o.id} twice in a menu`);
      ids.add(o.id);
      const n = Number(/takes (\d+) torch/.exec(o.facts)?.[1] ?? NaN);
      if (p) ok(n >= Math.min(p.unlit, W9.LIGHT_MIN_TRIP) && n <= Math.min(p.unlit, W9.LIGHT_TRIP), `${o.id}: ${n} torches for ${p.unlit} unlit (facts "${o.facts}")`);
      ok(o.rank >= 860 && o.rank < 900, `${o.id}: rank ${o.rank} outside 860-899`);
    }
    // Every spot done: no demand, make:torch stops at 32, logs no longer wanted for torches
    v.lights = {};
    for (const p of parts) v.lights[p.part] = { done: p.spots.map((s: Any) => `${s.x},${s.y},${s.z}`), at: clock, by: 'light_check' };
    clock += MIN;
    const after: Any[] = w.lightParts(v);
    ok(after.every((p) => p.unlit === 0), `every spot done: unlit left ${after.filter((p) => p.unlit).map((p) => `${p.part} ${p.unlit}`).join(', ')}`);
    ok(w.torchDemand(v) === 0, `every spot done: the demand ${w.torchDemand(v)}`);
    ok(w.makeTarget(v, TORCH) === TORCH.target, `every spot done: makeTarget ${w.makeTarget(v, TORCH)} (want ${TORCH.target})`);
    const m2 = menuOf(w, agents[0]);
    ok(!m2.some((o) => o.id === 'make:torch'), 'every spot done, 32 torches stored: make:torch still offered');
    ok(!m2.some((o) => o.kind === 'light'), `every spot done: light options ${m2.filter((o) => o.kind === 'light').map((o) => o.id).join(', ')}`);
    const g2 = w.gatherWanted(v);
    ok(!(g2.logs?.for ?? []).some((f: string) => /torch/.test(f)), `every spot done, 32 torches stored: logs still wanted for ${g2.logs?.for}`);
    say(`  ${parts.length} parts (${parts.filter((p) => p.kind === 'building').length} buildings, ${parts.filter((p) => p.kind === 'mine').length} of the mine), ${spots} spots, ${unlit} unlit; demand ${demand}, make target ${want}; light options at 32 torches ${lights.map((o) => o.id).join(', ')}`);
  } finally {
    unmute();
  }
}

fs.rmSync(SCRATCH, { recursive: true, force: true });
say(`${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);

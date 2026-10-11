/**
 * plan_layout: lay a village's buildings out on one plot and post every task they need. Code does the geometry and the
 * materials; the mayor (tieredBrain) only names the buildings. Also used by the API (tests start a village at a stage).
 */
import { HOUSE_UNITS } from './designs';
import type { WorldAdapter } from './world';
import { STATION_NAMES, STATIONS_TASK, areaText, layoutBuildings, overlaps, signCall, type Area, type FarmSlot, type Layout, type Village } from './village';
import { doorOf, placeFarm, placeLamps, placeSigns, planGreen, planStreets, type FarmSpot, type PlanItem, type SignSpot, type StreetLayout } from './streetPlan';
import { hutSpots, MINING_HUT, miningHutDesign, miningHutTurn, miningStairs, STORAGE_HUT, STORAGE_HUT_SPOTS, STORAGE_HUT_STAND, storageHutDesign } from './huts';

export interface Site {
  x: number;
  y: number;
  z: number;
  /** The find_site search size: the plot must fit in it. */
  size?: number;
  /** The commonest wood kind near it (find_site): the village gathers and builds in it, if there is enough of it. */
  wood?: string;
  /** How many log blocks of that kind are within 64 blocks. */
  woodLogs?: number;
  /** The biome at the site (Minecraft's name): the street plan's town centre comes from it (V2.3). */
  biome?: string;
}

/**
 * Place the buildings (design names, one per building, or {design, count}) on one plot around the site and post, in
 * order: prepare the plot, set up the storage and gather materials (the survival economy, when `economy`), then each
 * building at its computed position. In the economy a village's first layout adds the storage hut by itself (the mayor
 * does not name it): the first chest goes into the hut's first chest spot, the hut is built around it, and the other
 * buildings wait for the hut's table and furnace, placed in their cells before it (S.5; their gathering does not wait).
 * Returns what happened, or why not ("plan_layout: ..."), for
 * the poster's events.
 */
export function postLayout(w: WorldAdapter, v: Village, by: string, site: Site | undefined, buildings: unknown, economy: boolean): string {
    const reg = w.villages;
    const raw = Array.isArray(buildings) ? (buildings as unknown[]) : typeof buildings === 'string' ? buildings.split(',') : [];
    const names: string[] = [];
    for (const b of raw) {
      // A name, or {design, count}
      const o = b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
      const n = String(o ? o.design ?? o.name ?? '' : b).trim().toLowerCase().replace(/^"|"$/g, '');
      const count = o && Number(o.count) > 1 ? Math.min(8, Math.floor(Number(o.count))) : 1;
      // The storage and mining huts are code's to add, not the mayor's
      if (n && n !== STORAGE_HUT && n !== MINING_HUT) for (let i = 0; i < count; i++) names.push(n);
    }
    if (!names.length) return 'plan_layout needs buildings: a list of design names, one per building (repeat a name for each copy)';
    const missing = [...new Set(names.filter((n) => !v.designs[n]))];
    if (missing.length) return `plan_layout: no design yet for ${missing.map((n) => `"${n}"`).join(', ')}; draw ${missing.length > 1 ? 'them' : 'it'} with design_building first, then call plan_layout again`;
    if (!site) return `plan_layout: no site yet; run find_site first (${v.plan === 'street' ? 'size 40: room for a green' : 'size 30 for three or four small buildings'})`;
    const laidOut = v.tasks.filter((t) => t.postedBy === by && /^Build /.test(t.title) && t.status !== 'failed' && t.status !== 'done');
    if (v.unplaced?.length) {
      // A later layout is for the buildings that did not fit on the first site (the mayor may name them all again)
      const rest = [...v.unplaced];
      const second = names.filter((n) => {
        const i = rest.indexOf(n);
        return i >= 0 && rest.splice(i, 1).length > 0;
      });
      if (!second.length) return `plan_layout: ${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} already laid out; still waiting for a site: ${v.unplaced.join(', ')} (run find_site, then plan_layout with ${v.unplaced.length > 1 ? 'those names' : 'that name'})`;
      names.splice(0, names.length, ...second);
    } else if (laidOut.length) return `plan_layout: the buildings are already on the task board (${laidOut.map((t) => t.id).join(', ')}); wait for them, or re-post a failed task with post_tasks`;
    // A new village's first layout gets the storage hut (villages laid out before it keep their loose chests)
    const withHut = economy && !v.storageHut && !v.storage?.chests.length && !v.layouts?.length;
    if (withHut) {
      v.designs[STORAGE_HUT] = storageHutDesign();
      v.designs[MINING_HUT] = miningHutDesign();
      names.unshift(MINING_HUT, STORAGE_HUT);
    }
    // Matching vanilla houses are siblings, not one design twice (the user's choice for V2.3; Minevale19's mayor named
    // plains_small_house_1 twice): a repeated small house becomes another of the library's small houses
    if (v.plan === 'street' && !v.layouts?.length) {
      const spare = Object.values(v.designs).filter((d) => d.by === 'vanilla' && /small_house/.test(d.name) && !names.includes(d.name)).map((d) => d.name);
      const seen = new Set<string>();
      names.forEach((n, i) => {
        if (v.designs[n]?.by !== 'vanilla' || !/small_house/.test(n)) return;
        if (seen.has(n) && spare.length) names[i] = spare.shift()!;
        seen.add(names[i]);
      });
    }
    // The street plan (V2.3), for a village's first plot: the town centre of the site's biome in the middle, streets from
    // it, every building turned to face one (a second site gets rows)
    // (the biome the library came from, else the site's: a failed find_site moves the site without refilling the library)
    const lib = v.plan === 'street' && !v.layouts?.length && w.vanillaLibrary ? w.vanillaLibrary(v.vanillaBiome ?? site.biome ?? 'plains') : null;
    let centre = lib?.centre ?? null;
    if (centre) {
      v.designs[centre.design.name] = centre.design;
      names.push(centre.design.name);
    }
    // The centre is code's choice: when it cannot be had, the streets just cross (the mayor is not asked to redraw it)
    const dropCentre = () => {
      if (centre && names.includes(centre.design.name)) names.splice(names.lastIndexOf(centre.design.name), 1);
      if (centre && v.designs[centre.design.name] === centre.design) delete v.designs[centre.design.name];
      centre = null;
    };
    const materials = new Map<string, ReturnType<NonNullable<WorldAdapter['materialTasks']>>>();
    // One wood kind for the whole village, chosen at its first layout, when there is enough of it near the site for
    // these buildings with a margin (acacia chosen from 42 logs for ~80 needed sent gatherers 80 blocks away); otherwise
    // any kind is gathered and builders mix kinds part by part
    // Buildings built after the storage hut use its crafting table and furnace (the opportunities analysis #5: each
    // house billed 8 cobblestone and a log for its own): only the storage hut bills them (its furnace is crafted at a
    // table before its own stands), and villages laid out before the hut existed; the mining hut needs none (planks only)
    // (S.5: not the storage hut either where its stations are placed early, by their own task: neither its station to craft
    // at nor its own table and furnace blocks, `hutWithout`)
    const stationsEarly = withHut && !!w.taskSkills?.includes('place_station');
    const ownStations = (n: string) => n !== MINING_HUT && (!(withHut || v.storageHut) || (n === STORAGE_HUT && !stationsEarly));
    const hutWithout = (n: string) => (n === STORAGE_HUT && stationsEarly ? ['crafting_table', 'furnace'] : []);
    // The windows made once for the village (S.3), in the same villages: smelted and crafted at the hut by one worker
    // for every building, their sand gathered once (14 panes are 6 sand, where each building's own bill made it 18); the
    // budget and the wood checks still judge each building's whole bill. Only where the world can make them so
    const pooled = economy && (withHut || !!v.storageHut) && !!w.sharedParts && !!w.taskSkills?.includes('make_into_storage');
    let wood = v.wood;
    if (!wood && economy && site.wood) {
      const logs = names.filter((n) => n !== centre?.design.name).reduce((s, n) => s + (w.materialTasks!(v.designs[n], n, undefined, ownStations(n), hutWithout(n)).logs ?? 0), 0);
      if ((site.woodLogs ?? 0) >= logs * 1.5) wood = site.wood;
    }
    if (economy)
      for (const n of new Set(names)) {
        const m = w.materialTasks!(v.designs[n], '{label}', wood, ownStations(n), hutWithout(n));
        if (m.problems.length && n === centre?.design.name) { dropCentre(); continue; }
        if (m.problems.length) return `plan_layout: the "${n}" design cannot be built here (${m.problems.join('; ')}); draw a replacement with other materials under a new name, then call plan_layout with it`;
        materials.set(n, m);
      }
    // One building over a house's budget a village (phase D): a landmark drawn for two copies would double the gathering
    if (economy) {
      const big = names.filter((n) => (materials.get(n)?.units ?? 0) > HOUSE_UNITS);
      if (big.length > 1) return `plan_layout: ${[...new Set(big)].map((n) => `"${n}" needs ${materials.get(n)!.units} blocks gathered`).join(', ')}${big.length > new Set(big).size ? ' (and is listed more than once)' : ''}; a village has room for one building over ${HOUSE_UNITS}: lay out one of them, or draw smaller designs (under ${HOUSE_UNITS} blocks gathered, under new house names) for the rest`;
    }
    // Every material a design needs gathered must be near the site: a hall drawn in sandstone in a jungle waited for 81
    // sandstone no one could find (Accept3). Sand is let off: without it the windows stay open
    if (economy && w.materialsNear) {
      // How much of each, for every copy (Accept12: one sandstone block near the site passed a hall needing 81)
      const want = new Map<string, string[]>();
      const amount: Record<string, number> = {};
      for (const [n, m] of materials) {
        // (not the centre's: a centre short of something is left out at the layout instead)
        if (n === centre?.design.name) continue;
        const copies = names.filter((x) => x === n).length;
        for (const t of m.tasks) {
          const g = /collect block=(\S+) count=(\d+)/.exec(t.detail);
          if (!g || /^(red_)?sand$/.test(g[1])) continue;
          want.set(g[1], [...new Set([...(want.get(g[1]) ?? []), n])]);
          amount[g[1]] = (amount[g[1]] ?? 0) + Number(g[2]) * copies;
        }
      }
      const found = want.size ? w.materialsNear(by, amount, site.x, site.y, site.z, 96) : null;
      // Wood may come up to a quarter short of the count: prepare_site's felled trees give logs too, and the count sees
      // only the ground the mayor has loaded (Accept13: 115 of 131 refused, and the mayor went round in circles)
      const isWood = (b: string) => /(^|_)logs?$/.test(b);
      const missing = found ? [...want.keys()].filter((b) => found[b] !== undefined && found[b] < amount[b] * (isWood(b) ? 0.75 : 1)) : [];
      // Too few trees: every building needs planks, so the site or the size is wrong (Accept7's desert)
      const wood = missing.find(isWood);
      if (wood) return `plan_layout: there are too few trees within 96 blocks of this site (${found![wood]} log blocks for the ${amount[wood]} these buildings need); either draw smaller buildings (5x5 cottages, a 7x7 hall) under new names and call plan_layout with them, or run find_site for a site with more trees near it`;
      if (missing.length) {
        const designs = [...new Set(missing.flatMap((b) => want.get(b)!))].filter((d) => d !== STORAGE_HUT);
        if (!designs.length) return `plan_layout: there is not enough ${missing.map((b) => `${b} (${found![b]} of ${amount[b]})`).join(' or ')} within 96 blocks of this site for the village's storage hut; run find_site for another site, then plan_layout again`;
        return `plan_layout: there is not enough ${missing.map((b) => `${b} (${found![b]} of ${amount[b]})`).join(' or ')} within 96 blocks of this site, and ${designs.map((d) => `"${d}"`).join(', ')} ${designs.length > 1 ? 'need' : 'needs'} it; draw ${designs.length > 1 ? 'replacements' : 'a replacement'} without ${missing.join(' or ')} (planks, logs and cobblestone are found almost everywhere) under a new name, then call plan_layout with ${designs.length > 1 ? 'them' : 'it'}`;
      }
    }
    // The plot must fit on the ground find_site found (prepare_site levels its margin anyway; asking for the margin too
    // sent a mayor round in circles) and within 32x32 for rows (a street plan takes up to 40, below). Normal streets first, then narrow ones;
    // if the buildings still do not fit, the largest set that does (most buildings, then most floor area) goes on this
    // site now, so workers can start, and the rest wait for a second site (Fourfold7's mayor wandered 500 blocks)
    const limit = Math.min(32, Number(site.size ?? 0) || 32);
    // A street plan takes up to 40 (V2.4: prepare_site levels 40x40 in ~2.5-3 min; at 32 a centre and its streets left a
    // house out in four biomes of five, the review of V2.4); rows stay within 32
    const streetLimit = Math.min(40, Number(site.size ?? 0) || 32);
    // Packed by their walls: an overhang's eaves hang over the street, above head height (D.2; Minevale13's cottages
    // and hall with overhangs did not fit a 30x30 site). Streets stay at least 2, so two rings never overlap.
    const ring = (n: string) => (v.designs[n].style?.overhang ? 2 : 0);
    const foot = (n: string) => ({ name: n, width: v.designs[n].width - ring(n), depth: v.designs[n].depth - ring(n) });
    const fit = (list: string[]) => {
      for (const [street, margin] of [[3, 2], [2, 1]]) {
        const l = layoutBuildings(site.x, site.z, list.map(foot), street, margin);
        if (Math.max(l.width, l.depth) <= limit) return l;
      }
      return null;
    };
    const plotSize = (list: string[]) => {
      const l = layoutBuildings(0, 0, list.map(foot), 2, 1);
      return Math.max(l.width, l.depth);
    };
    let street: StreetLayout | null = null;
    if (lib) {
      const items: PlanItem[] = names.filter((n) => n !== centre?.design.name).map((n) => ({
        name: n, width: v.designs[n].width, depth: v.designs[n].depth, ...doorOf(v.designs[n]),
        kind: n === STORAGE_HUT ? 'storage' : n === MINING_HUT ? 'mine' : undefined,
      }));
      const c = centre ? { name: centre.design.name, width: centre.design.width, depth: centre.design.depth, connectors: centre.connectors, paths: centre.paths } : null;
      // A green round the centre on a 40 site (V2.4, the user's choice) when it places every building; else the streets
      const green = c && streetLimit >= 40 ? planGreen(site.x, site.z, 40, c, items) : null;
      let s = green && !green.unplaced.length ? green : planStreets(site.x, site.z, streetLimit, c, items);
      // A centre takes room: when it leaves buildings out, plain crossing streets may place them all (the review of V2.3:
      // savanna's 13x12 centre sent the hall of "two cottages and a hall" to a second site)
      if (s.unplaced.length && c) {
        const cross = planStreets(site.x, site.z, streetLimit, null, items);
        if (cross.unplaced.length < s.unplaced.length) {
          s = cross;
          dropCentre();
        }
      }
      const isHut = (n: string) => n === STORAGE_HUT || n === MINING_HUT;
      const own = items.filter((i) => !isHut(i.name)).length, out = s.unplaced.filter((n) => !isHut(n)).length;
      // Still some left out while rows place them all, or fewer than half of the mayor's buildings placed, or a hut out:
      // rows, without the centre; otherwise the rest wait for a second site
      if (s.unplaced.length && fit(names.filter((n) => n !== centre?.design.name))) dropCentre();
      else if (out * 2 <= own && !s.unplaced.some(isHut)) street = s;
      else dropCentre();
    }
    let placed = names;
    let lay: Layout | null = street ?? fit(names);
    if (street) {
      const left = [...street.unplaced];
      placed = names.filter((n) => { const i = left.indexOf(n); return i < 0 || !left.splice(i, 1).length; });
    }
    if (!lay) {
      let best: { list: string[]; lay: Layout; area: number } | null = null;
      for (let mask = 1; mask < 1 << Math.min(names.length, 12); mask++) {
        const list = names.filter((_, i) => mask & (1 << i));
        if (withHut && !(list.includes(STORAGE_HUT) && list.includes(MINING_HUT))) continue;
        const area = list.reduce((s, n) => s + v.designs[n].width * v.designs[n].depth, 0);
        if (best && (list.length < best.list.length || (list.length === best.list.length && area <= best.area))) continue;
        const l = fit(list);
        if (l) best = { list, lay: l, area };
      }
      // Fewer than half of them: a bigger site is the better answer than a scattered village
      if (!best || best.list.length * 2 < names.length) {
        const all = plotSize(names);
        return `plan_layout: the site is only ${limit}x${limit}; ${best ? `only ${best.list.join(', ')} would fit` : 'none of these buildings fits'}, and all ${names.length} need ${all}x${all}${all > 32 ? ' (more than a plot of rows takes: lay out some now and the rest on a second site)' : ''}; run find_site size=${Math.min(all, 32)} (it searches farther out by itself), then plan_layout again`;
      }
      placed = best.list;
      lay = best.lay;
    }
    const plot = lay.plot;
    const why = reg.conflict(v, plot, by);
    if (why) return `plan_layout: the plot at ${areaText(plot)} is not free (${why}); run find_site again for another site`;
    const clash = (v.layouts ?? []).find((l) => overlaps(plot, l, 2));
    if (clash) return `plan_layout: the plot at ${areaText(plot)} overlaps the plot laid out for ${clash.buildings.join(', ')} (${areaText(clash)}); run find_site for a new site (it keeps off laid-out plots), then plan_layout again`;
    const nth = (v.layouts?.length ?? 0) + 1;
    // Materials found nowhere near the last site are looked for again (F96)
    delete v.unavailable;
    const tasks: Array<{ title: string; detail: string; after: Array<string | number>; soft?: boolean; afterClaimed?: boolean; retries?: number }> = [];
    tasks.push({ title: `Prepare the village plot${nth > 1 ? ` ${nth}` : ''}`, detail: `prepare_site x=${lay.x} z=${lay.z} width=${lay.width} depth=${lay.depth} (level ground for ${placed.length} buildings and the streets between them${street ? '; it lays the streets as dirt_path' : ''})`, after: [] });
    // One storage for the village: a later layout waits for the storage task already posted
    const storageTask = v.tasks.find((t) => t.title === 'Set up the village storage' && t.status !== 'failed');
    let storage: string | number | undefined = storageTask && storageTask.status !== 'done' ? storageTask.id : undefined;
    const laid = withHut ? lay.places.find((p) => p.name === STORAGE_HUT) : undefined;
    if (laid) v.storageHut = { x1: laid.x1, z1: laid.z1, x2: laid.x2, z2: laid.z2, spots: hutSpots(laid.x1, laid.z1) };
    // A storage task posted again later (the first failed) goes to the hut laid out before
    const hut = v.storageHut;
    if (economy && !v.storage?.chests.length && !storageTask) {
      storage = tasks.length;
      if (hut) {
        // In the hut's first chest spot, on the prepared plot: the hut is then built around the chest
        const [sx, sz] = [hut.x1 + STORAGE_HUT_STAND[0], hut.z1 + STORAGE_HUT_STAND[1]];
        const [cx, cz] = [hut.x1 + STORAGE_HUT_SPOTS[0][0], hut.z1 + STORAGE_HUT_SPOTS[0][1]];
        // Four chests at once (logs, cobblestone, sand, misc...): deposits later craft more only when a group needs one
        // (S.5: then the village's crafting table into its cell of the hut, from the felled logs when the preparer sets the
        // storage up, storageFromFelled)
        tasks.push({ title: 'Set up the village storage', detail: stationsEarly
          ? `collect block=logs count=10, craft item=chest count=4, move_to x=${sx} y=${site.y + 1} z=${sz}, then deposit item=all (the first deposit puts the chests in the storage hut's chest spots, the first at ${cx} ${cz}; the hut is built around them), then place_station item=crafting_table (the village's table, in its cell of the hut)`
          : `collect block=logs count=10, craft item=chest count=4, move_to x=${sx} y=${site.y + 1} z=${sz}, then deposit item=all: the first deposit puts the chests in the storage hut's chest spots (the first at ${cx} ${cz}), and the hut is built around them`, after: laid ? [0] : [] });
      } else {
        const sx = lay.x, sz = plot.z2 + 4;
        tasks.push({ title: 'Set up the village storage', detail: `collect block=logs count=4, craft item=chest count=1, move_to x=${sx} y=${site.y + 1} z=${sz}, then deposit item=all: the first deposit puts the chest down there as the village storage`, after: [] });
      }
    }
    // The other buildings waited for the storage hut before S.5 (this layout's, or one still being built)
    const hutTask = v.tasks.find((t) => t.title === `Build ${STORAGE_HUT}` && t.status !== 'done' && t.status !== 'failed');
    let hutBuild: string | number | undefined = hutTask?.id;
    // S.5: the houses, the windows, the farm, the lamps and the signs wait for the hut's table and furnace, not for the hut:
    // for the stations task (posted with a new hut below, or one still on the board); with both stations standing for
    // nothing; in a village from before S.5, or with the task over and a station missing, for the hut's build as before
    let stationsTask: string | number | undefined = v.tasks.find((t) => t.title === STATIONS_TASK && (t.status === 'open' || t.status === 'claimed'))?.id;
    const gate = () => stationsTask ?? (STATION_NAMES.every((n) => v.stations?.[n]) ? undefined : hutBuild);
    // The mining hut, turned so its stairs face the nearest edge of the plot (the mine runs out from under the village)
    const mining = withHut ? lay.places.find((p) => p.name === MINING_HUT) : undefined;
    // (in the street plan the hut faces its street, the stairs running out its back: its turn is the plan's)
    const mineTurn = mining ? (street ? (mining.rotate ?? 0) / 90 : miningHutTurn(mining, plot)) : 0;
    if (mining) {
      const top = miningStairs(mining.x1, mining.z1, mineTurn);
      v.mine = { hut: { x1: mining.x1, z1: mining.z1, x2: mining.x2, z2: mining.z2 }, top: { x: top.x, z: top.z }, dir: top.dir, steps: 0, dug: 0, ended: [], got: {} };
    }
    // Each building as build_design lays it (the signs and the farm keep to these)
    const grids = lay.places.map((p) => ({ design: v.designs[p.name], x: p.x, z: p.z, rot: p.name === MINING_HUT ? mineTurn : (p.rotate ?? 0) / 90, noSign: p.name === centre?.design.name }));
    // The wheat field (the user's, 10-08): one a village, a 5x7 field of farmland either side of a water channel, on free
    // ground nearest the storage hut's door; its seeds gathered from grass (soft tasks after the storage) and sown early,
    // while the houses go up (wheat grows only with agents near: ~25-45 min a crop at 1x). Not in cold biomes (the
    // channel freezes) nor deserts (no grass for seeds), nor where the grass near the site is too thin for the seeds
    // (collect breaks ~8 grass a seed; the plot's own grass is cut by prepare_site). Only where the world has the skill
    let farm: FarmSpot | null = null;
    let farmBack: Area | undefined;
    const biome = (v.vanillaBiome ?? site.biome ?? '').toLowerCase();
    if (economy && w.skills.some((t) => t.name === 'tend_farm') && !(v.layouts ?? []).some((l) => l.farm)) {
      // (the mining hut's ground out to the pad's edge: its stairs run under it; rows record none, so from the stairs)
      const m = mining && v.mine ? v.mine : undefined;
      const back = street?.back ?? (m
        ? m.dir[1] < 0 ? { x1: m.hut.x1, x2: m.hut.x2, z1: plot.z1, z2: m.hut.z1 - 1 } : m.dir[1] > 0 ? { x1: m.hut.x1, x2: m.hut.x2, z1: m.hut.z2 + 1, z2: plot.z2 }
          : m.dir[0] > 0 ? { x1: m.hut.x2 + 1, x2: plot.x2, z1: m.hut.z1, z2: m.hut.z2 } : { x1: plot.x1, x2: m.hut.x1 - 1, z1: m.hut.z1, z2: m.hut.z2 }
        : undefined);
      farmBack = back;
      const h = v.storageHut;
      const near = h ? { x: (h.x1 + h.x2) / 2, z: h.z2 + 3 } : undefined;
      farm = /snowy|frozen|ice|grove|peaks|desert|badlands/.test(biome) ? null : placeFarm(grids, plot, { streets: street?.streets, green: street?.green, back, near });
      if (!farm) reg.note(v, `no farm on ${areaText(plot)}: ${/snowy|frozen|ice|grove|peaks|desert|badlands/.test(biome) ? `the ${biome} biome` : 'no free ground for a 5x7 field'}`);
      // (null: no agent to count with, as the material check: the farm goes ahead)
      const grass = farm && w.materialsNear ? w.materialsNear(by, { wheat_seeds: farm.sow.length * 10 }, site.x, site.y, site.z, 96, { x1: plot.x1 - 3, z1: plot.z1 - 3, x2: plot.x2 + 3, z2: plot.z2 + 3 }) : null;
      if (farm && grass?.wheat_seeds !== undefined && grass.wheat_seeds < farm.sow.length * 10) {
        reg.note(v, `no farm: only ${grass.wheat_seeds} grass plants within 96 blocks of the site (${farm.sow.length * 10} wanted for ${farm.sow.length} seeds)`);
        farm = null;
      }
    }
    // Its seed tasks and the planting, posted right after the storage hut's build (claimed in posting order, before the
    // houses' gathering; the waiting mayor gathers seeds first)
    let farmPosted = false;
    const postFarm = () => {
      if (!farm || farmPosted) return;
      farmPosted = true;
      const n = farm.sow.length, parts = Math.ceil(n / 8);
      const seeds: number[] = [];
      for (let i = 0; i < parts; i++) {
        const q = Math.floor(n / parts) + (i < n % parts ? 1 : 0);
        seeds.push(tasks.length);
        // (claimable at once: gathered while the plot is prepared, deposited once the storage holds something, #3)
        tasks.push({ title: `Gather ${q} wheat_seeds for the farm${parts > 1 ? ` (${i + 1}/${parts})` : ''}`, detail: `collect block=wheat_seeds count=${q}, then deposit item=all into the village storage (everything you gathered, not just part of it)`, after: [], soft: true });
      }
      // (no task for the hoe's log: prepare_site's felled trees leave logs in storage, and a gather task "for the farm" is
      // never covered by them; Minevale31's felled a whole tree for one log. tend_farm asks for one when it truly lacks it)
      const g = gate();
      tasks.push({ title: `Plant the farm: ${n} wheat`, detail: `tend_farm layout=${nth} (lay the farm's water, till it with a hoe and sow wheat seeds from the village storage)`, after: [0, ...(storage !== undefined ? [storage] : []), ...(g !== undefined ? [g] : []), ...seeds], soft: true });
    };
    // The street lamps (the user's, 10-06): a post with a torch beside the streets, about every 8 blocks, put up once the
    // storage hut stands (S.4; builders' stand spots and doorways keep clear of them); made from what the storage holds
    // then, gathering posted only if it falls short (as a build's). Soft; the village is complete once they are lit. Only
    // where the world has the skill (not the sandbox). Placed before the buildings are posted: the windows' task makes
    // their torches (S.3)
    const lamps = street && economy && w.skills.some((t) => t.name === 'light_streets') ? placeLamps(street, undefined, undefined, farm ? [farm] : []) : [];
    // The windows billed once (S.3): their sand posted early (gathered while the plot is prepared, as other sand), each
    // building with windows waiting for it as it waited for its own
    const windows = pooled ? w.sharedParts!(lay.places.filter((p) => p.name !== STORAGE_HUT).map((p) => v.designs[p.name]), wood) : null;
    const windowSand: number[] = [];
    if (windows) {
      for (const t of windows.tasks) {
        windowSand.push(tasks.length);
        tasks.push({ ...t, after: [], soft: true });
      }
      const what = [windows.panes ? `${windows.panes} glass_pane` : '', windows.glass ? `${windows.glass} glass` : ''].filter(Boolean).join(' and ');
      reg.note(v, `code pooled the windows: ${what} for ${windows.copies} buildings (${windows.sand} sand; ${windows.separate} billed one by one)`);
      console.log(`[parts] code pooled the windows in ${v.name}: ${what} for ${windows.copies} buildings (${windows.sand} sand; ${windows.separate} billed one by one)`);
    }
    // Its making, posted right after the storage hut's build (before the houses: an idle worker starts the moment the hut
    // stands; the houses' windows wait for it). Not the lamps' torches: off every build's path, they held one of two
    // workers a minute ahead of the houses' gathering (S.3's review, lesson 91); the lamp job makes its own at the hut,
    // its charcoal never stored. Soft; its detail names no design (missingDesigns would hold it)
    // (S.5: once the hut's stations stand, not the hut; the houses with windows wait for it, `partsTask`)
    let partsPosted = !windows;
    let partsTask: number | undefined;
    const postParts = () => {
      if (partsPosted || !windows) return;
      partsPosted = true;
      const calls = [windows.panes ? `make_into_storage item=glass_pane count=${windows.panes}` : '', windows.glass ? `make_into_storage item=glass count=${windows.glass}` : ''].filter(Boolean);
      const g = gate();
      partsTask = tasks.length;
      tasks.push({
        title: `Make ${windows.panes || windows.glass} ${windows.panes ? 'glass_pane' : 'glass'} into storage`,
        detail: `${calls.join(', then ')} (smelted at the storage hut's furnace and crafted at its table, put into storage by name for the windows)`,
        after: [...(g !== undefined ? [g] : []), ...windowSand], soft: true,
      });
    };
    // The hut's stations (S.5), posted after the mine's dig (whose digger places the furnace once it has walked out) and
    // before the storage hut (lesson 91: the hut keeps its place); code closes it as soon as both stand, so it runs only as
    // the fallback (a worker set the storage up, or the stairs gave no stone). Hard: the houses wait for it, and the hut's
    // build closes it whatever its state once it has placed what was missing
    let stationsPosted = !(stationsEarly && laid && !STATION_NAMES.every((n) => v.stations?.[n]));
    const postStations = () => {
      if (stationsPosted) return;
      stationsPosted = true;
      stationsTask = tasks.length;
      tasks.push({
        title: STATIONS_TASK,
        detail: "place_station item=crafting_table, then place_station item=furnace (the storage hut's table and furnace, in their cells before the hut is built: the village crafts and smelts there)",
        after: [...(storage !== undefined ? [storage] : []), ...(dig !== undefined ? [dig] : [])], retries: 4,
      });
    };
    // Cobblestone is gathered in the mine once it is dug (a soft task: without it, outside as before)
    let dig: number | undefined;
    const copies = new Map<string, number>();
    // Copies are numbered across layouts (a second cottage on a second site is "cottage 2")
    const before = new Map(placed.map((n) => [n, v.tasks.filter((t) => /^Build /.test(t.title) && t.detail.startsWith(`build_design "${n}"`)).length]));
    const total = (n: string) => placed.filter((x) => x === n).length + (before.get(n) ?? 0);
    // The mining hut first (wood only), then the storage hut: their gathering and builds are claimed before the others'
    const first = (n: string) => (n === MINING_HUT ? 0 : n === STORAGE_HUT ? 1 : 2);
    const builds: number[] = [];
    let fuelBilled = false;
    // Each building's Build task and label by its centre (its sign task waits for it, S.4)
    const buildOf = new Map<string, { build: number; label: string }>();
    for (const p of [...lay.places].sort((x, y) => first(x.name) - first(y.name))) {
      const k = (copies.get(p.name) ?? before.get(p.name) ?? 0) + 1;
      copies.set(p.name, k);
      const label = total(p.name) > 1 ? `${p.name} ${k}` : p.name;
      // (the stations before the storage hut's gathering when no mine came first; the windows' task before the first other
      // building, which waits for it)
      if (p.name !== MINING_HUT) postStations();
      if (p.name !== MINING_HUT && p.name !== STORAGE_HUT) postParts();
      const gather: number[] = [];
      // (the windows' sand left out of a building's own when billed once, S.3; the storage hut keeps its own; the first
      // building with windows gathers the logs their smelting burns, billed nowhere else: S.3's review)
      const fuel = windows && !fuelBilled && p.name !== STORAGE_HUT && windows.with.includes(v.designs[p.name].name) && windows.logs > 0;
      if (fuel) fuelBilled = true;
      const own = windows && p.name !== STORAGE_HUT ? w.materialTasks!(v.designs[p.name], '{label}', wood, ownStations(p.name), ['glass', 'glass_pane'], fuel ? { 'any:logs': windows.logs } : {}).tasks : materials.get(p.name)?.tasks ?? [];
      for (const t of own) {
        gather.push(tasks.length);
        const stone = dig !== undefined && /^collect block=cobblestone /.test(t.detail);
        // Sand, dirt and the like are gathered while the plot is prepared (two agents idled there, the opportunities
        // analysis #3); logs wait for the storage (the preparer's felled logs cover them), cobblestone for the mine
        // (only what is gathered by hand: sandstone or terracotta would make each gatherer a pickaxe from fresh logs)
        const early = /^collect block=(sand|red_sand|dirt|gravel|clay_ball|wheat_seeds) /.test(t.detail);
        tasks.push({ title: t.title.replace('{label}', label), detail: t.detail, after: [...(storage !== undefined && !early ? [storage] : []), ...(stone ? [dig!] : [])], soft: true });
      }
      const isHut = p.name === STORAGE_HUT, isMine = p.name === MINING_HUT;
      if (isHut) hutBuild = tasks.length;
      const build = tasks.length;
      builds.push(build);
      buildOf.set(`${p.x},${p.z}`, { build, label });
      // (the other buildings wait for the hut's stations, S.5, and those with windows for the windows' task too)
      const g = gate();
      const glazed = windows && p.name !== STORAGE_HUT && windows.with.includes(v.designs[p.name].name);
      tasks.push({
        title: `Build ${label}`,
        detail: `build_design "${p.name}" x=${p.x} z=${p.z}${(isMine ? mineTurn * 90 : p.rotate ?? 0) ? ` rotate=${isMine ? mineTurn * 90 : p.rotate}` : ''} (on the village plot; footprint x ${p.x1}..${p.x2}, z ${p.z1}..${p.z2})${economy ? '; it takes the materials from the village storage and crafts planks, doors and glass from what is there' : ''}${isHut ? '; it is built around the storage chests already standing in it' : ''}`,
        after: [0, ...((isHut || isMine) && storage !== undefined ? [storage] : []), ...gather, ...(!isHut && !isMine && g !== undefined ? [g] : []),
          ...(glazed ? [...windowSand, ...(partsTask !== undefined ? [partsTask] : [])] : [])],
      });
      if (isMine) {
        dig = tasks.length;
        // (S.5: the furnace from the stairs' stone, placed once the deposit has walked the digger out of the mine, lesson
        // 101; optional: a placement that fails leaves it to the stations task and never holds the mine's gathering)
        tasks.push({ title: 'Dig the village mine', detail: `dig_mine max_depth=24, then deposit item=all into the village storage (the stairs from inside the mining hut down to stone; cobblestone is then collected in the mine)${stationsEarly && !stationsPosted ? ', then place_station item=furnace optional=true (the village\'s furnace, from the stairs\' stone, in its cell of the storage hut)' : ''}`, after: [build], soft: true });
        postStations();
      }
      if (isHut) {
        postParts();
        postFarm();
      }
    }
    postParts();
    postFarm();
    // The lamps go up once the storage hut stands (S.4), not after the buildings: they stand outside every building's
    // claim ring and door walkway in every street and green layout (checked offline), so a lamp is in no build's way. They
    // wait for the hut's stations (S.5's gate; before S.5 the hut's build: villageStation needs a record, and without it the
    // lamp job billed a furnace of its own). They do not wait for the windows' task (S.3's review: the lamps sat minutes behind the glass):
    // the job's charcoal waits at the furnace's lock only while the panes are being made. A later layout whose hut stands waits for
    // its plot; with no hut (loose chests), once every build is claimed, as before (the opportunities #4)
    const lampGate = gate();
    const hutGate = v.storageHut ? [...(storage !== undefined ? [storage] : []), ...(lampGate !== undefined ? [lampGate] : [])] : null;
    if (lamps.length)
      tasks.push({ title: `Light the streets: ${lamps.length} lamp posts`, detail: `light_streets layout=${nth} (a post with a torch beside the streets, made from the village storage)`,
        after: [0, ...(hutGate ?? builds)], soft: true, ...(hutGate ? {} : { afterClaimed: true }) });
    // Farm slots (opportunistic farming, 10-08): up to two more 5x7 fields kept free beside the wheat field, for whatever
    // the agents find to farm once the village stands (mcWorld.ts farmChores); after the lamps and off them, so no lamp is
    // lost, a cell from the field and from each other. Nothing is built there until then (not structures: lesson 62)
    const slots: FarmSlot[] = [];
    if (farm) {
      const grow = (a: Area, n: number) => ({ x1: a.x1 - n, z1: a.z1 - n, x2: a.x2 + n, z2: a.z2 + n });
      const near = { x: (farm.x1 + farm.x2) / 2, z: (farm.z1 + farm.z2) / 2 };
      for (let i = 0; i < 2; i++) {
        const avoid = [grow(farm, 1), ...slots.map((q) => grow(q, 1)), ...lamps.map((c) => grow({ x1: c.x, z1: c.z, x2: c.x, z2: c.z }, 1))];
        const s = placeFarm(grids, plot, { streets: street?.streets, green: street?.green, back: farmBack, near, avoid });
        if (!s) break;
        slots.push(s);
      }
      if (slots.length) reg.note(v, `${slots.length} farm slot${slots.length > 1 ? 's' : ''} kept free at ${slots.map((q) => areaText(q)).join(' and ')}`);
    }
    // A name sign beside each building's door (the user's, 10-08: "Library", "House", "Storage"...), on every kind of
    // layout: one task a building, put up once its own build is done (S.4), and once the storage hut's table stands (a sign is a
    // table recipe: the mining hut's, built first, would have made a table of its own, F59). Posted after the lamps (both
    // draw the storage's wood: their logs are reserved, and a job that comes up short posts gathering as a build's). Soft;
    // four tries, put back on the board up to SIGN_TRIES while the sign can still go up (completion waits for each sign
    // until then, or until it is found unable to go up there, then goes without it)
    const signs = economy && w.skills.some((t) => t.name === 'put_up_signs')
      ? placeSigns(grids, lamps, lay.plot).filter((s): s is SignSpot => !!s)
      : [];
    for (const s of signs) {
      const b = buildOf.get(`${s.cx},${s.cz}`);
      if (!b) continue;
      const g = gate();
      tasks.push({ title: `Put up the sign: ${b.label}`, detail: `${signCall(nth, s)} (the ${b.label}'s name sign beside its door, made from the village storage)`,
        after: [0, b.build, ...(g !== undefined && g !== b.build ? [g] : [])], soft: true, retries: 4 });
    }
    if (wood && !v.wood) {
      v.wood = wood;
      reg.note(v, `the village gathers and builds in ${wood} (the commonest wood near its site)`);
    }
    const made = reg.post(v, tasks, by, 100);
    // The storage task posted again (the first failed): everything still waiting for the failed one (the hut build,
    // the first plot's gathering) waits for this one
    if (typeof storage === 'number') {
      const failed = new Set(v.tasks.filter((t) => t.title === 'Set up the village storage' && t.status === 'failed').map((t) => t.id));
      for (const t of v.tasks)
        if (t.status === 'open' && t.after.some((id) => failed.has(id))) t.after = t.after.map((id) => (failed.has(id) ? made[storage as number].id : id));
    }
    // What is left for a later site: the first layout's leftovers, or what a later one could not place either
    const left = [...(v.unplaced?.length ? v.unplaced : names)];
    for (const n of placed) left.splice(left.indexOf(n), 1);
    v.layouts = [...(v.layouts ?? []), { ...plot, buildings: placed, ...(street ? { streets: street.streets } : {}), ...(street?.green ? { green: street.green } : {}), ...(lamps.length ? { lamps } : {}), ...(signs.length ? { signs } : {}), ...(farm ? { farm } : {}), ...(slots.length ? { slots } : {}) }];
    v.unplaced = left;
    reg.note(v, `${by} laid out ${placed.join(', ')} on a ${lay.width}x${lay.depth} plot at ${areaText(plot)}${street?.green ? ' round a green' : street ? ' along streets' : ''}${left.length ? `; no room for ${left.join(', ')}` : ''}`);
    reg.save();
    const them = left.length > 1 ? 'them' : 'it';
    const rest = left.length
      ? ` Not laid out, no room on this ${street ? streetLimit : limit}x${street ? streetLimit : limit} site: ${left.join(', ')}. Find a second site for ${them}: find_site size=${plotSize(left)} (it keeps off this plot), then plan_layout with ${left.map((n) => `"${n}"`).join(', ')}. The workers start on this plot meanwhile.`
      : ' Now wait for the workers.';
    return `Laid out ${placed.length} buildings on a ${lay.width}x${lay.depth} plot at ${areaText(plot)} (${lay.places.map((p) => `${p.name} at ${p.x},${p.z}`).join('; ')}) and posted ${made.length} tasks: ${made.map((t) => `${t.id} ${t.title}`).join('; ')}.${rest}`;
}

/**
 * plan_layout: lay a village's buildings out on one plot and post every task they need. Code does the geometry and the
 * materials; the mayor (tieredBrain) only names the buildings. Also used by the API (tests start a village at a stage).
 */
import { HOUSE_UNITS } from './designs';
import type { WorldAdapter } from './world';
import { areaText, layoutBuildings, overlaps, type Layout, type Village } from './village';
import { doorOf, planGreen, planStreets, type PlanItem, type StreetLayout } from './streetPlan';
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
 * buildings wait for the hut (their gathering does not). Returns what happened, or why not ("plan_layout: ..."), for
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
    let wood = v.wood;
    if (!wood && economy && site.wood) {
      const logs = names.filter((n) => n !== centre?.design.name).reduce((s, n) => s + (w.materialTasks!(v.designs[n], n).logs ?? 0), 0);
      if ((site.woodLogs ?? 0) >= logs * 1.5) wood = site.wood;
    }
    if (economy)
      for (const n of new Set(names)) {
        const m = w.materialTasks!(v.designs[n], '{label}', wood);
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
    const tasks: Array<{ title: string; detail: string; after: Array<string | number>; soft?: boolean }> = [];
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
        tasks.push({ title: 'Set up the village storage', detail: `collect block=logs count=10, craft item=chest count=4, move_to x=${sx} y=${site.y + 1} z=${sz}, then deposit item=all: the first deposit puts the chests in the storage hut's chest spots (the first at ${cx} ${cz}), and the hut is built around them`, after: laid ? [0] : [] });
      } else {
        const sx = lay.x, sz = plot.z2 + 4;
        tasks.push({ title: 'Set up the village storage', detail: `collect block=logs count=4, craft item=chest count=1, move_to x=${sx} y=${site.y + 1} z=${sz}, then deposit item=all: the first deposit puts the chest down there as the village storage`, after: [] });
      }
    }
    // The other buildings wait for the storage hut (this layout's, or one still being built)
    const hutTask = v.tasks.find((t) => t.title === `Build ${STORAGE_HUT}` && t.status !== 'done' && t.status !== 'failed');
    let hutBuild: string | number | undefined = hutTask?.id;
    // The mining hut, turned so its stairs face the nearest edge of the plot (the mine runs out from under the village)
    const mining = withHut ? lay.places.find((p) => p.name === MINING_HUT) : undefined;
    // (in the street plan the hut faces its street, the stairs running out its back: its turn is the plan's)
    const mineTurn = mining ? (street ? (mining.rotate ?? 0) / 90 : miningHutTurn(mining, plot)) : 0;
    if (mining) {
      const top = miningStairs(mining.x1, mining.z1, mineTurn);
      v.mine = { hut: { x1: mining.x1, z1: mining.z1, x2: mining.x2, z2: mining.z2 }, top: { x: top.x, z: top.z }, dir: top.dir, steps: 0, dug: 0, ended: [], got: {} };
    }
    // Cobblestone is gathered in the mine once it is dug (a soft task: without it, outside as before)
    let dig: number | undefined;
    const copies = new Map<string, number>();
    // Copies are numbered across layouts (a second cottage on a second site is "cottage 2")
    const before = new Map(placed.map((n) => [n, v.tasks.filter((t) => /^Build /.test(t.title) && t.detail.startsWith(`build_design "${n}"`)).length]));
    const total = (n: string) => placed.filter((x) => x === n).length + (before.get(n) ?? 0);
    // The mining hut first (wood only), then the storage hut: their gathering and builds are claimed before the others'
    const first = (n: string) => (n === MINING_HUT ? 0 : n === STORAGE_HUT ? 1 : 2);
    for (const p of [...lay.places].sort((x, y) => first(x.name) - first(y.name))) {
      const k = (copies.get(p.name) ?? before.get(p.name) ?? 0) + 1;
      copies.set(p.name, k);
      const label = total(p.name) > 1 ? `${p.name} ${k}` : p.name;
      const gather: number[] = [];
      for (const t of materials.get(p.name)?.tasks ?? []) {
        gather.push(tasks.length);
        const stone = dig !== undefined && /^collect block=cobblestone /.test(t.detail);
        tasks.push({ title: t.title.replace('{label}', label), detail: t.detail, after: [...(storage !== undefined ? [storage] : []), ...(stone ? [dig!] : [])], soft: true });
      }
      const isHut = p.name === STORAGE_HUT, isMine = p.name === MINING_HUT;
      if (isHut) hutBuild = tasks.length;
      const build = tasks.length;
      tasks.push({
        title: `Build ${label}`,
        detail: `build_design "${p.name}" x=${p.x} z=${p.z}${(isMine ? mineTurn * 90 : p.rotate ?? 0) ? ` rotate=${isMine ? mineTurn * 90 : p.rotate}` : ''} (on the village plot; footprint x ${p.x1}..${p.x2}, z ${p.z1}..${p.z2})${economy ? '; it takes the materials from the village storage and crafts planks, doors and glass from what is there' : ''}${isHut ? '; it is built around the storage chests already standing in it' : ''}`,
        after: [0, ...((isHut || isMine) && storage !== undefined ? [storage] : []), ...gather, ...(!isHut && !isMine && hutBuild !== undefined ? [hutBuild] : [])],
      });
      if (isMine) {
        dig = tasks.length;
        tasks.push({ title: 'Dig the village mine', detail: 'dig_mine max_depth=24, then deposit item=all into the village storage (the stairs from inside the mining hut down to stone; cobblestone is then collected in the mine)', after: [build], soft: true });
      }
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
    v.layouts = [...(v.layouts ?? []), { ...plot, buildings: placed, ...(street ? { streets: street.streets } : {}), ...(street?.green ? { green: street.green } : {}) }];
    v.unplaced = left;
    reg.note(v, `${by} laid out ${placed.join(', ')} on a ${lay.width}x${lay.depth} plot at ${areaText(plot)}${street?.green ? ' round a green' : street ? ' along streets' : ''}${left.length ? `; no room for ${left.join(', ')}` : ''}`);
    reg.save();
    const them = left.length > 1 ? 'them' : 'it';
    const rest = left.length
      ? ` Not laid out, no room on this ${street ? streetLimit : limit}x${street ? streetLimit : limit} site: ${left.join(', ')}. Find a second site for ${them}: find_site size=${plotSize(left)} (it keeps off this plot), then plan_layout with ${left.map((n) => `"${n}"`).join(', ')}. The workers start on this plot meanwhile.`
      : ' Now wait for the workers.';
    return `Laid out ${placed.length} buildings on a ${lay.width}x${lay.depth} plot at ${areaText(plot)} (${lay.places.map((p) => `${p.name} at ${p.x},${p.z}`).join('; ')}) and posted ${made.length} tasks: ${made.map((t) => `${t.id} ${t.title}`).join('; ')}.${rest}`;
}

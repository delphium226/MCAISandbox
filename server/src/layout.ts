/**
 * plan_layout: lay a village's buildings out on one plot and post every task they need. Code does the geometry and the
 * materials; the mayor (tieredBrain) only names the buildings. Also used by the API (tests start a village at a stage).
 */
import type { WorldAdapter } from './world';
import { areaText, layoutBuildings, overlaps, type Layout, type Village } from './village';

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
}

/**
 * Place the buildings (design names, one per building, or {design, count}) on one plot around the site and post, in
 * order: prepare the plot, set up the storage and gather materials (the survival economy, when `economy`), then each
 * building at its computed position. Returns what happened, or why not ("plan_layout: ..."), for the poster's events.
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
      if (n) for (let i = 0; i < count; i++) names.push(n);
    }
    if (!names.length) return 'plan_layout needs buildings: a list of design names, one per building (repeat a name for each copy)';
    const missing = [...new Set(names.filter((n) => !v.designs[n]))];
    if (missing.length) return `plan_layout: no design yet for ${missing.map((n) => `"${n}"`).join(', ')}; draw ${missing.length > 1 ? 'them' : 'it'} with design_building first, then call plan_layout again`;
    if (!site) return 'plan_layout: no site yet; run find_site first (size 30 for three or four small buildings)';
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
    const materials = new Map<string, ReturnType<NonNullable<WorldAdapter['materialTasks']>>>();
    // One wood kind for the whole village, chosen at its first layout, when there is enough of it near the site for
    // these buildings with a margin (acacia chosen from 42 logs for ~80 needed sent gatherers 80 blocks away); otherwise
    // any kind is gathered and builders mix kinds part by part
    let wood = v.wood;
    if (!wood && economy && site.wood) {
      const logs = names.reduce((s, n) => s + (w.materialTasks!(v.designs[n], n).logs ?? 0), 0);
      if ((site.woodLogs ?? 0) >= logs * 1.5) wood = site.wood;
    }
    if (economy)
      for (const n of new Set(names)) {
        const m = w.materialTasks!(v.designs[n], '{label}', wood);
        if (m.problems.length) return `plan_layout: the "${n}" design cannot be built here (${m.problems.join('; ')}); draw a replacement with other materials under a new name, then call plan_layout with it`;
        materials.set(n, m);
      }
    // Every material a design needs gathered must be near the site: a hall drawn in sandstone in a jungle waited for 81
    // sandstone no one could find (Accept3). Sand is let off: without it the windows stay open
    if (economy && w.materialsNear) {
      const want = new Map<string, string[]>();
      for (const [n, m] of materials)
        for (const t of m.tasks) {
          const b = /collect block=(\S+)/.exec(t.detail)?.[1];
          if (b && !/^(red_)?sand$/.test(b)) want.set(b, [...new Set([...(want.get(b) ?? []), n])]);
        }
      const found = want.size ? w.materialsNear(by, [...want.keys()], site.x, site.z, 96) : null;
      const missing = found ? [...want.keys()].filter((b) => found[b] === 0) : [];
      if (missing.length) {
        const designs = [...new Set(missing.flatMap((b) => want.get(b)!))];
        return `plan_layout: there is no ${missing.join(' or ')} within 96 blocks of this site, and ${designs.map((d) => `"${d}"`).join(', ')} ${designs.length > 1 ? 'need' : 'needs'} it; draw ${designs.length > 1 ? 'replacements' : 'a replacement'} without ${missing.join(' or ')} (planks, logs and cobblestone are found almost everywhere) under a new name, then call plan_layout with ${designs.length > 1 ? 'them' : 'it'}`;
      }
    }
    // The plot must fit on the ground find_site found (prepare_site levels its margin anyway; asking for the margin too
    // sent a mayor round in circles) and within the 32x32 prepare_site allows. Normal streets first, then narrow ones;
    // if the buildings still do not fit, the largest set that does (most buildings, then most floor area) goes on this
    // site now, so workers can start, and the rest wait for a second site (Fourfold7's mayor wandered 500 blocks)
    const limit = Math.min(32, Number(site.size ?? 0) || 32);
    const foot = (n: string) => ({ name: n, width: v.designs[n].width, depth: v.designs[n].depth });
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
    let placed = names;
    let lay = fit(names);
    if (!lay) {
      let best: { list: string[]; lay: Layout; area: number } | null = null;
      for (let mask = 1; mask < 1 << Math.min(names.length, 12); mask++) {
        const list = names.filter((_, i) => mask & (1 << i));
        const area = list.reduce((s, n) => s + v.designs[n].width * v.designs[n].depth, 0);
        if (best && (list.length < best.list.length || (list.length === best.list.length && area <= best.area))) continue;
        const l = fit(list);
        if (l) best = { list, lay: l, area };
      }
      // Fewer than half of them: a bigger site is the better answer than a scattered village
      if (!best || best.list.length * 2 < names.length) {
        const all = plotSize(names);
        return `plan_layout: the site is only ${limit}x${limit}; ${best ? `only ${best.list.join(', ')} would fit` : 'none of these buildings fits'}, and all ${names.length} need ${all}x${all}${all > 32 ? ' (more than prepare_site allows: lay out some now and the rest on a second site)' : ''}; run find_site size=${Math.min(all, 32)} (it searches farther out by itself), then plan_layout again`;
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
    const tasks: Array<{ title: string; detail: string; after: Array<string | number>; soft?: boolean }> = [];
    tasks.push({ title: `Prepare the village plot${nth > 1 ? ` ${nth}` : ''}`, detail: `prepare_site x=${lay.x} z=${lay.z} width=${lay.width} depth=${lay.depth} (level ground for ${placed.length} buildings and the streets between them)`, after: [] });
    // One storage for the village: a later layout waits for the storage task already posted
    const storageTask = v.tasks.find((t) => t.title === 'Set up the village storage' && t.status !== 'failed');
    let storage: string | number | undefined = storageTask && storageTask.status !== 'done' ? storageTask.id : undefined;
    if (economy && !v.storage?.chests.length && !storageTask) {
      storage = tasks.length;
      const sx = lay.x, sz = plot.z2 + 4;
      tasks.push({ title: 'Set up the village storage', detail: `collect block=logs count=4, craft item=chest count=1, move_to x=${sx} y=${site.y + 1} z=${sz}, then deposit item=all: the first deposit puts the chest down there as the village storage`, after: [] });
    }
    const copies = new Map<string, number>();
    // Copies are numbered across layouts (a second cottage on a second site is "cottage 2")
    const before = new Map(placed.map((n) => [n, v.tasks.filter((t) => /^Build /.test(t.title) && t.detail.startsWith(`build_design "${n}"`)).length]));
    const total = (n: string) => placed.filter((x) => x === n).length + (before.get(n) ?? 0);
    for (const p of lay.places) {
      const k = (copies.get(p.name) ?? before.get(p.name) ?? 0) + 1;
      copies.set(p.name, k);
      const label = total(p.name) > 1 ? `${p.name} ${k}` : p.name;
      const gather: number[] = [];
      for (const t of materials.get(p.name)?.tasks ?? []) {
        gather.push(tasks.length);
        tasks.push({ title: t.title.replace('{label}', label), detail: t.detail, after: storage !== undefined ? [storage] : [], soft: true });
      }
      tasks.push({
        title: `Build ${label}`,
        detail: `build_design "${p.name}" x=${p.x} z=${p.z} (on the village plot; footprint x ${p.x1}..${p.x2}, z ${p.z1}..${p.z2})${economy ? '; it takes the materials from the village storage and crafts planks, doors and glass from what is there' : ''}`,
        after: [0, ...gather],
      });
    }
    if (wood && !v.wood) {
      v.wood = wood;
      reg.note(v, `the village gathers and builds in ${wood} (the commonest wood near its site)`);
    }
    const made = reg.post(v, tasks, by, 100);
    // What is left for a later site: the first layout's leftovers, or what a later one could not place either
    const left = [...(v.unplaced?.length ? v.unplaced : names)];
    for (const n of placed) left.splice(left.indexOf(n), 1);
    v.layouts = [...(v.layouts ?? []), { ...plot, buildings: placed }];
    v.unplaced = left;
    reg.note(v, `${by} laid out ${placed.join(', ')} on a ${lay.width}x${lay.depth} plot at ${areaText(plot)}${left.length ? `; no room for ${left.join(', ')}` : ''}`);
    reg.save();
    const them = left.length > 1 ? 'them' : 'it';
    const rest = left.length
      ? ` Not laid out, no room on this ${limit}x${limit} site: ${left.join(', ')}. Find a second site for ${them}: find_site size=${plotSize(left)} (it keeps off this plot), then plan_layout with ${left.map((n) => `"${n}"`).join(', ')}. The workers start on this plot meanwhile.`
      : ' Now wait for the workers.';
    return `Laid out ${placed.length} buildings on a ${lay.width}x${lay.depth} plot at ${areaText(plot)} (${lay.places.map((p) => `${p.name} at ${p.x},${p.z}`).join('; ')}) and posted ${made.length} tasks: ${made.map((t) => `${t.id} ${t.title}`).join('; ')}.${rest}`;
}

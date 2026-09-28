/**
 * plan_layout: lay a village's buildings out on one plot and post every task they need. Code does the geometry and the
 * materials; the mayor (tieredBrain) only names the buildings. Also used by the API (tests start a village at a stage).
 */
import type { WorldAdapter } from './world';
import { layoutBuildings, type Village } from './village';

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
    if (laidOut.length) return `plan_layout: the buildings are already on the task board (${laidOut.map((t) => t.id).join(', ')}); wait for them, or re-post a failed task with post_tasks`;
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
    const lay = layoutBuildings(site.x, site.z, names.map((n) => ({ name: n, width: v.designs[n].width, depth: v.designs[n].depth })));
    if (lay.width > 32 || lay.depth > 32) return `plan_layout: ${names.length} buildings need a ${lay.width}x${lay.depth} plot, more than the 32x32 prepare_site allows; lay out fewer buildings now and the rest on a second site later`;
    // The site search must have looked at ground at least as big as the plot (prepare_site levels its margin anyway;
    // asking for the margin too sent a mayor round in circles when find_site's best nearby was just big enough)
    const need = Math.max(lay.width, lay.depth);
    const siteSize = Number(site.size ?? 0);
    if (siteSize && siteSize < need) return `plan_layout: these buildings need a ${lay.width}x${lay.depth} plot, but find_site looked for only ${siteSize}x${siteSize}; run find_site size=${need}, then call plan_layout again`;
    const why = reg.conflict(v, lay.plot, by);
    if (why) return `plan_layout: the plot at x ${lay.plot.x1}..${lay.plot.x2}, z ${lay.plot.z1}..${lay.plot.z2} is not free (${why}); run find_site again for another site`;
    const tasks: Array<{ title: string; detail: string; after: Array<string | number>; soft?: boolean }> = [];
    tasks.push({ title: 'Prepare the village plot', detail: `prepare_site x=${lay.x} z=${lay.z} width=${lay.width} depth=${lay.depth} (level ground for ${names.length} buildings and the streets between them)`, after: [] });
    let storage: number | undefined;
    if (economy && !v.storage?.chests.length) {
      storage = tasks.length;
      const sx = lay.x, sz = lay.plot.z2 + 4;
      tasks.push({ title: 'Set up the village storage', detail: `collect block=logs count=4, craft item=chest count=1, move_to x=${sx} y=${site.y + 1} z=${sz}, then deposit item=all: the first deposit puts the chest down there as the village storage`, after: [] });
    }
    const copies = new Map<string, number>();
    const total = (n: string) => names.filter((x) => x === n).length;
    for (const p of lay.places) {
      const k = (copies.get(p.name) ?? 0) + 1;
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
    reg.note(v, `${by} laid out ${names.join(', ')} on a ${lay.width}x${lay.depth} plot at x ${lay.plot.x1}..${lay.plot.x2}, z ${lay.plot.z1}..${lay.plot.z2}`);
    return `Laid out ${names.length} buildings on a ${lay.width}x${lay.depth} plot at x ${lay.plot.x1}..${lay.plot.x2}, z ${lay.plot.z1}..${lay.plot.z2} (${lay.places.map((p) => `${p.name} at ${p.x},${p.z}`).join('; ')}) and posted ${made.length} tasks: ${made.map((t) => `${t.id} ${t.title}`).join('; ')}. Now wait for the workers.`;
}

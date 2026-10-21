/**
 * The village's whole tech tree for the panel (the user's request after #80): every good it has made (its `tech` record),
 * the workshop's and food goods, and the innovation library's entries and goods, linked by the recipes a plan would use
 * (Materials' choice: crafted or smelted, wood kinds merged into "planks" and "logs"), down to raw materials. Each node has
 * a state: raw, made (in the record), known (makeable, never made), locked (an entry's good before its unlock), and for
 * library entries unlocked, researching (points in it) or locked; its depth is its longest recipe path from a raw material.
 * Reading only (the record is not touched: techOf would add the innovation record). World-free: the recipes come in.
 */
import { FOOD_GOODS, MAKE_GOODS } from './mineflayer/mcWorkshop';
import { LIBRARY } from './tech';
import type { Village } from './village';

type Counts = Record<string, number>;

export type TreeState = 'raw' | 'made' | 'known' | 'locked' | 'unlocked' | 'researching';
export interface TreeNode { id: string; label: string; kind: 'raw' | 'good' | 'invention'; state: TreeState; depth: number; how?: 'craft' | 'smelt' | 'carve' }
export interface TechTree { nodes: TreeNode[]; edges: Array<[string, string]> }

/** A plan's recipe for an item (Materials.recipe), null when gathered. */
export type RecipeOf = (item: string) => { kind: 'craft' | 'smelt'; ins: Counts } | null;

/** Wood kinds merged: "any:planks" and every *_planks are "planks", logs alike. */
const norm = (n: string) => (n === 'any:planks' || /_planks$/.test(n) ? 'planks' : n === 'any:logs' || /^(?!stripped_).*_(log|stem)$/.test(n) ? 'logs' : n === 'any:cobblestone' ? 'cobblestone' : n);
const words = (n: string) => n.replace(/_/g, ' ');
/** Deepest recipe path followed (a guard: recipe data has no cycles a plan picks, but a node must not recurse forever). */
const MAX_DEPTH = 12;

export function techTree(v: Village, recipeOf: RecipeOf): TechTree {
  const inno = (v as { innovation?: { unlocked?: string[]; points?: Record<string, Record<string, number>>; pledgePts?: Record<string, number> } }).innovation;
  const unlocked = new Set(inno?.unlocked ?? []);
  const made = new Set(Object.keys(v.tech ?? {}).map(norm));
  const entryOf = new Map<string, string>();
  for (const e of LIBRARY) for (const g of e.goods) entryOf.set(g.item, e.id);
  const nodes = new Map<string, TreeNode>();
  const edges = new Set<string>();
  const ins = new Map<string, string[]>();
  const add = (item: string, depth = 0) => {
    const id = norm(item);
    if (nodes.has(id) || depth > MAX_DEPTH) return id;
    const lib = entryOf.get(id);
    const good = LIBRARY.flatMap((e) => e.goods).find((g) => g.item === id);
    // (a carved good has no recipe in the data: its inputs, and the tool it takes from storage)
    const r = good?.carve ? { kind: 'carve' as const, ins: { ...(good.allow ?? []).reduce((c: Counts, n) => ((c[n] = 1), c), {}), shears: 1 } } : id === 'planks' ? { kind: 'craft' as const, ins: { logs: 1 } } : recipeOf(id);
    const node: TreeNode = { id, label: words(id), kind: r ? 'good' : 'raw', state: !r ? 'raw' : made.has(id) ? 'made' : lib && !unlocked.has(lib) ? 'locked' : 'known', depth: 0, ...(r ? { how: r.kind } : {}) };
    nodes.set(id, node);
    if (r) {
      const from = [...new Set(Object.keys(r.ins).map(norm))].filter((n) => n !== id);
      ins.set(id, from);
      for (const n of from) {
        add(n, depth + 1);
        edges.add(`${n}>${id}`);
      }
    }
    return id;
  };
  for (const n of [...Object.keys(v.tech ?? {}), ...MAKE_GOODS.map((g) => g.item), ...FOOD_GOODS.map((g) => g.item), ...LIBRARY.flatMap((e) => e.goods.map((g) => g.item))]) add(n);
  // (the library's entries: their prerequisites, entries and tools, lead in; their goods lead out)
  for (const e of LIBRARY) {
    const id = `entry:${e.id}`;
    const pts = Object.values(inno?.points?.[e.id] ?? {}).reduce((s, q) => s + q, 0) + (inno?.pledgePts?.[e.id] ?? 0);
    nodes.set(id, { id, label: e.name, kind: 'invention', state: unlocked.has(e.id) ? 'unlocked' : pts > 0 ? 'researching' : 'locked', depth: 0 });
    // (and what the village must hold to try it: wheat for hay, torches and raw iron for lanterns)
    const from = [...new Set([...(e.after ?? []).map((a) => `entry:${a}`), ...(e.tools ?? []).map((t) => add(t)), ...Object.keys(e.requires).filter((n) => !entryOf.has(n) || unlocked.has(entryOf.get(n)!)).map((n) => add(n))])];
    ins.set(id, from);
    for (const f of from) edges.add(`${f}>${id}`);
    for (const g of e.goods) {
      edges.add(`${id}>${g.item}`);
      ins.set(g.item, [...(ins.get(g.item) ?? []), id]);
    }
  }
  // (depth: the longest path from a raw material)
  const memo = new Map<string, number>();
  const depth = (id: string, path: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (path.has(id)) return 0;
    path.add(id);
    const d = Math.max(-1, ...(ins.get(id) ?? []).filter((n) => nodes.has(n)).map((n) => depth(n, path))) + 1;
    path.delete(id);
    memo.set(id, d);
    return d;
  };
  for (const n of nodes.values()) n.depth = depth(n.id, new Set());
  return { nodes: [...nodes.values()], edges: [...edges].map((e) => e.split('>') as [string, string]).filter(([a, b]) => nodes.has(a) && nodes.has(b)) };
}

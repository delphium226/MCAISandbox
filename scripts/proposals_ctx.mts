/**
 * G5: what a village can do, offline (proposals.ts' CheckCtx), for scripts/proposals_draft.mts, scripts/triage_proposals.mts
 * and scripts/checks/proposals_unit.mts: the game's items and recipe graph, the skills, the library's activities and what
 * they give, the workshop's catalogue (keeps, food and the reserve from the recipes, in the village's wood), and the
 * innovation entries' goods. As the world builds them, without a world.
 */
import minecraftData from 'minecraft-data';
import type { CheckCtx } from '../server/src/proposals';

const { Materials } = await import('../server/src/mineflayer/mcMaterials');
const { MC_SKILLS } = await import('../server/src/mineflayer/mcSkills');
const { FOUNDRY_SKILLS } = await import('../server/src/mineflayer/foundry/list');
const { loadLibrary } = await import('../server/src/library');
const { buildCatalog } = await import('../server/src/activities');
const { MAKE_GOODS, FOOD_GOODS } = await import('../server/src/mineflayer/mcWorkshop');
const { LIBRARY } = await import('../server/src/tech');
const { CAPABILITIES, statusOf } = await import('../server/src/wanted');
const { SELLS } = await import('../server/src/merchant');

export async function offlineCtx(wood = 'birch'): Promise<CheckCtx & { caps: Array<{ id: string; name: string; status: string; reason?: string }> }> {
  const reg = minecraftData('26.1');
  const m = new Materials(reg);
  const lib = loadLibrary(reg, new Set(FOUNDRY_SKILLS.filter((f) => f.activity).map((f) => f.name)));
  const activityGives = new Map<string, string>();
  for (const s of lib.specs) for (const g of s.gives) if (!activityGives.has(g.item)) activityGives.set(g.item, s.name);
  const makeItems = new Map<string, string>();
  const cat = buildCatalog(reg, m, { wood, decorDemand: {}, keep: MAKE_GOODS, food: FOOD_GOODS });
  for (const sp of cat.specs) if (sp.good && !makeItems.has(sp.good.item)) makeItems.set(sp.good.item, sp.good.words);
  const inventionItems = new Map<string, string>();
  for (const e of LIBRARY) for (const g of e.goods) if (!inventionItems.has(g.item)) inventionItems.set(g.item, e.name);
  const ctx: CheckCtx = {
    items: new Set(reg.itemsArray.map((it) => it.name)),
    plan: (b) => m.plan(b),
    skills: new Set([...Object.keys(MC_SKILLS), ...FOUNDRY_SKILLS.map((f) => f.name)]),
    // (and every foundry activity: a locked one runs once researched, wanted.ts' statusOf tells it apart)
    activitySkills: new Set([...lib.specs.map((s) => s.skill), ...FOUNDRY_SKILLS.filter((f) => f.activity).map((f) => f.name)]),
    activityGives, makeItems, inventionItems, merchantSells: new Set(SELLS.map((o) => o.item)),
  };
  const caps = CAPABILITIES.map((c) => ({ id: c.id, name: c.name, ...statusOf(c, ctx) }));
  return { ...ctx, caps };
}

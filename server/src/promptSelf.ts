/**
 * #117 (MC_PROMPT_SELF=on, off by default; spec runs/2026-10-24/prompt-117/spec.md): what a member's choice prompt says
 * about the member itself, beside the village. Its own state (its house and what the house lacks, what it carries, its
 * emeralds, its appetite), its basic needs in Maslow's order (the user's: food, a house, a bed, a chest), what is short
 * and what is made for nothing yet, and why nothing on its menu feeds the ambition when nothing does. The goal's
 * meaning is goals.ts' GOAL_MEANING; the pins and tags are choose.ts'. World-free: the world (mcWorld.ts) gathers the
 * facts and calls these; scripts/checks/prompt_self.mts checks them.
 */
type Counts = Record<string, number>;

export const PROMPT_SELF = /^(on|1|true|yes)$/i.test(process.env.MC_PROMPT_SELF ?? '');

/** The member's own house as the prompt names it: none, one under construction, or one standing with what it has and lacks. */
export type HouseFacts = { state: 'none' } | { state: 'building' } | { state: 'standing'; label: string; has: string[]; lacks: string[] };

export interface SelfFacts {
  house: HouseFacts;
  /** What it carries (hand inventory), item -> count. */
  carry: Counts;
  /** Its emeralds (own chest and hands; MC_OWN), absent without own stock. */
  emeralds?: number;
  /** Its appetite 0..20 (MC_APPETITE), absent without an appetite. */
  appetite?: number;
  /** Not fed (peckish or hungry). */
  hungry?: boolean;
  /** The bed and the chest count as needs only where the world can give them (MC_HOME_BASICS: a bed; MC_OWN or home
   *  basics: a chest). */
  bedPossible: boolean;
  chestPossible: boolean;
}

const words = (s: string) => s.replace(/^minecraft:/, '').replace(/_/g, ' ');
const TOOL = /_(pickaxe|axe|shovel|hoe|sword)$|^(shears|fishing_rod|bucket|flint_and_steel)$/;
const a = (item: string) => (/^[aeiou]/.test(words(item)) ? `an ${words(item)}` : `a ${words(item)}`);

/** What it carries: its tools first (each once, "a stone pickaxe"), then up to 5 other items by count. */
export function carryText(carry: Counts): string {
  const tools = Object.keys(carry).filter((n) => TOOL.test(n) && carry[n] > 0).sort();
  const rest = Object.entries(carry).filter(([n, q]) => !TOOL.test(n) && q > 0).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 5);
  const parts = [...tools.map((n) => (carry[n] > 1 ? `${carry[n]} ${words(n)}` : a(n))), ...rest.map(([n, q]) => `${q} ${words(n)}`)];
  return parts.length ? `you carry ${parts.join(', ')}` : 'you carry nothing of note';
}

/** "You: ..." (one line, at most 300 characters). */
export function selfLine(d: SelfFacts): string {
  const h = d.house;
  const house = h.state === 'none' ? 'no house of your own yet'
    : h.state === 'building' ? 'no house of your own yet (yours is being built)'
      : `your house (${h.label})${h.has.length ? ` has ${h.has.join(' and ')}` : ''}${h.lacks.length ? `${h.has.length ? ',' : ''} no ${h.lacks.join(' and no ')}` : ''}`;
  const parts = [house, carryText(d.carry)];
  if (d.emeralds !== undefined) parts.push(`${d.emeralds} emerald${d.emeralds === 1 ? '' : 's'}`);
  if (d.appetite !== undefined) parts.push(`appetite ${Math.round(d.appetite)} of 20`);
  return `You: ${parts.join('; ')}.`.slice(0, 300);
}

/** The basic needs still unmet, lowest first: food, a house, a bed, a chest (a bed and a chest only in a house). */
export function basicNeeds(d: SelfFacts): Array<'food' | 'house' | 'bed' | 'chest'> {
  const out: Array<'food' | 'house' | 'bed' | 'chest'> = [];
  if (d.hungry) out.push('food');
  if (d.house.state !== 'standing') out.push('house');
  else {
    if (d.bedPossible && d.house.lacks.includes('bed')) out.push('bed');
    if (d.chestPossible && d.house.lacks.includes('chest')) out.push('chest');
  }
  return out;
}

/** "Your basic needs first: you have no house yet (then a bed and a chest in it)." ('' when all are met). */
export function needsLine(d: SelfFacts, needs = basicNeeds(d)): string {
  if (!needs.length) return '';
  const later = [d.bedPossible ? 'a bed' : '', d.chestPossible ? 'a chest' : ''].filter(Boolean);
  const parts = needs.map((n) => (n === 'food' ? 'you are hungry' : n === 'house' ? `you have no house yet${d.house.state === 'building' ? ' (yours is being built)' : ''}${later.length ? ` (then ${later.join(' and ')} in it)` : ''}`
    : n === 'bed' ? 'your house has no bed' : 'your house has no chest'));
  return `Your basic needs first: ${parts.join('; ')}.`;
}

/** The tag of an option meeting a basic need. */
export const basicTag = (need: string) => `[your basic need: ${need}]`;

/** A good made for later that nothing in the village uses yet (its forWhat, mcWorkshop.ts' MAKE_GOODS). */
export const UNUSED_GOOD = /nothing places it yet|\(later\)|comes later\)|windows for later/;
/** The tag on its make option (the bench's V3b: "[nothing uses it yet]" changed nothing; this halved the picks). */
export const UNUSED_TAG = '[not needed now: nothing in the village uses it yet]';

/** "Short: cobblestone (12 stored, the workshop wants 211). Made for later, nothing uses them now: barrels, ladders." */
export function scarcityLine(short: Array<{ item: string; stored: number; wanted: number }>, unused: string[]): string {
  const s = short.filter((x) => x.wanted > x.stored).sort((x, y) => y.wanted - y.stored - (x.wanted - x.stored)).slice(0, 4)
    .map((x) => `${words(x.item)} (${x.stored} stored, the workshop wants ${x.wanted})`);
  const parts = [s.length ? `Short: ${s.join(', ')}.` : '', unused.length ? `Made for later, nothing uses them now: ${unused.slice(0, 6).join(', ')}.` : ''];
  return parts.filter(Boolean).join(' ').slice(0, 400);
}

/** The option kinds a stage's feeds can name (the prefixes of the ids its pattern tests: iron, start, slot, activity...). */
export function feedKinds(feeds: RegExp | undefined): string[] {
  if (!feeds) return [];
  return [...new Set([...feeds.source.matchAll(/(?:^|[(|^])\^?([a-z]+)(?=\\?:|\()/g)].map((m) => m[1]))];
}

/** "Nothing on your menu feeds it now: digging for iron: held back after a failure." */
export function ambitionGap(parts: string[]): string {
  return parts.length ? `Nothing on your menu feeds it now: ${parts.slice(0, 3).join('; ')}.` : 'Nothing on your menu feeds it now.';
}

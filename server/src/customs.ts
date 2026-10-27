/**
 * Customs (#164, spec runs/2026-10-27/i164/spec.md 2.6; G4, #31, #34): repeatable acts with a world effect that code counts,
 * offered to every member from the start (exposure never adds the option, E.7's rule), with no vote, no enforcement and no
 * material reward (the user's Q2, 10-27). They spread only by practice and talk. World-free half: the templates, the reading
 * of a member's norm or sentence as a template, the ledger (did, started, exposed), seeded members kept in the village's
 * social memory, and the option's facts line. The world (the menu option, the blocks, the seed API) calls in here.
 *
 * Settings: MC_CUSTOMS off (default) | on: customs read, logged and seeded. MC_CUSTOM_FACTS off (default) | on: the
 * option's facts line ("done yesterday by Ben, Kai and 2 others; you: never"), the channel the test's off arm removes.
 */
import { clockOf, logAct, touchMemory, villageSocialOf, type Phase } from './memory';
import { rawSetting } from './settings';

const flag = (name: string) => /^(on|1|true|yes)$/i.test(rawSetting(name) ?? '');
export const CUSTOMS = {
  on: flag('MC_CUSTOMS'),
  facts: flag('MC_CUSTOM_FACTS'),
};
/** Test hook. */
export function setCustomsSettings(s: Partial<typeof CUSTOMS>): void {
  Object.assign(CUSTOMS, s);
}

export const CUSTOM_IDS = ['door_flower', 'green_stone', 'tools_dusk', 'dusk_gathering'] as const;
export type CustomId = (typeof CUSTOM_IDS)[number];

export interface CustomTemplate {
  id: CustomId;
  /** The option's words on the menu. */
  name: string;
  /** Its words in a facts or chronicle line ("kept the green's stone"). */
  did: string;
  /** When it is offered: any time of day, or at dusk only (before the ballot). */
  when: 'day' | 'dusk';
  /** Items it may place (the world counts the blocks), none for an act with no block. */
  blocks: string[];
  /** A member's words that name it (a norm, the night's `custom` sentence). */
  words: RegExp;
}

// (no torches: "torches at the houses" is lighting, a duty)
const DECOR = String.raw`(?:flower ?pots?|potted|lanterns?|flowers?|decorat\w*|ornaments?)`;
const COMMUNAL = String.raw`(?:green|square|commons?|communal (?:area|space|spot|place)|public (?:area|space)|village (?:centre|center|stone)|(?:custom|green's|village) stone)`;
export const TEMPLATES: Record<CustomId, CustomTemplate> = {
  door_flower: {
    id: 'door_flower', name: 'Put a flower pot or lantern at your door', did: 'put a flower pot or lantern at their door', when: 'day',
    blocks: ['flower_pot', 'lantern'],
    words: new RegExp(String.raw`\b${DECOR}\b[^.]*\b(?:doors?|doorsteps?|porch(?:es)?|entrances?|houses?|homes?)\b|\b(?:doors?|doorsteps?|porch(?:es)?|entrances?)\b[^.]*\b${DECOR}\b`, 'i'),
  },
  green_stone: {
    id: 'green_stone', name: 'Set a torch or flower on the green\'s custom stone', did: 'kept the green\'s stone', when: 'day',
    blocks: ['torch', 'poppy', 'dandelion', 'cornflower', 'oxeye_daisy', 'azure_bluet', 'allium'],
    words: new RegExp(String.raw`\b${DECOR}\b[^.]*\b${COMMUNAL}\b|\b${COMMUNAL}\b[^.]*\b${DECOR}\b|\baesthetic\b`, 'i'),
  },
  tools_dusk: {
    id: 'tools_dusk', name: 'Return your tools to storage at dusk', did: 'returned their tools at dusk', when: 'dusk', blocks: [],
    words: /\b(?:return|returns|bring back|put back|give back)\b[^.]*\b(?:tools?|pickaxes?|axes?|shovels?|hoes?|buckets?|shears)\b|\b(?:tools?|pickaxes?|axes?)\b[^.]*\b(?:returned|back to (?:the )?storage)\b/i,
  },
  dusk_gathering: {
    id: 'dusk_gathering', name: 'Meet the others at the green at dusk', did: 'met at the green at dusk', when: 'dusk', blocks: [],
    words: /\b(?:gather|gathers|meet|meets|assemble|assembles|congregate)\b[^.]*\b(?:green|square|commons?|dusk|evening|sunset|before the (?:vote|ballot|council))\b/i,
  },
};

/**
 * The custom a member's words name (a norm, the night's `custom` sentence), or null: the templates in a fixed order, the
 * act with the narrowest words first (a decoration "at the door" is the door's, not the green's). Norm classes from train 7
 * and G3m1 (norm_classes.txt): "place at least one decorative item (e.g., flower, lantern) in a communal area" is the
 * green's stone; "return any borrowed tools to storage by dusk" is tools at dusk.
 */
export function customOf(text: string): CustomId | null {
  const s = String(text ?? '');
  for (const id of ['tools_dusk', 'dusk_gathering', 'door_flower', 'green_stone'] as const) if (TEMPLATES[id].words.test(s)) return id;
  return null;
}

/** The night's `custom` sentence read as a template, or code's reason it is none (told to the member). */
export function readCustom(text: unknown): { custom: CustomId } | { refused: string } {
  const s = typeof text === 'string' ? text.trim() : '';
  if (s.length < 8) return { refused: 'a custom needs a sentence' };
  const c = customOf(s);
  return c ? { custom: c } : { refused: `the village can keep only these customs for now: ${CUSTOM_IDS.map((x) => TEMPLATES[x].name.toLowerCase()).join('; ')}` };
}

/** Whether a custom is offered in a phase of the village day (a dusk custom at dusk only). */
export const offered = (id: CustomId, phase: Phase | undefined) => CUSTOMS.on && (TEMPLATES[id].when === 'day' ? phase !== 'night' : phase === 'dusk');

// ---------------------------------------------------------------------------------------------
// The village's state: who did each custom on which day, seeds, exposure (kept in its social memory)
// ---------------------------------------------------------------------------------------------

interface Seed { custom: CustomId; persona: string; at: number }
interface CustomsState {
  /** Members who did a custom, by custom and village day. */
  did: Partial<Record<CustomId, Record<string, string[]>>>;
  /** Seeded members (the experiment's, E.7): their custom and persona line. */
  seeds: Record<string, Seed>;
  /** The last village day a member was shown a custom's facts (`agent|custom`), so exposure is logged once a day. */
  exposed: Record<string, number>;
  /** Customs started from members' words (a norm or the night's field): custom, by whom, from what. */
  started?: Array<{ custom: CustomId; agent: string; from: string; day: number }>;
}

function state(village: string): CustomsState {
  const s = villageSocialOf(village) as { customs?: CustomsState };
  return (s.customs ??= { did: {}, seeds: {}, exposed: {} });
}
const dayOf = (village: string, now: number) => clockOf(village, now)?.day ?? Math.floor(now / (20 * 60000));

/** Seeded members of a village (E.7's seeding: the world's API calls `seed`). */
export const seeds = (village: string): Record<string, Seed> => state(village).seeds;
export const isSeeded = (village: string, agent: string) => !!state(village).seeds[agent];

/** Seeds members with a custom: each gets a persona line (the world puts it in the member's persona) and is marked seeded in
 *  the ledger. Returns the members seeded. */
export function seed(village: string, agents: string[], custom: CustomId, persona: string | undefined, now: number): string[] {
  if (!CUSTOMS.on || !TEMPLATES[custom]) return [];
  const st = state(village);
  const line = (persona ?? '').trim() || `You keep a custom of your own: you ${TEMPLATES[custom].name.toLowerCase()} when you can, and you like others to see it.`;
  for (const a of agents) {
    st.seeds[a] = { custom, persona: line.slice(0, 240), at: now };
    logAct({ type: 'custom', village, agent: a, op: 'seeded', custom, seeded: true, day: dayOf(village, now) });
  }
  touchMemory();
  return agents;
}

/** A seeded member's persona line ('' when not seeded, or with customs off). */
export function seedLine(village: string, agent: string): string {
  return CUSTOMS.on ? state(village).seeds[agent]?.persona ?? '' : '';
}

/** The world did a custom (its blocks placed and checked, or the walk made): into the day's list and the ledger, with
 *  whether it is the member's first time and whether it had been shown the custom's facts before (adoption, E.7). */
export function noteDid(village: string, agent: string, custom: CustomId, now: number, extra: Record<string, unknown> = {}): void {
  if (!CUSTOMS.on) return;
  const st = state(village);
  const day = dayOf(village, now);
  const byDay = (st.did[custom] ??= {});
  const first = !Object.values(byDay).some((ms) => ms.includes(agent));
  const list = (byDay[String(day)] ??= []);
  if (!list.includes(agent)) list.push(agent);
  const seeded = isSeeded(village, agent);
  logAct({ type: 'custom', village, agent, op: 'did', custom, seeded, day, ...(first ? { first: true, afterExposure: st.exposed[`${agent}|${custom}`] !== undefined } : {}), ...extra });
  touchMemory();
}

/** A member's words started a custom (a norm proposed or passed that names one, the night's `custom` field). */
export function noteStarted(village: string, agent: string, custom: CustomId, from: string, now: number): void {
  if (!CUSTOMS.on) return;
  const st = state(village);
  const day = dayOf(village, now);
  (st.started ??= []).push({ custom, agent, from: from.slice(0, 40), day });
  logAct({ type: 'custom', village, agent, op: 'started', custom, seeded: isSeeded(village, agent), from: from.slice(0, 40), day });
  touchMemory();
}

/** A member was shown a custom's facts (its menu prompt): logged once a member, custom and day. */
export function noteExposed(village: string, agent: string, custom: CustomId, now: number, via = 'menu'): void {
  if (!CUSTOMS.on) return;
  const st = state(village);
  const day = dayOf(village, now);
  const k = `${agent}|${custom}`;
  if (st.exposed[k] === day) return;
  st.exposed[k] = day;
  logAct({ type: 'custom', village, agent, op: 'exposed', custom, seeded: isSeeded(village, agent), via, day });
  touchMemory();
}

/** Members who did a custom on a village day. */
export const didOn = (village: string, custom: CustomId, day: number): string[] => state(village).did[custom]?.[String(day)] ?? [];

/**
 * The option's facts line in code's counts (MC_CUSTOM_FACTS): who did it yesterday, two named and the rest counted, and the
 * member's own last time ("done yesterday by Ben, Kai and 2 others; you: never"). No persona or seed text, so the line is
 * the same in every arm. '' with the flag off.
 */
export function customFacts(village: string, agent: string, custom: CustomId, now: number): string {
  if (!CUSTOMS.on || !CUSTOMS.facts) return '';
  const day = dayOf(village, now);
  const y = didOn(village, custom, day - 1).filter((m) => m !== agent);
  const who = !y.length ? 'nobody did it yesterday' : `done yesterday by ${y.length <= 3 ? names(y) : `${y.slice(0, 2).join(', ')} and ${y.length - 2} others`}`;
  const mine = Object.entries(state(village).did[custom] ?? {}).filter(([, ms]) => ms.includes(agent)).map(([d]) => Number(d)).sort((a, b) => b - a)[0];
  const you = mine === undefined ? 'never' : mine === day ? 'today' : mine === day - 1 ? 'yesterday' : `on day ${mine}`;
  return `${who}; you: ${you}`;
}
const names = (ms: string[]) => (ms.length === 1 ? ms[0] : `${ms.slice(0, -1).join(', ')} and ${ms[ms.length - 1]}`);

/** The chronicle's or dawn news' line for a finished day ("8 members kept the green's stone"), one clause a custom done;
 *  '' when none was. */
export function customsDayLine(village: string, day: number): string {
  if (!CUSTOMS.on) return '';
  const parts = CUSTOM_IDS.map((c) => [didOn(village, c, day).length, TEMPLATES[c].did] as const).filter(([n]) => n > 0)
    .map(([n, did]) => `${n} member${n === 1 ? '' : 's'} ${did}`);
  return parts.length ? `Customs on day ${day}: ${parts.join('; ')}.` : '';
}

/**
 * The society's typed places (PLAN E.3-E.7), kept in memory.ts' store (`social` on each member and each village), and G2's
 * awareness (#27, E.3): what members see of each other, kept by code. World-free: the world reports who stood near whom
 * doing what (observe), help given on projects (noteHelp) and members' model choices (noteChoice); the chooser's prompt
 * takes the awareness block (awareness) and, in E.8's condition (e), the member's role. Spec: runs/2026-10-21/g2-social/.
 *
 * Rules the shapes follow (docs/research/memory/long-horizon-memory.md §1, §4): facts are kept by code and carry their
 * source; the model edits only narrow fields (a feeling, a short note); nothing is deleted, only superseded; heard content
 * is stored as "X said ..." and never becomes a fact without code's confirmation.
 *
 * Settings (read once):
 *   MCAI_SOCIAL        legacy (default: today's prompts, the "Others now" line with names) | on (the awareness block:
 *                      counts, nobody-doing, up to 5 profiles, Riedl's sentence) | noblock (the block left out, the legacy
 *                      line kept) | countsonly (the block without profiles) | off (no social perception: no others' line,
 *                      no names, no others' activity in any prompt; E.8's (b2))
 *   MCAI_SOCIAL_ROLES  hide (default) | show: the member's role inferred by code shown back to it (E.8's (e))
 */
import { KIND_WORDS, MEMORY, logAct, membersOf, setScrubber, setVillageLineShown, socialOf, touchMemory } from './memory';
import { NAME_POOL } from './agentNames';
import { noteFact, think } from './character';

const MODES = ['legacy', 'on', 'noblock', 'countsonly', 'off'] as const;
export type SocialMode = (typeof MODES)[number];

const rawMode = (process.env.MCAI_SOCIAL ?? 'legacy').trim().toLowerCase();
export const SOCIAL = {
  mode: ((MODES as readonly string[]).includes(rawMode) ? rawMode : 'legacy') as SocialMode,
  roles: /^show$/i.test(process.env.MCAI_SOCIAL_ROLES ?? ''),
};
if (!(MODES as readonly string[]).includes(rawMode)) console.warn(`[social] MCAI_SOCIAL=${rawMode} is not one of ${MODES.join(', ')}: legacy`);
if (SOCIAL.mode !== 'legacy' && SOCIAL.mode !== 'noblock' && !MEMORY.on) console.warn(`[social] MCAI_SOCIAL=${SOCIAL.mode} without MC_MEMORY=on: profiles are kept but not cleared at a run's start`);

/** Test hook. */
export function setSocialSettings(s: Partial<typeof SOCIAL>): void {
  Object.assign(SOCIAL, s);
}

// (the village's day line names members and counts their work: left out under off)
setVillageLineShown(() => !socialOff());
// (and under off, any other member's name a remembered line carries, a skill's failure message among them: "a member")
setScrubber((village, agent, text) => (socialOff() ? scrubNames(village, agent, text) : text));

/** Other members' names (the village's and the pool's) as "a member"; "the Mayor" is a role word and stays. */
export function scrubNames(village: string, agent: string, text: string): string {
  const names = new Set([...membersOf(village).map((m) => m.name), ...NAME_POOL]);
  names.delete(agent);
  let out = text;
  for (const n of names) {
    if (!out.includes(n)) continue;
    out = n === 'Mayor' ? out.replace(/(?<!\bthe )\bMayor\b/g, 'a member') : out.replace(new RegExp(`\\b${n}\\b`, 'g'), 'a member');
  }
  return out;
}

/** Whether code keeps observations and profiles (the block's profiles, or acts that need them). */
export const observing = () => SOCIAL.mode === 'on' || SOCIAL.mode === 'countsonly' || ACTS_ON();
/** Set by acts.ts (MC_ACTS=on, validated against the mode); a function so social.ts needs no import of acts.ts. */
let ACTS_ON = () => false;
export function setActsOn(fn: () => boolean): void {
  ACTS_ON = fn;
}
/** The awareness block replaces the "Others now" line (on, countsonly). */
export const blockOn = () => SOCIAL.mode === 'on' || SOCIAL.mode === 'countsonly';
/** No social perception at all (E.8's (b2)): names and others' activity are left out of every prompt. */
export const socialOff = () => SOCIAL.mode === 'off';

/** E.3: what a member knows of another, kept by code from what it saw or heard as verified fact; `feel` and `note` are the
 *  model's (edited at night, at most 3 edits a night). */
export interface Profile {
  of: string;
  /** The other's top 2 chore kinds as this member saw them (role-adjacent: logged by the prompt audit). */
  kinds: string[];
  kept: number;
  broke: number;
  helped: number;
  helpedBy: number;
  lastMet: number;
  feel?: -2 | -1 | 0 | 1 | 2;
  note?: string;
  /** G2: the other's chores seen, by kind (each chore once: `lastChore`). */
  seen?: Record<string, number>;
  lastChore?: string;
  /** G2: verified reports heard from others about the other's promises (local reputation, E.5). */
  heardKept?: number;
  heardBroke?: number;
}

/** E.5: a typed promise between two members, closed by code from world evidence. */
export interface Commitment {
  id: string;
  from: string;
  to: string;
  what: { kind: string; item?: string; count?: number; option?: string };
  made: number;
  due: number;
  state: 'open' | 'kept' | 'broken' | 'released' | 'moot';
  closedAt?: number;
  evidence?: string;
}

/** E.6: a lesson the member keeps, with helpful/harmful counters (ACE's deltas), superseded rather than deleted. */
export interface Lesson {
  id: string;
  text: string;
  helpful: number;
  harmful: number;
  t: number;
  supersededBy?: string;
  /** Code records it cites (a log entry's time, a kind). */
  cites?: string[];
}

/** E.7: a cultural item a member has heard or used (a place name, a saying, a belief, a custom). */
export interface Belief {
  item: string;
  kind: 'name' | 'saying' | 'belief' | 'custom';
  heardFrom?: string;
  firstAt: number;
  uses: number;
}

/** A member's social places (AgentMemory.social). */
export interface MemberSocial {
  profiles?: Record<string, Profile>;
  commitments?: Commitment[];
  lessons?: Lesson[];
  beliefs?: Belief[];
  /** G5: proposals this member made and their answers. */
  proposals?: Array<{ id: string; text: string; at: number; answer?: { accepted: boolean; reason: string; at: number } }>;
  /** G2: the kinds of its last 5 model choices (oldest first) and the role they make (the modal kind). */
  recent?: string[];
  role?: { kind: string; since: number };
}

/** E.6: a rule in force, typed, with its parameters in a band code allows. */
export interface Rule {
  id: string;
  type: 'quota' | 'floor' | 'zone' | 'duty' | 'levy' | 'norm';
  params: Record<string, number | string>;
  text: string;
  since: number;
  votedBy?: { yes: number; no: number; abstain: number };
  supersededBy?: string;
}

/** E.7: one entry of the village's chronicle: code's facts, with a model's story beside them citing them. */
export interface ChronicleEntry {
  day: number;
  facts: string[];
  story?: { by: string; text: string };
}

/** A village's social places (VillageMemory.social). */
export interface VillageSocial {
  rules?: Rule[];
  chronicle?: ChronicleEntry[];
  lore?: Array<{ item: string; kind: Belief['kind']; users: number; lastUsed: number }>;
  ballots?: Array<{ day: number; items: string[]; result?: Record<string, { yes: number; no: number }> }>;
}

// ---------------------------------------------------------------------------------------------
// Observations and profiles (code-kept)
// ---------------------------------------------------------------------------------------------

/** Within this many blocks (horizontal) a member sees what another is doing. */
export const SEE = 32;
/** Within this many blocks two members have met. */
export const MEET = 16;
/** Profiles shown in the block. */
export const PROFILES_SHOWN = 5;
/** The block's cap in characters (~300 tokens). */
export const BLOCK_CHARS = 1200;

/** A chore kind as a word: harvests on fields and slots are one kind of work. */
export const kindWord = (k: string) => KIND_WORDS[k] ?? k;

export function memberSocial(village: string, agent: string): MemberSocial {
  return socialOf(village, agent) as MemberSocial;
}

function profileOf(village: string, agent: string, other: string): Profile {
  const s = memberSocial(village, agent);
  const ps = (s.profiles ??= {});
  return (ps[other] ??= { of: other, kinds: [], kept: 0, broke: 0, helped: 0, helpedBy: 0, lastMet: 0 });
}

/** A profile if the member has one. */
export function profile(village: string, agent: string, other: string): Profile | undefined {
  return memberSocial(village, agent).profiles?.[other];
}

const topKinds = (seen: Record<string, number> | undefined) => {
  const by = new Map<string, number>();
  for (const [k, n] of Object.entries(seen ?? {})) if (k !== 'eat' && k !== 'tidy') by.set(kindWord(k), (by.get(kindWord(k)) ?? 0) + n);
  return [...by.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([w]) => w);
};

/** Where a member stands and what it does at a sweep. */
export interface Presence {
  name: string;
  x: number;
  z: number;
  /** Its chore under way (the chore's id and kind), if any. */
  chore?: { id: string; kind: string };
}

/**
 * The sweep's observations (spec 1.1): each member sees what the others within SEE blocks are doing (each chore once) and
 * meets those within MEET. Counts only, per pair; the world calls it whatever the members are doing (the review's M8).
 */
export function observe(village: string, members: Presence[], now: number): void {
  if (!observing()) return;
  let changed = false;
  for (const a of members) {
    for (const b of members) {
      if (a === b) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > SEE) continue;
      const p = profileOf(village, a.name, b.name);
      if (b.chore && p.lastChore !== b.chore.id) {
        p.lastChore = b.chore.id;
        p.seen ??= {};
        p.seen[b.chore.kind] = (p.seen[b.chore.kind] ?? 0) + 1;
        p.kinds = topKinds(p.seen);
        changed = true;
      }
      if (d <= MEET && now - p.lastMet > 60000) {
        p.lastMet = now;
        changed = true;
        // (character v2: work beside, the same kind within 16 blocks, into affinity)
        if (a.chore && b.chore && a.chore.kind === b.chore.kind) noteFact(village, a.name, b.name, 'beside');
      }
    }
  }
  if (changed) touchMemory();
}

/** A successful step by `helper` on `owner`'s project (the chore end, by code): each sees the other's work there. */
export function noteHelp(village: string, helper: string, owner: string, now: number, project: string): void {
  // (character v2: help into both members' affinity and the owner's feelings, whatever the social mode)
  if (helper !== owner) {
    noteFact(village, helper, owner, 'helped');
    noteFact(village, owner, helper, 'helpedBy');
    think(village, owner, 'helped', `${helper} helped with your project`, now);
  }
  if (!observing() || helper === owner) return;
  const p = profileOf(village, helper, owner);
  p.helped++;
  p.lastMet = Math.max(p.lastMet, now);
  const q = profileOf(village, owner, helper);
  q.helpedBy++;
  q.seen ??= {};
  q.seen.help = (q.seen.help ?? 0) + 1;
  q.kinds = topKinds(q.seen);
  logAct({ type: 'help', village, helper, owner, project });
  touchMemory();
}

/** A commitment closed (acts.ts): the promisee's own experience of the promiser. */
export function noteKept(village: string, promisee: string, promiser: string, kept: boolean): void {
  const p = profileOf(village, promisee, promiser);
  if (kept) {
    p.kept++;
    p.helpedBy++;
    profileOf(village, promiser, promisee).helped++;
  } else p.broke++;
  touchMemory();
}

/** A verified report heard about `about` (acts.ts' gossip): local reputation. */
export function noteHeard(village: string, hearer: string, about: string, kept: boolean): void {
  const p = profileOf(village, hearer, about);
  if (kept) p.heardKept = (p.heardKept ?? 0) + 1;
  else p.heardBroke = (p.heardBroke ?? 0) + 1;
  touchMemory();
}

const interactions = (p: Profile) => p.helped + p.helpedBy + p.kept + p.broke + (p.heardKept ?? 0) + (p.heardBroke ?? 0);
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const minsAgo = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 6) / 10} h ago`;
};

/** A profile as one line (~25 tokens); no pronouns. */
export function profileLine(p: Profile, now: number): string {
  const parts = [p.kinds.length ? `seen mostly ${p.kinds.join(', ')}` : 'not seen at work yet'];
  if (p.helpedBy) parts.push(`helped you ${times(p.helpedBy)}`);
  if (p.helped) parts.push(`you helped ${p.of} ${times(p.helped)}`);
  if (p.kept) parts.push(`kept ${p.kept} promise${p.kept === 1 ? '' : 's'} to you`);
  if (p.broke) parts.push(`broke ${p.broke} promise${p.broke === 1 ? '' : 's'} to you`);
  if (p.heardKept || p.heardBroke) parts.push(`others say: kept ${p.heardKept ?? 0}, broke ${p.heardBroke ?? 0}`);
  parts.push(p.lastMet ? `met ${minsAgo(now - p.lastMet)}` : 'not met yet');
  if (p.feel !== undefined && p.feel !== 0) parts.push(`you feel ${p.feel > 0 ? 'warmly' : 'coolly'} (${p.feel > 0 ? '+' : ''}${p.feel})`);
  if (p.note) parts.push(`your note: "${p.note}"`);
  return `- ${p.of}: ${parts.join('; ')}.`;
}

/** What the world knows about the others now, for the block. */
export interface Scene {
  /** Other members by the kind of chore under way. */
  kinds: Map<string, string[]>;
  choosing: number;
  idle: number;
  /** The kinds on this member's menu. */
  menuKinds: string[];
  /** Members within SEE blocks now. */
  near: string[];
  /** Members this one has open acts with (E.5), most urgent first. */
  open?: string[];
}

/** Riedl's sentence. */
export const RIEDL = 'Consider what the others are doing and have promised.';

/**
 * The awareness block (spec 1.3), capped at BLOCK_CHARS by code with lines dropped from the bottom (the sentence kept):
 * counts by kind (no names), the menu's kinds nobody is doing, up to 5 profiles (open acts, near, most interactions;
 * `on` only), Riedl's sentence. '' when the mode shows no block.
 */
export function awareness(village: string, agent: string, now: number, scene: Scene): { text: string; profiles: string[] } {
  if (!blockOn()) return { text: '', profiles: [] };
  const byWord = new Map<string, number>();
  for (const [k, names] of scene.kinds) byWord.set(kindWord(k), (byWord.get(kindWord(k)) ?? 0) + names.length);
  const counts = [...byWord.entries()].sort((x, y) => y[1] - x[1]).map(([w, n]) => `${w} ${n}`);
  const head = `What the others are doing: ${[...counts, ...(scene.choosing ? [`choosing ${scene.choosing}`] : []), `idle ${scene.idle}`].join(', ')}.`;
  const doing = new Set(byWord.keys());
  const nobody = [...new Set(scene.menuKinds.filter((k) => k !== 'eat' && k !== 'tidy').map(kindWord))].filter((w) => !doing.has(w));
  const lines = [head, ...(nobody.length ? [`Nobody is: ${nobody.join(', ')}.`] : [])];
  const shown: string[] = [];
  if (SOCIAL.mode === 'on') {
    const ps = memberSocial(village, agent).profiles ?? {};
    const order: string[] = [];
    const push = (n: string) => {
      if (n !== agent && ps[n] && !order.includes(n)) order.push(n);
    };
    for (const n of scene.open ?? []) push(n);
    for (const n of [...scene.near].sort((x, y) => (ps[y]?.lastMet ?? 0) - (ps[x]?.lastMet ?? 0))) push(n);
    for (const p of Object.values(ps).filter((q) => interactions(q) > 0).sort((x, y) => interactions(y) - interactions(x))) push(p.of);
    for (const n of order.slice(0, PROFILES_SHOWN)) {
      lines.push(profileLine(ps[n], now));
      shown.push(n);
    }
  }
  let kept = [...lines];
  const join = (ls: string[]) => [...ls, RIEDL].join('\n');
  while (join(kept).length > BLOCK_CHARS && kept.length > 1) {
    const gone = kept.pop()!;
    const who = /^- ([^:]+):/.exec(gone)?.[1];
    if (who) shown.splice(shown.indexOf(who), 1);
  }
  return { text: join(kept), profiles: shown };
}

// ---------------------------------------------------------------------------------------------
// Roles (code)
// ---------------------------------------------------------------------------------------------

/** The modal kind of a list (ties: the latest). */
function modal(kinds: string[]): string | undefined {
  const n = new Map<string, number>();
  for (const k of kinds) n.set(k, (n.get(k) ?? 0) + 1);
  let best: string | undefined, bn = 0;
  for (let i = kinds.length - 1; i >= 0; i--) {
    const c = n.get(kinds[i])!;
    if (c > bn) {
      best = kinds[i];
      bn = c;
    }
  }
  return best;
}

/** Harvests on fields and on slots are one role. */
export const roleKind = (k: string) => (k === 'slot' ? 'farm' : k);

/**
 * A member's model (or scripted) choice of a kind (spec 1.4): its last 5 kinds and the role they make, the modal kind;
 * a change logged. Kept whatever the mode (the panel and the experiment's measures read it); eating and tidying left out.
 */
export function noteChoice(village: string, agent: string, kind: string, now: number): void {
  if (kind === 'eat' || kind === 'tidy') return;
  const s = memberSocial(village, agent);
  s.recent = [...(s.recent ?? []), roleKind(kind)].slice(-5);
  const m = modal(s.recent);
  if (m && s.recent.length >= 3 && s.role?.kind !== m) {
    logAct({ type: 'role', village, agent, role: m, from: s.role?.kind ?? null, held: s.role ? Math.round((now - s.role.since) / 60000) : 0 });
    s.role = { kind: m, since: now };
  }
  touchMemory();
}

export function roleOf(village: string, agent: string): { kind: string; since: number } | undefined {
  return memberSocial(village, agent).role;
}

/** E.8's (e): the role shown back ("You have become the village's ..."), '' unless MCAI_SOCIAL_ROLES=show. */
export function roleLine(village: string, agent: string): string {
  if (!SOCIAL.roles) return '';
  const r = roleOf(village, agent);
  return r ? `You have become the village's ${ROLE_NOUN[r.kind] ?? `${kindWord(r.kind)} hand`}.` : '';
}

/** A role's noun ("lamplighter"), for E.8's (e) and the identity line. */
export const roleNoun = (kind: string) => ROLE_NOUN[kind] ?? `${kindWord(kind)} hand`;
const ROLE_NOUN: Record<string, string> = {
  farm: 'harvester', start: 'farm starter', annex: 'annex builder', pen: 'herder', penwork: 'herder', cake: 'baker',
  iron: 'miner', explore: 'explorer', works: 'works builder', make: 'maker', gather: 'gatherer', light: 'lamplighter',
  furnish: 'furnisher', initiate: 'builder of projects', help: 'helper', activity: 'craftsperson', grow: 'house builder',
  own: 'trader', innovate: 'inventor',
};

/**
 * The society's typed places (PLAN E.3-E.7), kept in memory.ts' store (`social` on each member and each village) and
 * unbuilt in G1 (#26): their shapes are fixed here so later steps add behaviour, not storage. World-free, no logic yet.
 *
 * Rules the shapes follow (docs/research/memory/long-horizon-memory.md §1, §4): facts are kept by code and carry their
 * source; the model edits only narrow fields (a feeling, a short note); nothing is deleted, only superseded; heard content
 * is stored as "X said ..." and never becomes a fact without code's confirmation.
 */

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
}

/** E.5: a typed promise between two members, closed by code from world evidence. */
export interface Commitment {
  id: string;
  from: string;
  to: string;
  what: { kind: string; item?: string; count?: number; option?: string };
  made: number;
  due: number;
  state: 'open' | 'kept' | 'broken' | 'released';
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

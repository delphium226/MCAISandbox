/**
 * The start screen's goal calls (spec runs/2026-10-30/startscreen/spec.md 2.3; server/src/goalMap.ts): a typed goal's words
 * mapped to a measure and pursuit templates (kind goal_map, one call per distinct text, cached in runs/goalmap/cache.jsonl
 * by text, measures in play and catalogue version), and the village-mode takes (kind goal_take, one per member). Every call
 * goes through modelCall (recorded in runs/model-calls/, replayable). The launcher (scripts/runctl.py) runs it.
 *   catalogue [< {"settings": {...}}]                        the lever catalogue the model reads
 *   map < {"texts": [...], "settings": {...}}                a GoalSpec per text: {results: {text: {spec, warnings, valid}}}
 *   takes < {"text": "...", "members": [...], "settings"}    {takes: {name: text}}
 *   profile NAME                                             map a profile's typed goals and write them into it
 *                                                            (profiles/local/ only)
 * The measures in play are read from the given settings (a profile's), not this process's; the choice model
 * (MC_CHOOSE_MODEL, gpt-oss cloud by default) answers. Usage: node node_modules/tsx/dist/cli.mjs scripts/goal_map.mts ...
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const { callModel, parseSpec, label } = await import('../server/src/modelCall');
const { REASONING } = await import('../server/src/modelUsage');
const { CHOOSE } = await import('../server/src/choose');
const M = await import('../server/src/goalMap');
const { effectiveSettings, profileEnv, loadProfile, assignmentOf } = await import('../server/src/profiles');
const { personaOf } = await import('../server/src/temperament');
import type { GoalSpec } from '../server/src/goals';

const [cmd, arg] = process.argv.slice(2);
const readIn = () => (process.stdin.isTTY ? {} : JSON.parse(fs.readFileSync(0, 'utf8') || '{}'));
const strs = (o: Record<string, unknown> = {}) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v)]));
const spec = parseSpec(CHOOSE.model)!;
const CACHE = path.join(ROOT, 'runs', 'goalmap', 'cache.jsonl');

function cache(): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (fs.existsSync(CACHE)) for (const line of fs.readFileSync(CACHE, 'utf8').split('\n')) {
    try {
      const x = JSON.parse(line);
      out.set(x.key, x.mapped);
    } catch {
      // (a torn line)
    }
  }
  return out;
}

/** One text mapped (from the cache when it holds it). */
async function mapOne(text: string, inPlay: ReturnType<typeof M.measuresInPlay>, known: Map<string, unknown>, fresh = false) {
  const key = M.mapKey(text, inPlay);
  if (!fresh && known.has(key)) return { ...(known.get(key) as object), cached: true } as ReturnType<typeof M.checkMapping> & { cached?: boolean };
  const pr = M.mapPrompt(text, inPlay);
  const r = await callModel({ spec, system: pr.system, user: pr.user, tools: pr.tools, level: REASONING.goal_map, agent: 'launcher', kind: 'goal_map', priority: 'human' });
  const c = r.reply.calls.find((x) => x.name === 'map_goal') ?? r.reply.calls[0];
  let input: unknown = c?.input;
  if (!input) {
    try {
      input = JSON.parse(r.reply.text.slice(r.reply.text.indexOf('{'), r.reply.text.lastIndexOf('}') + 1));
    } catch {
      input = null;
    }
  }
  const mapped = { ...M.checkMapping(text, input, inPlay, label(spec)), ms: r.ms, raw: input };
  if (input) {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.appendFileSync(CACHE, JSON.stringify({ key, text, at: new Date().toISOString(), mapped }) + '\n');
  }
  return mapped;
}

/** Map several texts, 3 at a time (the cloud's slots). */
async function mapAll(texts: string[], settings: Record<string, string>) {
  const inPlay = M.measuresInPlay(effectiveSettings(settings));
  const known = cache();
  const uniq = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  const results: Record<string, unknown> = {};
  for (let i = 0; i < uniq.length; i += 3)
    await Promise.all(uniq.slice(i, i + 3).map(async (t) => {
      try {
        results[t] = await mapOne(t, inPlay, known);
      } catch (e) {
        results[t] = { error: (e as Error).message.slice(0, 200) };
      }
    }));
  return { results, inPlay, catalogue: M.catalogueVersion() };
}

/** The takes: one call per member, its persona and archetype in. */
async function takes(text: string, members: string[], settings: Record<string, string>) {
  let arch: Record<string, string> | null = null;
  try {
    arch = assignmentOf(settings);
  } catch {
    arch = null;
  }
  const out: Record<string, string> = {};
  for (let i = 0; i < members.length; i += 3)
    await Promise.all(members.slice(i, i + 3).map(async (name) => {
      const persona = `You are ${name}, ${personaOf(name).replace(/^You are\s*/i, '').replace(/\.$/, '')}${arch?.[name] ? `; your character leans to ${arch[name]}` : ''}.`;
      const pr = M.takePrompt(text, persona);
      try {
        const r = await callModel({ spec, system: pr.system, user: pr.user, tools: pr.tools, level: REASONING.goal_take, agent: name, kind: 'goal_take', priority: 'human' });
        const c = r.reply.calls.find((x) => x.name === 'take') ?? r.reply.calls[0];
        out[name] = M.checkTake(c?.input, r.reply.text);
      } catch (e) {
        out[name] = '';
        console.error(`take ${name}: ${(e as Error).message}`);
      }
    }));
  return { takes: out };
}

if (cmd === 'catalogue') {
  const s = strs(readIn().settings);
  console.log(M.catalogue(M.measuresInPlay(effectiveSettings(s))));
} else if (cmd === 'map') {
  const input = readIn();
  console.log(JSON.stringify(await mapAll(input.texts ?? [], strs(input.settings))));
} else if (cmd === 'takes') {
  const input = readIn();
  console.log(JSON.stringify(await takes(String(input.text ?? ''), input.members ?? [], strs(input.settings))));
} else if (cmd === 'profile' && arg) {
  const file = path.join(ROOT, 'profiles', 'local', `${arg}.json`);
  if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(arg) || !fs.existsSync(file)) throw new Error(`no profile ${arg} in profiles/local/`);
  const p = loadProfile(file, ROOT);
  const g = (p.goals ?? {}) as { village?: GoalSpec; members?: Record<string, GoalSpec> };
  const all = [g.village, ...Object.values(g.members ?? {})].filter((x): x is GoalSpec => !!x?.text);
  const { results } = await mapAll(all.map((x) => x.text), profileEnv(p));
  for (const x of all) {
    const r = results[x.text.trim()] as { spec?: Partial<GoalSpec> } | undefined;
    if (r?.spec) Object.assign(x, { measure: r.spec.measure, pursuits: r.spec.pursuits, unmatched: r.spec.unmatched, mappedBy: 'model', model: r.spec.model });
  }
  fs.writeFileSync(file, JSON.stringify(p, null, 1));
  console.log(`${arg}: ${all.length} goals mapped`);
} else {
  console.log('usage: goal_map.mts catalogue | map | takes (JSON on stdin) | profile NAME');
  process.exit(2);
}

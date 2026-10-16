/**
 * A.3p's temperaments (server/src/temperament.ts, spec runs/2026-10-16/s33/spec_a3p.md) checked offline and printed.
 * Checks: each trait's 24 worker values one per stratum of [-1, 1] (the Latin-hypercube draw), every named vector's kind
 * weights within [0.4, 2.5] with the strongest at an end, eat always 1, the zero vector all 1 with no line, each line
 * <= 200 chars and the same twice, the fixed pick (a meal first, the kind decay, all weights 1 = the lowest rank) and the
 * trim's reserved places. Prints the table (name, vector, the two most-liked and the least-liked kinds, the line);
 * `--json` prints only temperamentTable() as JSON (temperament_report.py reads it).
 * Exits non-zero on any failure.
 * Usage: node_modules/.bin/tsx scripts/checks/temperament_table.mts [--json]
 */
import { TRAITS, KINDS, WEIGHT_MAX, kindWeights, optionWeight, personaLine, temperament, temperamentTable, vectorOf } from '../../server/src/temperament';
import { fixedPick, trimMenu } from '../../server/src/choose';
import type { ChoiceKind, ChoiceMenu, ChoiceOption } from '../../server/src/world';

const table = temperamentTable();
if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(table) + '\n');
  process.exit(0);
}

let failures = 0, checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    process.stdout.write(`FAIL ${what}\n`);
  }
}

// The Latin-hypercube draw: each trait's 24 worker values one per stratum
const workers = table.filter((r) => /^Worker\d+$/.test(r.name));
ok(workers.length === 24, '24 workers');
for (const t of TRAITS) {
  // (the i-th smallest value within the i-th stratum, give or take the 2-decimal rounding)
  const vals = workers.map((r) => r.vector[t]).sort((x, y) => x - y);
  ok(vals.every((x, i) => x >= -1 + (2 * i) / 24 - 0.006 && x <= -1 + (2 * (i + 1)) / 24 + 0.006), `${t}: one worker a stratum (${vals.join(',')})`);
}
// Weights
for (const r of table) {
  const ws = KINDS.map((k) => r.weights[k]);
  ok(ws.every((w) => w >= 1 / WEIGHT_MAX - 0.01 && w <= WEIGHT_MAX + 0.01), `${r.name}: weights in range`);
  ok(Math.abs(Math.max(...ws) - WEIGHT_MAX) < 0.01 || Math.abs(Math.min(...ws) - 1 / WEIGHT_MAX) < 0.01, `${r.name}: the strongest at an end`);
  ok(r.weights.eat === 1, `${r.name}: eat 1`);
  ok(r.persona.length > 0 && r.persona.length <= 200, `${r.name}: a line of 1-200 chars`);
  ok(personaLine(vectorOf(r.name)) === r.persona, `${r.name}: the line deterministic`);
}
const zero = vectorOf('Gus');
ok(TRAITS.every((t) => zero[t] === 0), 'Gus: zero');
ok(Object.values(kindWeights(zero)).every((w) => w === 1), 'zero: all weights 1');
ok(personaLine(zero) === '', 'zero: no line');
ok(TRAITS.every((t) => temperament('Worker3', 'identical')[t] === 0 && temperament('Worker3', 'off')[t] === 0), 'identical and off: zero');
ok(vectorOf('worker3').care === vectorOf('Worker3').care, 'names case-insensitive');
// Sociability
const soc = { ...zero, sociability: 1 }, lon = { ...zero, sociability: -1 };
ok(optionWeight(soc, kindWeights(soc), 'pen', 2) === 2.5 && optionWeight(lon, kindWeights(lon), 'pen', 2) === 0.4 && optionWeight(soc, kindWeights(soc), 'pen', 0) === 1, 'sociability: 2.5 / 0.4 with 2 others, 1 with none');

// The fixed pick
const opt = (id: string, kind: ChoiceKind, rank: number, tw?: number): ChoiceOption =>
  ({ id, kind, key: id, holds: [], excludes: [], name: id, facts: '', effect: '', rank, ...(tw !== undefined ? { tw } : {}) });
const menu = (options: ChoiceOption[]): ChoiceMenu => ({ agent: 'W', village: 'V', t: 0, options, guarded: [], reasons: {}, ctx: { persona: '', village: '', others: '', outcomes: [] } });
ok(fixedPick(menu([opt('farm:1', 'farm', 10), opt('explore:1', 'explore', 800)]))?.id === 'farm:1', 'no tw: the lowest rank');
ok(fixedPick(menu([opt('farm:1', 'farm', 10, 1), opt('slot:1:1', 'slot', 100, 1), opt('explore:1', 'explore', 800, 1)]))?.id === 'farm:1', 'all 1: the lowest rank');
ok(fixedPick(menu([opt('farm:1', 'farm', 10, 0.4), opt('explore:1', 'explore', 800, 2.5)]))?.id === 'explore:1', 'liked explore over disliked farm');
ok(fixedPick(menu([opt('eat', 'eat', 0, 1), opt('explore:1', 'explore', 800, 2.5)]))?.id === 'eat', 'a meal first');
// (kind places: farm 0, slot 1 (two options, one place), pen 2: 1 x 0.85^0 = 1 against 1.3 x 0.85^2 = 0.94)
ok(fixedPick(menu([opt('farm:1', 'farm', 10, 1), opt('slot:1:1', 'slot', 100, 1), opt('slot:1:2', 'slot', 101, 1), opt('pen:cow', 'pen', 400, 1.3)]))?.id === 'farm:1', 'the kind decay counts kinds, not options');
ok(fixedPick(menu([opt('slot:1:2', 'slot', 101, 2), opt('slot:1:1', 'slot', 100, 2)]))?.id === 'slot:1:1', 'ties by rank');
// The trim: a disliked kind gets no reserved place
const nine: ChoiceKind[] = ['farm', 'slot', 'start', 'annex', 'penwork', 'cake', 'iron', 'explore', 'works'];
const many = [...nine.map((k, i) => opt(`${k}:x`, k, 10 + 100 * i, 1)), opt('pen:cow', 'pen', 400, 0.4)];
ok(!trimMenu(many).some((o) => o.kind === 'pen'), 'trim: a disliked kind cut when the room is short');
ok(trimMenu(many.map((o) => ({ ...o, tw: 1 }))).some((o) => o.kind === 'pen'), 'trim: a neutral kind keeps its place');

const top = (w: Record<string, number>) => KINDS.slice().sort((a, b) => w[b] - w[a]);
for (const r of table) {
  const order = top(r.weights);
  const v = TRAITS.map((t) => `${t.slice(0, 4)} ${r.vector[t] >= 0 ? '+' : ''}${r.vector[t].toFixed(2)}`).join(' ');
  process.stdout.write(`${r.name.padEnd(9)} ${v} | likes ${order[0]} ${r.weights[order[0]]}, ${order[1]} ${r.weights[order[1]]}; least ${order[order.length - 1]} ${r.weights[order[order.length - 1]]}\n          ${r.persona}\n`);
}
process.stdout.write(`${failures ? 'FAIL' : 'OK'} temperament_table: ${checks - failures} of ${checks} checks passed\n`);
process.exit(failures ? 1 : 0);

/**
 * #21 (MC_LETTERS) offline: the library's shelf and lectern cells (vanillaPieces.ts vanillaShelves, mcLibrary.ts
 * libraryCells).
 * 1. Every library piece in the jar, imported, at four quarter turns: each shelf cell holds the piece's planks in the
 *    placed design (the import's substitute), each lectern cell is open (air inside or out), and the cell its facing
 *    points to (where a reader stands) is open too; plains_library_2 gives 4 shelves and 1 lectern.
 * 2. On a checkpoint (default im2_mine: B25x2's plains_library_2, built at a turn): the world's libraryPlan gives the cells
 *    the letters spec's check measured in the placed world (birch planks at -1646,66,35/36, -1646,67,36, -1646,68,36;
 *    the lectern's air at -1644,66,36), the first-built plains library.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/library_shelves.mts [villages.json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const villagesFile = process.argv[2] ?? 'mc/testcheckpoints/im2_mine/villages.json';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'library-shelves-'));
process.env.MC_LADDER = 'on';
process.env.MC_LETTERS = 'on';
process.env.MC_TIME_SCALE = '1';
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const mute = () => { console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const unmute = () => Object.assign(console, quiet);
const say = (s: string) => quiet.log(s);
let fails = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) fails++;
  if (!cond || process.env.VERBOSE) say(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};

const { VILLAGE_BIOMES, listPieces, pieceToDesign, readPiece } = await import('../../server/src/vanillaPieces');
const { vanillaJar } = await import('../../server/src/vanillaData');
const { libraryCells } = await import('../../server/src/mineflayer/mcLibrary');
const jar = vanillaJar();
const STEP: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

// 1. the pieces at four turns
let pieces = 0;
for (const biome of VILLAGE_BIOMES)
  for (const p of listPieces(jar, biome, 'houses').filter((x) => /library/.test(x))) {
    const name = p.split('/').pop()!;
    let imp: Any;
    try {
      imp = pieceToDesign(readPiece(p, jar), biome);
    } catch (e) {
      say(`  (${name}: not imported: ${(e as Error).message.slice(0, 80)})`);
      continue;
    }
    pieces++;
    const d = imp.design, shelves = imp.shelves ?? [];
    const nS = shelves.filter((c: Any) => c.block === 'bookshelf').length, nL = shelves.filter((c: Any) => c.block === 'lectern').length;
    say(`${name.padEnd(22)} ${d.width}x${d.depth}: ${nS} shelves, ${nL} lectern${nL === 1 ? '' : 's'}`);
    if (name === 'plains_library_2') ok(nS === 4 && nL === 1, 'plains_library_2: 4 shelves and 1 lectern');
    for (let rot = 0; rot < 4; rot++) {
      // (the placed grid built here independently: each design cell turned as build_design turns it)
      const W = rot % 2 ? d.depth : d.width, D = rot % 2 ? d.width : d.depth;
      const cx = 100, cz = 200, x1 = cx - Math.floor(W / 2), z1 = cz - Math.floor(D / 2);
      const grid = new Map<string, string>();
      d.layers.forEach((layer: string[], l: number) => layer.forEach((row: string, j: number) => [...row].forEach((ch, i) => {
        let [u, v, ww, dd] = [i, j, d.width, d.depth];
        for (let r = 0; r < rot; r++) [u, v, ww, dd] = [dd - 1 - v, u, dd, ww];
        grid.set(`${x1 + u},${l},${z1 + v}`, ch === '_' || ch === '.' ? 'air' : d.palette[ch]);
      })));
      const cells = libraryCells({ design: d, x: cx, z: cz, rot }, shelves, 0, 99);
      ok(cells.length === nS + Math.min(1, nL), `${name} rot ${rot}: every shelf and one lectern placed (${cells.length})`);
      for (const c of cells) {
        const b = grid.get(`${c.x},${c.y},${c.z}`) ?? 'outside';
        if (c.part === 'shelf') ok(/_planks$/.test(b), `${name} rot ${rot}: shelf at ${c.x},${c.y},${c.z} holds planks (${b})`);
        else {
          ok(b === 'air', `${name} rot ${rot}: lectern cell ${c.x},${c.y},${c.z} open (${b})`);
          const [fx, fz] = STEP[c.facing ?? 'north'];
          const front = grid.get(`${c.x + fx},${c.y},${c.z + fz}`) ?? 'outside';
          ok(!!c.facing && front === 'air', `${name} rot ${rot}: the lectern faces ${c.facing}, its reader's cell open (${front})`);
        }
      }
    }
  }
ok(pieces >= 5, `${pieces} library pieces imported`);

// 2. the checkpoint's library
mute();
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
fs.copyFileSync(villagesFile, path.join(dir, 'villages.json'));
const data = JSON.parse(fs.readFileSync(villagesFile, 'utf8')) as { villages: Any[] };
const base = data.villages.find((x) => x.ladder?.current === 'letters') ?? data.villages.find((x) => x.complete);
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
w.villages.save = () => {};
const v = w.villages.get(base.name);
const plan = w.libraryPlan(v);
unmute();
const key = (c: Any) => `${c.x},${c.y},${c.z}`;
say(`${v.name}: ${plan ? `${plan.label} ${plan.structure.id}: ${plan.cells.map((c: Any) => `${c.part}@${key(c)}${c.facing ? `(${c.facing})` : ''}`).join(', ')}` : 'no library'}`);
if (/im2_mine/.test(villagesFile)) {
  const want = ['-1646,66,36', '-1646,66,35', '-1646,67,36', '-1646,68,36'];
  ok(plan?.structure.kind === 'plains_library_2', 'the first plains library');
  ok(plan && plan.cells.filter((c: Any) => c.part === 'shelf').map(key).sort().join(' ') === want.sort().join(' '), 'the 4 shelf cells as measured in the world');
  ok(plan && plan.cells.find((c: Any) => c.part === 'lectern') && key(plan.cells.find((c: Any) => c.part === 'lectern')) === '-1644,66,36', 'the lectern cell as measured');
  ok(plan && plan.cells[plan.cells.length - 1].part === 'lectern' && plan.open.length === 5, 'shelves first, the lectern last; all 5 open');
}
say(fails ? `library_shelves: ${fails} of ${checks} failed` : `library_shelves: all ${checks} passed`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.exit(fails ? 1 : 0);

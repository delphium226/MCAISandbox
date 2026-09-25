/** Tiny pixel-art HUD icons (hearts, hunger, armour, air, furnace flame/arrow), drawn from bitmaps. */

type Pal = Record<string, string>;

function draw(rows: string[], pal: Pal, w = rows[0].length, h = rows.length): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c.toDataURL();
}

const HEART = [
  '.kk.kk..',
  'krrkrrk.',
  'krwrrrrk',
  'krrrrrrk',
  '.krrrrk.',
  '..krrk..',
  '...kk...',
].map((r) => r + '.');
const HEART_OUTLINE_PAL: Pal = { k: '#000', r: '#3a0000', w: '#3a0000' };
const HEART_FULL: Pal = { k: '#000', r: '#ff1313', w: '#ffc9c9' };
const HEART_HALF = HEART.map((r) => r.slice(0, 4) + r.slice(4).replace(/[rw]/g, 'e'));
const HEART_HALF_PAL: Pal = { k: '#000', r: '#ff1313', w: '#ffc9c9', e: '#3a0000' };

const FOOD = [
  '...kkkk..',
  '..kbbbbk.',
  '.kbbwbbbk',
  '.kbbbbbbk',
  '.kbbbbbk.',
  'kkkbbbk..',
  'kwkkkk...',
  '.kk......',
  '.........',
];
const FOOD_PAL: Pal = { k: '#2a1500', b: '#b3651e', w: '#e8e8e8' };
const FOOD_EMPTY_PAL: Pal = { k: '#2a1500', b: '#3b2711', w: '#6b5a4a' };
const FOOD_HALF = FOOD.map((r) => r.slice(0, 5).replace(/[bw]/g, 'e') + r.slice(5));
const FOOD_HALF_PAL: Pal = { ...FOOD_PAL, e: '#3b2711' };

const ARMOR = [
  '.kkk.kkk.',
  'kwwwkwwwk',
  'kwsswwssk',
  'kwsssssk.',
  '.kwssssk.',
  '.kwssssk.',
  '.kwssssk.',
  '..kkkkk..',
  '.........',
];
const ARMOR_PAL: Pal = { k: '#000', w: '#fff', s: '#c6c6c6' };
const ARMOR_EMPTY: Pal = { k: '#000', w: '#4a4a4a', s: '#3a3a3a' };

const BUBBLE = [
  '..kkkk...',
  '.kwbbbk..',
  'kwwbbbbk.',
  'kbbbbbbk.',
  'kbbbbbbk.',
  'kbbbbbbk.',
  '.kbbbbk..',
  '..kkkk...',
  '.........',
];
const BUBBLE_PAL: Pal = { k: '#1c2d6b', w: '#fff', b: '#5b8de8' };

const FLAME = [
  '......r.......',
  '.....rr.......',
  '.....ror......',
  '....roor..r...',
  '...rooorr.rr..',
  '..rrooyoorror.',
  '..rooyyyoooor.',
  '.rooyyyyyooorr',
  '.rooyyyyyyoor.',
  '.rooyywwyyoor.',
  '.roooywwyyoor.',
  '..rooyyyyoor..',
  '...rrooooorr..',
  '.....rrrrr....',
];
const FLAME_PAL: Pal = { r: '#b9270f', o: '#f37a15', y: '#ffd21f', w: '#ffffc0' };
const FLAME_EMPTY_PAL: Pal = { r: '#6b6b6b', o: '#8b8b8b', y: '#8b8b8b', w: '#8b8b8b' };

const ARROW = [
  '..............x.......',
  '..............xx......',
  '..............xxx.....',
  '..............xxxx....',
  '..............xxxxx...',
  'xxxxxxxxxxxxxxxxxxxx..',
  'xxxxxxxxxxxxxxxxxxxxx.',
  'xxxxxxxxxxxxxxxxxxxxxx',
  'xxxxxxxxxxxxxxxxxxxxx.',
  'xxxxxxxxxxxxxxxxxxxx..',
  '..............xxxxx...',
  '..............xxxx....',
  '..............xxx.....',
  '..............xx......',
  '..............x.......',
];

export const HUD_ICONS = {
  heartFull: draw(HEART, HEART_FULL),
  heartHalf: draw(HEART_HALF, HEART_HALF_PAL),
  heartEmpty: draw(HEART, HEART_OUTLINE_PAL),
  foodFull: draw(FOOD, FOOD_PAL),
  foodHalf: draw(FOOD_HALF, FOOD_HALF_PAL),
  foodEmpty: draw(FOOD, FOOD_EMPTY_PAL),
  armorFull: draw(ARMOR, ARMOR_PAL),
  armorHalf: draw(ARMOR.map((r) => r.slice(0, 4) + r.slice(4).replace(/[ws]/g, 'e')), { ...ARMOR_PAL, e: '#3a3a3a' }),
  armorEmpty: draw(ARMOR, ARMOR_EMPTY),
  bubble: draw(BUBBLE, BUBBLE_PAL),
  flame: draw(FLAME, FLAME_PAL),
  flameEmpty: draw(FLAME, FLAME_EMPTY_PAL),
  arrowEmpty: draw(ARROW, { x: '#8b8b8b' }),
  arrowFull: draw(ARROW, { x: '#ffffff' }),
};

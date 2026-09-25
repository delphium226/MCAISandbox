/**
 * MCPixel — an original chunky pixel font in the spirit of classic block-game UIs.
 *
 * Glyphs are hand-drawn bitmaps (see GLYPH_SOURCE below). At runtime they are
 * traced into outlines and compiled into an OpenType (CFF) font with opentype.js,
 * which is then registered with `document.fonts` under the family 'MCPixel'.
 *
 * Metrics (1 font pixel = 1/8 em = 128 units, unitsPerEm = 1024):
 *   - cap height 7 px, x-height 5 px, descenders 2 px
 *   - ascender 7 px, descender 2 px  ->  `line-height: normal` = 9 font px
 *   - advance = glyph width + 1 px; space advance = 4 px
 * At CSS `font-size: 16px` each font pixel is exactly 2x2 screen pixels and the
 * natural line height is 18px. Use multiples of 8px (8/16/24/32) for crisp text.
 */

/** Rows per glyph bitmap, including the descender rows. */
export const GLYPH_HEIGHT = 9;
/**
 * Index of the first row below the baseline. Rows 0..GLYPH_BASELINE-1 sit on or
 * above the baseline (row GLYPH_BASELINE-1 rests on it); rows GLYPH_BASELINE..
 * GLYPH_HEIGHT-1 are descender rows.
 */
export const GLYPH_BASELINE = 7;

/** Font family name registered with document.fonts. */
export const PIXEL_FONT_FAMILY = 'MCPixel';

const UNITS_PER_EM = 1024;
const PX = UNITS_PER_EM / 8; // font units per font pixel
const LETTER_SPACING = 1; // px of spacing added after every glyph

/*
 * Glyph source. Blocks are separated by blank lines. Each block starts with a
 * key line `= <char>` (or `= U+XXXX` for awkward characters), followed by up to
 * GLYPH_HEIGHT rows of '#' (on) / '.' (off). Rows are top-aligned; missing rows
 * at the bottom are blank. The first 7 rows are the cap-height area; rows 8-9
 * are descenders. All rows of a glyph must have equal width.
 */
const GLYPH_SOURCE = `
= U+0020
...
...
...
...
...
...
...

= !
#
#
#
#
#
.
#

= "
#.#
#.#

= #
.#.#.
.#.#.
#####
.#.#.
#####
.#.#.
.#.#.

= $
..#..
.####
#....
.###.
....#
####.
..#..

= %
##..#
##..#
...#.
..#..
.#...
#..##
#..##

= &
.##..
#..#.
.##..
.##.#
#..#.
#..#.
.##.#

= '
#
#

= (
..#
.#.
#..
#..
#..
.#.
..#

= )
#..
.#.
..#
..#
..#
.#.
#..

= *
.....
..#..
#.#.#
.###.
#.#.#
..#..
.....

= +
.....
..#..
..#..
#####
..#..
..#..
.....

= ,
..
..
..
..
..
.#
.#
#.

= -
.....
.....
.....
#####
.....
.....
.....

= .
.
.
.
.
.
.
#

= /
....#
....#
...#.
..#..
.#...
#....
#....

= 0
.###.
#...#
#..##
#.#.#
##..#
#...#
.###.

= 1
..#..
.##..
..#..
..#..
..#..
..#..
#####

= 2
.###.
#...#
....#
..##.
.#...
#....
#####

= 3
.###.
#...#
....#
..##.
....#
#...#
.###.

= 4
...##
..#.#
.#..#
#...#
#####
....#
....#

= 5
#####
#....
####.
....#
....#
#...#
.###.

= 6
..##.
.#...
#....
####.
#...#
#...#
.###.

= 7
#####
#...#
....#
...#.
..#..
..#..
..#..

= 8
.###.
#...#
#...#
.###.
#...#
#...#
.###.

= 9
.###.
#...#
#...#
.####
....#
...#.
.##..

= :
.
.
#
.
.
.
#

= ;
..
..
.#
..
..
.#
.#
#.

= <
....
...#
..#.
.#..
..#.
...#
....

= =
.....
.....
#####
.....
.....
#####
.....

= >
....
#...
.#..
..#.
.#..
#...
....

= ?
.###.
#...#
....#
...#.
..#..
.....
..#..

= @
.####.
#....#
#.##.#
#.#..#
#.####
#.....
.####.

= A
.###.
#...#
#...#
#####
#...#
#...#
#...#

= B
####.
#...#
#...#
####.
#...#
#...#
####.

= C
.###.
#...#
#....
#....
#....
#...#
.###.

= D
####.
#...#
#...#
#...#
#...#
#...#
####.

= E
#####
#....
#....
####.
#....
#....
#####

= F
#####
#....
#....
####.
#....
#....
#....

= G
.####
#....
#....
#..##
#...#
#...#
.###.

= H
#...#
#...#
#...#
#####
#...#
#...#
#...#

= I
###
.#.
.#.
.#.
.#.
.#.
###

= J
....#
....#
....#
....#
#...#
#...#
.###.

= K
#...#
#..#.
#.#..
##...
#.#..
#..#.
#...#

= L
#....
#....
#....
#....
#....
#....
#####

= M
#...#
##.##
#.#.#
#...#
#...#
#...#
#...#

= N
#...#
##..#
#.#.#
#..##
#...#
#...#
#...#

= O
.###.
#...#
#...#
#...#
#...#
#...#
.###.

= P
####.
#...#
#...#
####.
#....
#....
#....

= Q
.###.
#...#
#...#
#...#
#.#.#
#..#.
.##.#

= R
####.
#...#
#...#
####.
#.#..
#..#.
#...#

= S
.####
#....
#....
.###.
....#
....#
####.

= T
#####
..#..
..#..
..#..
..#..
..#..
..#..

= U
#...#
#...#
#...#
#...#
#...#
#...#
.###.

= V
#...#
#...#
#...#
#...#
.#.#.
.#.#.
..#..

= W
#...#
#...#
#...#
#...#
#.#.#
##.##
#...#

= X
#...#
#...#
.#.#.
..#..
.#.#.
#...#
#...#

= Y
#...#
#...#
.#.#.
..#..
..#..
..#..
..#..

= Z
#####
....#
...#.
..#..
.#...
#....
#####

= [
###
#..
#..
#..
#..
#..
###

= U+005C
#....
#....
.#...
..#..
...#.
....#
....#

= ]
###
..#
..#
..#
..#
..#
###

= ^
..#..
.#.#.
#...#

= _
.....
.....
.....
.....
.....
.....
.....
#####

= U+0060
#.
.#

= a
.....
.....
.###.
....#
.####
#...#
.####

= b
#....
#....
#.##.
##..#
#...#
#...#
####.

= c
.....
.....
.###.
#...#
#....
#...#
.###.

= d
....#
....#
.##.#
#..##
#...#
#...#
.####

= e
.....
.....
.###.
#...#
#####
#....
.####

= f
..##
.#..
####
.#..
.#..
.#..
.#..

= g
.....
.....
.####
#...#
#...#
#...#
.####
....#
.###.

= h
#....
#....
#.##.
##..#
#...#
#...#
#...#

= i
#
.
#
#
#
#
#

= j
...#
....
...#
...#
...#
...#
...#
#..#
.##.

= k
#...
#...
#..#
#.#.
##..
#.#.
#..#

= l
#.
#.
#.
#.
#.
#.
.#

= m
.....
.....
##.#.
#.#.#
#.#.#
#...#
#...#

= n
.....
.....
####.
#...#
#...#
#...#
#...#

= o
.....
.....
.###.
#...#
#...#
#...#
.###.

= p
.....
.....
#.##.
##..#
#...#
#...#
####.
#....
#....

= q
.....
.....
.##.#
#..##
#...#
#...#
.####
....#
....#

= r
.....
.....
#.##.
##..#
#....
#....
#....

= s
.....
.....
.####
#....
.###.
....#
####.

= t
...
.#.
###
.#.
.#.
.#.
..#

= u
.....
.....
#...#
#...#
#...#
#...#
.####

= v
.....
.....
#...#
#...#
#...#
.#.#.
..#..

= w
.....
.....
#...#
#...#
#.#.#
#.#.#
.#.#.

= x
.....
.....
#...#
.#.#.
..#..
.#.#.
#...#

= y
.....
.....
#...#
#...#
#...#
#...#
.####
....#
.###.

= z
.....
.....
#####
...#.
..#..
.#...
#####

= {
..##
.#..
.#..
#...
.#..
.#..
..##

= |
#
#
#
#
#
#
#
#

= }
##..
..#.
..#.
...#
..#.
..#.
##..

= ~
......
......
......
.##..#
#..##.
......
......

= §
.####
#....
.###.
#...#
.###.
....#
####.

= •
..
..
..
##
##
..
..

= ·
.
.
.
.
#
.
.

= °
.##.
#..#
#..#
.##.

= ©
.#####.
#.....#
#.###.#
#.#...#
#.###.#
#.....#
.#####.

= é
...#.
..#..
.###.
#...#
#####
#....
.####

= è
.#...
..#..
.###.
#...#
#####
#....
.####

= à
.#...
..#..
.###.
....#
.####
#...#
.####

= ç
.....
.....
.###.
#...#
#....
#...#
.###.
..#..
.##..

= ü
.#.#.
.....
#...#
#...#
#...#
#...#
.####

= ö
.#.#.
.....
.###.
#...#
#...#
#...#
.###.

= ä
.#.#.
.....
.###.
....#
.####
#...#
.####

= ß
.###.
#...#
#..#.
#.#..
#..#.
#...#
#.##.

= ←
.......
..#....
.#.....
#######
.#.....
..#....
.......

= →
.......
....#..
.....#.
#######
.....#.
....#..
.......

= ↑
..#..
.###.
#.#.#
..#..
..#..
..#..
..#..

= ↓
..#..
..#..
..#..
..#..
#.#.#
.###.
..#..

= ♥
.......
.##.##.
#######
#######
.#####.
..###..
...#...

= ★
...#...
...#...
#######
.#####.
..###..
.##.##.
.#...#.

= ✔
.......
......#
.....##
#...##.
##.##..
.###...
..#....

= ✖
......
##..##
.####.
..##..
.####.
##..##
......

= ▶
#...
##..
###.
####
###.
##..
#...

= …
.....
.....
.....
.....
.....
.....
#.#.#

= «
......
......
..#..#
.#..#.
#..#..
.#..#.
..#..#

= »
......
......
#..#..
.#..#.
..#..#
.#..#.
#..#..
`;

function parseGlyphSource(src: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const blocks = src.split(/\r?\n\s*\r?\n/);
  for (const raw of blocks) {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    const key = lines[0];
    if (!key.startsWith('= ')) throw new Error(`pixelFont: bad glyph key line "${key}"`);
    const spec = key.slice(2);
    const ch = /^U\+[0-9A-Fa-f]{4,6}$/.test(spec)
      ? String.fromCodePoint(parseInt(spec.slice(2), 16))
      : spec;
    if ([...ch].length !== 1) throw new Error(`pixelFont: bad glyph key "${spec}"`);
    const rows = lines.slice(1);
    if (rows.length === 0 || rows.length > GLYPH_HEIGHT) {
      throw new Error(`pixelFont: glyph "${ch}" has ${rows.length} rows`);
    }
    const width = rows[0].length;
    for (const r of rows) {
      if (r.length !== width || !/^[#.]+$/.test(r)) {
        throw new Error(`pixelFont: glyph "${ch}" has inconsistent row "${r}"`);
      }
    }
    while (rows.length < GLYPH_HEIGHT) rows.push('.'.repeat(width));
    out[ch] = rows;
  }
  return out;
}

/**
 * The raw glyph bitmaps, keyed by character. Each glyph is GLYPH_HEIGHT rows of
 * equal width using '#' for on-pixels and '.' for off. Advance = width + 1.
 */
export const GLYPHS: Record<string, string[]> = parseGlyphSource(GLYPH_SOURCE);

/** Glyph used for characters missing from GLYPHS (a hollow box). */
export const MISSING_GLYPH: string[] = [
  '#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####', '.....', '.....',
];

/** Horizontal advance of a glyph in font pixels (bitmap width + letter spacing). */
export function glyphAdvance(ch: string): number {
  return (GLYPHS[ch] ?? MISSING_GLYPH)[0].length + LETTER_SPACING;
}

/** Width in font pixels of a string (without the trailing letter spacing). */
export function measurePixelText(text: string): number {
  let w = 0;
  for (const ch of text) w += glyphAdvance(ch);
  return Math.max(0, w - LETTER_SPACING);
}

type Pt = [number, number];

/**
 * Trace the union of on-pixels into closed polygon contours in pixel units
 * (x right, y up, baseline at y = 0). Outer contours run counter-clockwise and
 * holes clockwise, so no contour overlaps another and fill rules can't cancel.
 */
function traceContours(rows: string[]): Pt[][] {
  const h = rows.length;
  const w = rows[0].length;
  const on = (c: number, r: number): boolean =>
    r >= 0 && r < h && c >= 0 && c < w && rows[r][c] === '#';

  interface Edge { x0: number; y0: number; x1: number; y1: number; used: boolean }
  const edges: Edge[] = [];
  const byStart = new Map<string, Edge[]>();
  const add = (x0: number, y0: number, x1: number, y1: number): void => {
    const e: Edge = { x0, y0, x1, y1, used: false };
    edges.push(e);
    const k = `${x0},${y0}`;
    const list = byStart.get(k);
    if (list) list.push(e);
    else byStart.set(k, [e]);
  };

  for (let r = 0; r < h; r++) {
    const yt = GLYPH_BASELINE - r; // top edge of the pixel (y up)
    const yb = yt - 1;
    for (let c = 0; c < w; c++) {
      if (!on(c, r)) continue;
      // Interior kept on the left of every edge -> CCW outer contours.
      if (!on(c, r + 1)) add(c, yb, c + 1, yb); // bottom, +x
      if (!on(c + 1, r)) add(c + 1, yb, c + 1, yt); // right, +y
      if (!on(c, r - 1)) add(c + 1, yt, c, yt); // top, -x
      if (!on(c - 1, r)) add(c, yt, c, yb); // left, -y
    }
  }

  const contours: Pt[][] = [];
  for (const start of edges) {
    if (start.used) continue;
    const pts: Pt[] = [];
    let e: Edge = start;
    for (;;) {
      e.used = true;
      pts.push([e.x0, e.y0]);
      if (e.x1 === start.x0 && e.y1 === start.y0) break; // closed
      const dx = e.x1 - e.x0;
      const dy = e.y1 - e.y0;
      const cands = (byStart.get(`${e.x1},${e.y1}`) ?? []).filter((n) => !n.used);
      if (cands.length === 0) break; // should not happen for a valid bitmap
      // Prefer the left-most turn so corner-touching pixels form separate contours.
      const rank = (n: Edge): number => {
        const cross = dx * (n.y1 - n.y0) - dy * (n.x1 - n.x0);
        return cross > 0 ? 0 : cross === 0 ? 1 : 2;
      };
      cands.sort((a, b) => rank(a) - rank(b));
      e = cands[0];
    }
    // Drop collinear points.
    const simplified: Pt[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[(i - 1 + n) % n];
      const [cx, cy] = pts[i];
      const [nx, ny] = pts[(i + 1) % n];
      if ((cx - px) * (ny - cy) - (cy - py) * (nx - cx) !== 0) simplified.push([cx, cy]);
    }
    if (simplified.length >= 3) contours.push(simplified);
  }
  return contours;
}

type OpenTypeModule = typeof import('opentype.js');

async function importOpenType(): Promise<OpenTypeModule> {
  const mod = (await import('opentype.js')) as OpenTypeModule & { default?: OpenTypeModule };
  // Bundlers expose the ESM build (named exports); Node's CJS interop exposes `default`.
  if (typeof mod.Font === 'function') return mod;
  if (mod.default && typeof mod.default.Font === 'function') return mod.default;
  throw new Error('pixelFont: could not resolve opentype.js exports');
}

function glyphPath(ot: OpenTypeModule, rows: string[]): InstanceType<OpenTypeModule['Path']> {
  const path = new ot.Path();
  for (const contour of traceContours(rows)) {
    contour.forEach(([x, y], i) => {
      if (i === 0) path.moveTo(x * PX, y * PX);
      else path.lineTo(x * PX, y * PX);
    });
    path.close();
  }
  return path;
}

/** Build the MCPixel OpenType font and return the binary (OTF/CFF). */
export async function buildPixelFont(): Promise<ArrayBuffer> {
  const ot = await importOpenType();
  const glyphs = [
    new ot.Glyph({
      name: '.notdef',
      advanceWidth: (MISSING_GLYPH[0].length + LETTER_SPACING) * PX,
      path: glyphPath(ot, MISSING_GLYPH),
    }),
  ];
  const chars = Object.keys(GLYPHS).sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
  for (const ch of chars) {
    const cp = ch.codePointAt(0)!;
    const rows = GLYPHS[ch];
    glyphs.push(
      new ot.Glyph({
        name: cp === 0x20 ? 'space' : `uni${cp.toString(16).toUpperCase().padStart(4, '0')}`,
        unicode: cp,
        advanceWidth: (rows[0].length + LETTER_SPACING) * PX,
        path: glyphPath(ot, rows),
      }),
    );
  }
  const font = new ot.Font({
    familyName: PIXEL_FONT_FAMILY,
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: GLYPH_BASELINE * PX,
    descender: -(GLYPH_HEIGHT - GLYPH_BASELINE) * PX,
    glyphs,
    designer: 'MCAISandbox',
    manufacturer: 'MCAISandbox',
    version: '1.0',
    description: 'Original procedurally generated pixel font.',
    copyright: 'Original design, MCAISandbox project.',
  });
  // Pin vertical metrics so every platform agrees on a 9px (18px @ 16px) line.
  const os2 = font.tables.os2;
  if (os2) {
    os2.sTypoAscender = GLYPH_BASELINE * PX;
    os2.sTypoDescender = -(GLYPH_HEIGHT - GLYPH_BASELINE) * PX;
    os2.sTypoLineGap = 0;
    os2.usWinAscent = GLYPH_BASELINE * PX;
    os2.usWinDescent = (GLYPH_HEIGHT - GLYPH_BASELINE) * PX;
    os2.sxHeight = 5 * PX;
    os2.sCapHeight = 7 * PX;
    // USE_TYPO_METRICS (bit 7) | REGULAR (bit 6)
    os2.fsSelection = (1 << 7) | (1 << 6);
  }
  return font.toArrayBuffer();
}

let loadPromise: Promise<void> | null = null;

/** Build the font and register it with document.fonts under family 'MCPixel'. Resolves when ready. Idempotent. */
export function loadPixelFont(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
          throw new Error('FontFace API unavailable');
        }
        const buffer = await buildPixelFont();
        const face = new FontFace(PIXEL_FONT_FAMILY, buffer, { style: 'normal', weight: '400' });
        await face.load();
        document.fonts.add(face);
      } catch (err) {
        console.warn('[pixelFont] failed to build MCPixel font; falling back to monospace.', err);
      }
    })();
  }
  return loadPromise;
}

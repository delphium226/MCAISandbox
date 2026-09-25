// Minimal type declarations for the subset of opentype.js (v2) used by pixelFont.ts.
// (@types/opentype.js targets v1 and is not needed for font construction.)
declare module 'opentype.js' {
  export class Path {
    constructor();
    commands: unknown[];
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    close(): void;
  }

  export interface GlyphOptions {
    name: string;
    unicode?: number;
    unicodes?: number[];
    advanceWidth: number;
    path: Path;
  }

  export class Glyph {
    constructor(options: GlyphOptions);
    name: string;
    unicode?: number;
    unicodes: number[];
    advanceWidth: number;
    path: Path;
  }

  export interface FontOptions {
    familyName: string;
    styleName: string;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: Glyph[];
    designer?: string;
    designerURL?: string;
    manufacturer?: string;
    license?: string;
    version?: string;
    description?: string;
    copyright?: string;
  }

  export interface GlyphSet {
    length: number;
    get(index: number): Glyph;
  }

  export class Font {
    constructor(options: FontOptions);
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: GlyphSet;
    tables: Record<string, Record<string, unknown> | undefined>;
    toArrayBuffer(): ArrayBuffer;
    charToGlyph(char: string): Glyph;
  }

  export function parse(buffer: ArrayBuffer): Font;
}

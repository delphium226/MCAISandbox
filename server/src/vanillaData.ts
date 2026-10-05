/**
 * Vanilla's data read from the local Minecraft jar at runtime (V2.5): entries of the jar (a zip) listed and read, JSON
 * entries parsed, and tags (`data/minecraft/tags/<kind>/<name>.json`) resolved with the tags they name. Mojang's data is
 * never copied into the repo; everything is read from the jar on this machine and cached per process. World-independent:
 * the village pieces (vanillaPieces.ts) and the Minecraft adapter's block lists build on it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

/** The jar vanilla's data is read from (mc/server's Paper; the test world's server runs the same version). */
export const DEFAULT_JAR = 'mc/server/versions/26.1.2/paper-26.1.2.jar';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A jar path resolved against the repo root (relative paths do not depend on the working directory). */
const resolveJar = (jar: string) => path.resolve(ROOT, jar);

/** The jar to read: `MC_VANILLA_JAR` or DEFAULT_JAR, resolved against the repo root. */
export function vanillaJar(): string {
  return resolveJar(process.env.MC_VANILLA_JAR ?? DEFAULT_JAR);
}

// ---------------------------------------------------------------------------------------------
// Reading the jar: a zip's central directory, each entry stored or deflated (zlib, no dependency)
// ---------------------------------------------------------------------------------------------

interface ZipEntry { name: string; method: number; size: number; offset: number }

const jars = new Map<string, { buf: Buffer; entries: Map<string, ZipEntry> }>();

/** Whether the jar is there to read (callers fall back to their own lists when it is not). */
export function hasJar(jar = DEFAULT_JAR): boolean {
  jar = resolveJar(jar);
  return jars.has(jar) || fs.existsSync(jar);
}

function openJar(jarPath: string) {
  jarPath = resolveJar(jarPath);
  const cached = jars.get(jarPath);
  if (cached) return cached;
  const buf = fs.readFileSync(jarPath);
  // The end-of-central-directory record is in the last 64 KiB (a comment may follow it)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(`${jarPath} is not a zip file`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { name, method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const jar = { buf, entries };
  jars.set(jarPath, jar);
  return jar;
}

/** Entry names under a prefix ("data/minecraft/recipe/"), sorted. */
export function listEntries(prefix: string, jar = DEFAULT_JAR): string[] {
  return [...openJar(jar).entries.keys()].filter((n) => n.startsWith(prefix)).sort();
}

/** Whether the jar holds an entry. */
export function hasEntry(name: string, jar = DEFAULT_JAR): boolean {
  return openJar(jar).entries.has(name);
}

/** One entry's bytes. */
export function readEntry(name: string, jar = DEFAULT_JAR): Buffer {
  const { buf, entries } = openJar(jar);
  const e = entries.get(name);
  if (!e) throw new Error(`no ${name} in ${jar}`);
  // The local header's name and extra lengths can differ from the central directory's
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const raw = buf.subarray(start, start + e.size);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`${name}: zip method ${e.method} is not supported`);
}

/** One JSON entry, parsed. */
export function readJson<T = unknown>(name: string, jar = DEFAULT_JAR): T {
  return JSON.parse(readEntry(name, jar).toString('utf8')) as T;
}

// ---------------------------------------------------------------------------------------------
// Tags: `{"values": ["minecraft:oak_log", "#minecraft:logs", {"id": "...", "required": false}]}`
// ---------------------------------------------------------------------------------------------

export type TagKind = 'block' | 'item' | 'fluid' | 'entity_type';

const stripNs = (s: string) => s.replace(/^minecraft:/, '');
const tags = new Map<string, Set<string>>();
const resolving = new Set<string>();

/** Names of the tags of one kind ("logs", "mineable/pickaxe"...), without namespace. */
export function listTags(kind: TagKind, jar = DEFAULT_JAR): string[] {
  const prefix = `data/minecraft/tags/${kind}/`;
  return listEntries(prefix, jar).filter((n) => n.endsWith('.json')).map((n) => n.slice(prefix.length, -5));
}

/** A tag's members ("logs" or "#minecraft:logs"), the tags it names resolved, namespace stripped; cached per jar. */
export function tag(kind: TagKind, name: string, jar = DEFAULT_JAR): Set<string> {
  name = stripNs(name.replace(/^#/, ''));
  const key = `${resolveJar(jar)}|${kind}|${name}`;
  const cached = tags.get(key);
  if (cached) return cached;
  if (resolving.has(key)) return new Set(); // a cycle (none in vanilla) ends here instead of recursing
  const file = `data/minecraft/tags/${kind}/${name}.json`;
  if (!hasEntry(file, jar)) throw new Error(`no ${kind} tag ${name} in ${jar}`);
  const out = new Set<string>();
  resolving.add(key);
  try {
    readTag(kind, file, out, jar);
  } finally {
    resolving.delete(key);
  }
  tags.set(key, out); // cached only once complete: a read that throws leaves nothing behind
  return out;
}

function readTag(kind: TagKind, file: string, out: Set<string>, jar: string) {
  const { values = [] } = readJson<{ values?: Array<string | { id: string; required?: boolean }> }>(file, jar);
  for (const v of values) {
    const id = typeof v === 'string' ? v : v.id;
    if (id.startsWith('#')) {
      const inner = stripNs(id.slice(1));
      if (!id.startsWith('#minecraft:') && id.includes(':')) continue; // another namespace's tag: none in vanilla
      if (typeof v !== 'string' && v.required === false && !hasEntry(`data/minecraft/tags/${kind}/${inner}.json`, jar)) continue;
      for (const m of tag(kind, inner, jar)) out.add(m);
    } else if (!id.includes(':') || id.startsWith('minecraft:')) out.add(stripNs(id));
  }
}

/** A block tag's members (see `tag`). */
export const blockTag = (name: string, jar = DEFAULT_JAR) => tag('block', name, jar);

/** An item tag's members (see `tag`). */
export const itemTag = (name: string, jar = DEFAULT_JAR) => tag('item', name, jar);

/**
 * The pool of human first names for village members (the user's, 10-18 s36): 50 names, each a valid Minecraft username
 * (3-16 letters), none clashing with Mayor, Gus, Worker1-24 or the user's own account. All are on the whitelist of every
 * world (main, test 1, test 2). Since s38 (#11) the workers log in under them: worker N is NAME_POOL[N - 1] (the scripts
 * read the same list, scripts/agent_names.py); the Mayor stays Mayor and Gus stays Gus.
 */
export const NAME_POOL: readonly string[] = [
  'Ada', 'Ben', 'Clara', 'Dev', 'Elena', 'Finn', 'Grace', 'Hugo', 'Iris', 'Jonah',
  'Kai', 'Lena', 'Milo', 'Nora', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tess',
  'Uma', 'Victor', 'Wren', 'Xavier', 'Yara', 'Zane', 'Amara', 'Bruno', 'Cleo', 'Dante',
  'Eva', 'Felix', 'Gemma', 'Hamid', 'Ines', 'Jasper', 'Keiko', 'Leo', 'Maya', 'Nico',
  'Olivia', 'Pablo', 'Rhea', 'Silas', 'Tomas', 'Ursula', 'Vera', 'Wes', 'Yusuf', 'Zoe',
];

/** Worker N's username (from 1). */
export const workerName = (n: number): string => NAME_POOL[n - 1] ?? `Worker${n}`;

/**
 * A worker's number (from 1) by its name: its place in the pool, or N for the old WorkerN names (villages saved before
 * s38, the goldens' frozen inputs); 0 for any other name (the Mayor, Gus).
 */
export function workerNumber(name: string): number {
  const n = name.trim().toLowerCase();
  const i = NAME_POOL.findIndex((p) => p.toLowerCase() === n);
  if (i >= 0) return i + 1;
  const m = /^worker(\d+)$/.exec(n);
  return m ? Number(m[1]) : 0;
}

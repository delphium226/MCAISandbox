/**
 * The house programs' sandbox (#175): a model's program runs in node:vm in a context with a null-prototype global (no
 * `this.constructor` path to the server's Function), no code generation from strings, a time cap and caps on its length
 * and calls. The library inside the context only records calls as JSON; the caller reads them back as a string, so
 * nothing the program builds ever reaches the server's scope. No imports beyond node's own: houseProgramWorker.ts loads
 * this file alone.
 *
 * In the world (MC_HOME_DESIGN=program) a program runs in a worker thread as well (runProgramIsolated): vm shares the
 * heap and the event loop, so a program allocating a huge string within its time cap could exhaust the server's memory.
 * The worker has its own small heap (resourceLimits) and is terminated after a hard timeout, whatever the program does.
 */
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';

// (calls 400: a sculpture, sculpture.ts, is drawn block by block, and a figure's details are a call each)
export const PROGRAM_LIMITS = { chars: 4000, calls: 400, ms: 200, unknownRetries: 6 };
/** The worker's limits: its heap (MB), and how long it may live from its start (the vm caps run inside it). */
export const WORKER_LIMITS = { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 8, codeRangeSizeMb: 8, stackSizeMb: 2, timeoutMs: 3000 };
export const LIBRARY_NAMES = ['house', 'body', 'wing', 'tower', 'bay', 'porch', 'chimney', 'roof', 'walls', 'base', 'frame', 'windows', 'shutters', 'door', 'note',
  // (the talk build's sculptures, sculpture.ts: a figure block by block)
  'block', 'box', 'plinth'];

/** The library inside the context: each function records its call (as JSON, inside the time cap) and returns the API, so
 *  chained calls work too. Natives are captured before the program runs. */
function libraryScript(extra: string[]): string {
  const names = [...LIBRARY_NAMES, ...extra];
  return `(() => {
  const stringify = JSON.stringify, S = String, calls = [], cap = ${PROGRAM_LIMITS.calls};
  let n = 0, failure = null;
  const api = {};
  const record = (name) => function (...args) {
    if (++n > cap) throw new Error('more than ' + cap + ' calls');
    calls[calls.length] = stringify([name, ...args]);
    return api;
  };
  for (const name of ${JSON.stringify(names)}) { api[name] = record(name); globalThis[name] = api[name]; }
  globalThis.__fail = (e) => { failure = S(e && e.message !== undefined ? e.message : e).slice(0, 300); };
  globalThis.__finish = () => stringify({ calls, failure });
})();`;
}

export interface ProgramRun {
  /** The calls the program made, in order (JSON-parsed). */
  calls: Array<[string, ...unknown[]]>;
  /** A syntax or runtime error, or a cap hit; the calls before it are kept. */
  error?: string;
  /** Names the program called that the library lacks (each run again with a stub that ignores it). */
  unknown: string[];
}

/** Run a program in the sandbox, in this thread. Unknown names are stubbed and the program run again (up to
 *  unknownRetries). */
export function runProgram(code: string): ProgramRun {
  if (code.length > PROGRAM_LIMITS.chars) return { calls: [], error: `the program is ${code.length} characters (at most ${PROGRAM_LIMITS.chars})`, unknown: [] };
  try {
    new vm.Script(code, { filename: 'house.js' });
  } catch (e) {
    return { calls: [], error: `syntax: ${(e as Error).message}`, unknown: [] };
  }
  const unknown: string[] = [];
  for (let attempt = 0; ; attempt++) {
    // (microtasks run inside the time cap: a promise loop would otherwise run on the server's own queue)
    const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
    let out: unknown;
    try {
      vm.runInContext(libraryScript(unknown), ctx, { timeout: PROGRAM_LIMITS.ms });
      vm.runInContext(`try {\n${code}\n} catch (e) { __fail(e) }`, ctx, { timeout: PROGRAM_LIMITS.ms, filename: 'house.js' });
      out = vm.runInContext('__finish()', ctx, { timeout: PROGRAM_LIMITS.ms });
    } catch {
      // (a host-side error: the time cap, or the program's own catch replaced; its value is never read)
      return { calls: [], error: `the program did not finish within ${PROGRAM_LIMITS.ms} ms`, unknown };
    }
    if (typeof out !== 'string') return { calls: [], error: 'the library was replaced', unknown };
    let parsed: { calls: string[]; failure: string | null };
    try {
      parsed = JSON.parse(out);
      if (!Array.isArray(parsed.calls)) throw new Error('no calls');
    } catch {
      return { calls: [], error: 'the library was replaced', unknown };
    }
    const calls: ProgramRun['calls'] = [];
    for (const c of parsed.calls) {
      try {
        const v = JSON.parse(String(c));
        if (Array.isArray(v) && typeof v[0] === 'string') calls.push(v as [string, ...unknown[]]);
      } catch { /* (a value JSON could not hold) */ }
    }
    const missing = /^(\w+) is not defined$/.exec(parsed.failure ?? '')?.[1];
    if (missing && attempt < PROGRAM_LIMITS.unknownRetries && !unknown.includes(missing)) {
      unknown.push(missing);
      continue;
    }
    return { calls, unknown, ...(parsed.failure ? { error: parsed.failure } : {}) };
  }
}

/**
 * runProgram in a worker thread of its own (houseProgramWorker.ts), never throws: the worker's heap is capped
 * (WORKER_LIMITS), it is terminated past timeoutMs, and anything it sends back is checked for shape. One worker a program
 * (a few a street), so nothing a program leaves behind outlives it.
 */
export function runProgramIsolated(code: string, limits = WORKER_LIMITS): Promise<ProgramRun> {
  if (code.length > PROGRAM_LIMITS.chars) return Promise.resolve({ calls: [], error: `the program is ${code.length} characters (at most ${PROGRAM_LIMITS.chars})`, unknown: [] });
  return new Promise((resolve) => {
    let done = false;
    let worker: Worker;
    const finish = (r: ProgramRun) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker?.terminate().catch(() => {});
      resolve(r);
    };
    const timer = setTimeout(() => finish({ calls: [], error: `the program's worker did not finish within ${limits.timeoutMs} ms`, unknown: [] }), limits.timeoutMs);
    try {
      const { timeoutMs: _t, ...resourceLimits } = limits;
      void _t;
      worker = new Worker(new URL('./houseProgramWorker.ts', import.meta.url), { workerData: { code }, resourceLimits, stdout: true, stderr: true });
    } catch (e) {
      finish({ calls: [], error: `no worker: ${(e as Error).message}`, unknown: [] });
      return;
    }
    worker.once('message', (m: unknown) => {
      const r = m as ProgramRun;
      const ok = r && Array.isArray(r.calls) && Array.isArray(r.unknown) && r.calls.every((c) => Array.isArray(c) && typeof c[0] === 'string')
        && r.unknown.every((u) => typeof u === 'string') && (r.error === undefined || typeof r.error === 'string');
      finish(ok ? { calls: r.calls, unknown: r.unknown, ...(r.error ? { error: r.error } : {}) } : { calls: [], error: 'the worker sent back something else', unknown: [] });
    });
    worker.once('error', (e: Error & { code?: string }) => finish({ calls: [], error: e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'the program ran out of memory' : `the program's worker failed: ${e.message.slice(0, 120)}`, unknown: [] }));
    worker.once('exit', (c) => finish({ calls: [], error: `the program's worker exited (${c})`, unknown: [] }));
  });
}

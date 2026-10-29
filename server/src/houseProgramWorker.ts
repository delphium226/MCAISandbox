/**
 * A house program's worker thread (houseSandbox.ts runProgramIsolated): runs the one program it is given in the vm
 * sandbox and posts back its calls. Its heap is capped by the caller's resourceLimits and the caller terminates it.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { runProgram } from './houseSandbox';

const code = typeof workerData?.code === 'string' ? workerData.code : '';
parentPort?.postMessage(runProgram(code));

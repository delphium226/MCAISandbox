import { parentPort, workerData } from 'node:worker_threads';
import { WorldGenerator } from '../../shared/src/worldgen';

const gen = new WorldGenerator(workerData.seed as number);

parentPort!.on('message', (msg: { id: number; cx: number; cz: number }) => {
  const chunk = gen.generate(msg.cx, msg.cz);
  const blocks = chunk.blocks;
  const biomes = chunk.biomes;
  parentPort!.postMessage({ id: msg.id, cx: msg.cx, cz: msg.cz, blocks, biomes }, [blocks.buffer as ArrayBuffer, biomes.buffer as ArrayBuffer]);
});

import { Mesher, setTextureLayers, MeshJob, MeshResult, MeshBuffers } from './mesher';

const mesher = new Mesher();

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'init') {
    setTextureLayers(msg.layers);
    return;
  }
  if (msg.type === 'mesh') {
    const job = msg.job as MeshJob;
    const result: MeshResult = mesher.mesh(job);
    const bufs = (m: MeshBuffers) => [m.pos.buffer, m.tex.buffer, m.light.buffer, m.color.buffer, m.index.buffer];
    (self as unknown as Worker).postMessage({ type: 'mesh', id: msg.id, result }, [...bufs(result.opaque), ...bufs(result.translucent)] as Transferable[]);
  }
};

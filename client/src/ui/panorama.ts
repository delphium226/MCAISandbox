import { World } from '../../../shared/src/world';
import { WorldGenerator } from '../../../shared/src/worldgen';
import { Renderer, DEFAULT_SETTINGS } from '../render/renderer';

/**
 * Minecraft-style rotating title-screen panorama. The world is generated locally with the shared
 * generator (no server needed) and rendered with the full shader pipeline on its own canvas.
 */
export class Panorama {
  private canvas: HTMLCanvasElement;
  private renderer: Renderer | null = null;
  private raf = 0;
  private stopped = false;
  private yaw = 0;
  private last = performance.now();

  constructor(seed = 20260925) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'panorama';
    Object.assign(this.canvas.style, { position: 'fixed', inset: '0', zIndex: '1', width: '100%', height: '100%', filter: 'blur(1.5px) brightness(0.9)', transform: 'scale(1.03)' });
    document.body.insertBefore(this.canvas, document.body.firstChild);
    // Generate the world in small batches so the page stays responsive
    const world = new World();
    const gen = new WorldGenerator(seed);
    const spawn = gen.findSpawn();
    const cx0 = Math.floor(spawn.x) >> 4, cz0 = Math.floor(spawn.z) >> 4;
    const R = 5;
    const coords: [number, number][] = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dz * dz <= R * R + 1) coords.push([cx0 + dx, cz0 + dz]);
    coords.sort((a, b) => (a[0] - cx0) ** 2 + (a[1] - cz0) ** 2 - ((b[0] - cx0) ** 2 + (b[1] - cz0) ** 2));
    try {
      this.renderer = new Renderer(this.canvas, world, { ...DEFAULT_SETTINGS, viewDistance: R, shadowSize: 1024, reflections: true });
    } catch (e) {
      console.warn('Panorama unavailable', e);
      return;
    }
    const cam = this.renderer.camera;
    cam.position.set(spawn.x, spawn.y + 18, spawn.z);
    this.renderer.setTime(2300);
    const step = () => {
      if (this.stopped) return;
      const t0 = performance.now();
      while (coords.length && performance.now() - t0 < 12) {
        const [cx, cz] = coords.shift()!;
        const c = gen.generate(cx, cz);
        world.addChunk(c);
        this.renderer!.chunks.markAround(cx, cz);
      }
      if (coords.length) setTimeout(step, 0);
    };
    step();
    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  private onResize = () => this.renderer?.resize(window.innerWidth, window.innerHeight);

  private loop = () => {
    if (this.stopped || !this.renderer) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.yaw += dt * 0.035;
    const cam = this.renderer.camera;
    cam.rotation.set(-0.22, this.yaw, 0, 'YXZ');
    this.renderer.render(dt);
  };

  dispose() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    if (this.renderer) {
      this.renderer.chunks.dispose();
      this.renderer.renderer.dispose();
      this.renderer.renderer.forceContextLoss();
    }
    this.canvas.remove();
  }
}

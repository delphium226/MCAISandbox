import * as THREE from 'three';
import { World } from '../../../shared/src/world';
import { ItemStack } from '../../../shared/src/items';
import { EntityRenderer, RenderEntity } from '../render/entityRenderer';
import { ItemModels } from '../render/itemModels';

/** Small live 3D render of the local player for the inventory screen (looks towards the mouse). */
export class PlayerPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 51 / 72, 0.1, 20);
  private ents: EntityRenderer;
  private model: RenderEntity | null = null;
  private el: HTMLElement | null = null;
  private raf = 0;
  private mouse = { x: 0, y: 0 };
  private abort = new AbortController();

  constructor(world: World, items: ItemModels, private skin: number) {
    this.ents = new EntityRenderer(this.scene, world, items);
    this.ents.preview = true;
    this.camera.position.set(0, 1.0, -5.0);
    this.camera.lookAt(0, 0.92, 0);
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    }, { signal: this.abort.signal });
  }

  attach(el: HTMLElement, held: ItemStack | null) {
    this.detach();
    this.el = el;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    const canvas = this.renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.imageRendering = 'pixelated';
    el.appendChild(canvas);
    if (!this.model) this.model = this.ents.add({ id: 1, kind: 'player', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, skin: this.skin });
    void held;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  detach() {
    cancelAnimationFrame(this.raf);
    if (this.renderer && this.el?.contains(this.renderer.domElement)) this.el.removeChild(this.renderer.domElement);
    this.el = null;
  }

  /** Tear down: stop rendering, remove listeners and release the WebGL context. */
  dispose() {
    this.detach();
    this.abort.abort();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
  }

  private frame() {
    if (!this.el || !this.renderer || !this.model || !this.el.isConnected) return this.detach();
    const r = this.el.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width / 2)), h = Math.max(1, Math.round(r.height / 2));
    if (this.renderer.domElement.width !== w) this.renderer.setSize(w, h, false);
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.3;
    const yaw = Math.atan((this.mouse.x - cx) / 120);
    const pitch = Math.atan((cy - this.mouse.y) / 160);
    const m = this.model;
    m.target.set(0, 0, 0);
    m.pos.set(0, 0, 0);
    m.targetYaw = yaw;
    m.bodyYaw = Math.atan((this.mouse.x - cx) / 400);
    m.targetPitch = pitch;
    this.ents.frame(1 / 60, this.camera.position);
    m.light.set(1, 0);
    this.renderer.render(this.scene, this.camera);
  }
}

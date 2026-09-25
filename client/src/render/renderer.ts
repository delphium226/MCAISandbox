import * as THREE from 'three';
import { World } from '../../../shared/src/world';
import { DAY_LENGTH } from '../../../shared/src/constants';
import { buildAtlas, Atlas } from './atlas';
import { ChunkRenderer } from './chunkRenderer';
import * as S from './shaders';
import { Clouds } from './clouds';

export interface GraphicsSettings {
  shadows: boolean;
  shadowSize: number;
  reflections: boolean;
  bloom: boolean;
  godrays: boolean;
  renderScale: number;
  fov: number;
  clouds: boolean;
  viewDistance: number;
}

export const DEFAULT_SETTINGS: GraphicsSettings = {
  shadows: true,
  shadowSize: 2048,
  reflections: true,
  bloom: true,
  godrays: true,
  renderScale: 1,
  fov: 70,
  clouds: true,
  viewDistance: 10,
};

/** Shared uniform objects referenced by every material. */
export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Vector3(1, 1, 1) },
  uMoonColor: { value: new THREE.Vector3(0, 0, 0) },
  uAmbient: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
  uDaylight: { value: 1 },
  uRain: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  uFogStart: { value: 100 },
  uFogEnd: { value: 150 },
  uUnderwater: { value: 0 },
  uAtlas: { value: null as THREE.Texture | null },
  uShadowMap: { value: null as THREE.Texture | null },
  uShadowMap2: { value: null as THREE.Texture | null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowMatrix2: { value: new THREE.Matrix4() },
  uShadowOn: { value: 1 },
  uShadowSize: { value: 2048 },
  uFlicker: { value: 1 },
};

function fullscreenGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

function rawMat(vert: string, frag: string, uniforms: Record<string, THREE.IUniform>, extra: Partial<THREE.ShaderMaterialParameters> = {}) {
  return new THREE.RawShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, glslVersion: THREE.GLSL3, ...extra });
}

function makeTarget(w: number, h: number, depth: boolean, type: THREE.TextureDataType = THREE.HalfFloatType) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: depth,
    stencilBuffer: false,
  });
  if (depth) {
    rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    rt.depthTexture.minFilter = THREE.NearestFilter;
    rt.depthTexture.magFilter = THREE.NearestFilter;
  }
  return rt;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly atlas: Atlas;
  readonly chunks: ChunkRenderer;
  /** Scene for entities, particles, clouds, selection box (rendered after terrain). */
  readonly entityScene = new THREE.Scene();
  /** First-person hand scene with its own camera. */
  readonly handScene = new THREE.Scene();
  readonly handCamera: THREE.PerspectiveCamera;
  settings: GraphicsSettings;
  terrainMat: THREE.RawShaderMaterial;
  transMat: THREE.RawShaderMaterial;
  private shadowMat: THREE.RawShaderMaterial;
  private skyMesh: THREE.Mesh;
  private skyScene = new THREE.Scene();
  private quadScene = new THREE.Scene();
  private quad: THREE.Mesh;
  private orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private rtScene!: THREE.WebGLRenderTarget;
  private rtTrans!: THREE.WebGLRenderTarget;
  private rtComp!: THREE.WebGLRenderTarget;
  private rtBloom: THREE.WebGLRenderTarget[] = [];
  private shadowRT!: THREE.WebGLRenderTarget;
  private shadowRT2!: THREE.WebGLRenderTarget;
  private shadowCam = new THREE.OrthographicCamera(-64, 64, 64, -64, 1, 600);
  private shadowCam2 = new THREE.OrthographicCamera(-220, 220, 220, -220, 1, 900);
  private compositeMat: THREE.RawShaderMaterial;
  private brightMat: THREE.RawShaderMaterial;
  private blurMat: THREE.RawShaderMaterial;
  private finalMat: THREE.RawShaderMaterial;
  readonly clouds: Clouds;
  private frame = 0;
  width = 1;
  height = 1;
  /** Damage flash etc. */
  flash = { color: new THREE.Vector3(0.6, 0, 0), amount: 0 };
  timeOfDay = 0;

  constructor(canvas: HTMLCanvasElement, public world: World, settings: GraphicsSettings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, depth: true });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
    this.handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);

    this.atlas = buildAtlas();
    U.uAtlas.value = this.atlas.texture;

    const terrainUniforms = { ...U, uCutout: { value: 1 } };
    this.terrainMat = rawMat(S.TERRAIN_VERT, S.TERRAIN_FRAG, terrainUniforms);
    this.transMat = rawMat(S.TERRAIN_VERT, S.WATER_FRAG, {
      ...U,
      uSceneColor: { value: null },
      uSceneDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.05 },
      uFar: { value: 1200 },
      uReflections: { value: 1 },
    }, { side: THREE.FrontSide });
    this.shadowMat = rawMat(S.SHADOW_VERT, S.SHADOW_FRAG, { ...U }, { side: THREE.DoubleSide });

    this.chunks = new ChunkRenderer(world, this.atlas.layers, this.terrainMat, this.transMat);

    // Sky
    const fsGeo = fullscreenGeometry();
    this.skyMesh = new THREE.Mesh(fsGeo, rawMat(S.SKY_VERT, S.SKY_FRAG, { ...U, uInvViewProj: { value: new THREE.Matrix4() } }, { depthTest: false, depthWrite: false }));
    this.skyMesh.frustumCulled = false;
    this.skyScene.add(this.skyMesh);

    // Post
    this.compositeMat = rawMat(S.FULLSCREEN_VERT, S.COMPOSITE_FRAG, {
      ...U,
      uScene: { value: null }, uSceneDepth: { value: null }, uTrans: { value: null }, uTransDepth: { value: null },
      uSunScreen: { value: new THREE.Vector2() }, uSunVisible: { value: 0 }, uGodrays: { value: 1 },
      uNear: { value: 0.05 }, uFar: { value: 1200 },
    }, { depthTest: false, depthWrite: false });
    this.brightMat = rawMat(S.FULLSCREEN_VERT, S.BRIGHT_FRAG, { uTex: { value: null }, uThreshold: { value: 1.2 } }, { depthTest: false, depthWrite: false });
    this.blurMat = rawMat(S.FULLSCREEN_VERT, S.BLUR_FRAG, { uTex: { value: null }, uTexel: { value: new THREE.Vector2() }, uOffset: { value: 1 } }, { depthTest: false, depthWrite: false });
    this.finalMat = rawMat(S.FULLSCREEN_VERT, S.FINAL_FRAG, {
      uTex: { value: null }, uBloom: { value: null }, uBloomStrength: { value: 0.35 }, uExposure: { value: 1.0 },
      uVignette: { value: 0.55 }, uSaturation: { value: 1.08 }, uFlash: { value: this.flash.color }, uFlashAmt: { value: 0 }, uTime: U.uTime,
    }, { depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(fsGeo, this.compositeMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.clouds = new Clouds();
    this.entityScene.add(this.clouds.mesh);

    this.createShadowTargets();
    this.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  }

  private createShadowTargets() {
    this.shadowRT?.dispose();
    this.shadowRT2?.dispose();
    const size = this.settings.shadowSize;
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, stencilBuffer: false, type: THREE.UnsignedByteType });
      rt.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
      rt.depthTexture.compareFunction = THREE.LessEqualCompare;
      rt.depthTexture.minFilter = THREE.LinearFilter;
      rt.depthTexture.magFilter = THREE.LinearFilter;
      return rt;
    };
    this.shadowRT = mk();
    this.shadowRT2 = mk();
    U.uShadowMap.value = this.shadowRT.depthTexture;
    U.uShadowMap2.value = this.shadowRT2.depthTexture;
    U.uShadowSize.value = size;
  }

  applySettings(s: GraphicsSettings) {
    const shadowChanged = s.shadowSize !== this.settings.shadowSize;
    this.settings = s;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    if (shadowChanged) this.createShadowTargets();
    this.resize(this.width, this.height);
  }

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.settings.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const pw = Math.max(1, Math.floor(w * dpr)), ph = Math.max(1, Math.floor(h * dpr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handCamera.aspect = w / h;
    this.handCamera.updateProjectionMatrix();
    for (const rt of [this.rtScene, this.rtTrans, this.rtComp, ...this.rtBloom]) rt?.dispose();
    this.rtScene = makeTarget(pw, ph, true);
    this.rtTrans = makeTarget(pw, ph, true);
    this.rtComp = makeTarget(pw, ph, true);
    this.rtBloom = [];
    let bw = pw, bh = ph;
    for (let i = 0; i < 5; i++) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      this.rtBloom.push(makeTarget(bw, bh, false));
    }
    (this.transMat.uniforms.uResolution.value as THREE.Vector2).set(pw, ph);
  }

  /** Update time-of-day lighting uniforms. time in ticks. */
  setTime(time: number) {
    this.timeOfDay = time;
    const t = ((time % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH / DAY_LENGTH;
    const a = t * Math.PI * 2;
    const tilt = 0.35;
    const sun = new THREE.Vector3(Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).normalize();
    U.uSunDir.value.copy(sun);
    const sy = sun.y;
    const day = THREE.MathUtils.smoothstep(sy, -0.18, 0.22);
    U.uDaylight.value = day;
    const warm = THREE.MathUtils.smoothstep(sy, 0.0, 0.4);
    const sunI = THREE.MathUtils.smoothstep(sy, -0.03, 0.1);
    const sc = new THREE.Vector3(1.0, 0.45, 0.18).multiplyScalar(1.0).lerp(new THREE.Vector3(1.0, 0.93, 0.82).multiplyScalar(1.45), warm).multiplyScalar(sunI);
    sc.multiplyScalar(1 - U.uRain.value * 0.7);
    U.uSunColor.value.copy(sc);
    const moonI = THREE.MathUtils.smoothstep(-sy, -0.03, 0.15);
    U.uMoonColor.value.set(0.16, 0.2, 0.32).multiplyScalar(moonI * 0.7);
    const amb = new THREE.Vector3(0.045, 0.06, 0.1).lerp(new THREE.Vector3(0.52, 0.6, 0.74), day);
    // Sunset tint on ambient
    const sunset = Math.max(0, 1 - Math.abs(sy) * 4) * day;
    amb.lerp(new THREE.Vector3(0.62, 0.45, 0.4), sunset * 0.35);
    amb.lerp(new THREE.Vector3(amb.x + amb.y + amb.z, amb.x + amb.y + amb.z, amb.x + amb.y + amb.z).multiplyScalar(0.3), U.uRain.value * 0.6);
    U.uAmbient.value.copy(amb);
  }

  private updateShadows(center: THREE.Vector3) {
    const sun = U.uSunDir.value;
    const L = sun.y >= 0 ? sun.clone() : sun.clone().negate();
    if (L.y < 0.05) {
      U.uShadowOn.value = 0;
      return;
    }
    U.uShadowOn.value = 1;
    const fit = (cam: THREE.OrthographicCamera, rt: THREE.WebGLRenderTarget, half: number, matrix: THREE.Matrix4) => {
      const size = this.settings.shadowSize;
      const texel = (half * 2) / size;
      // Build a light-space basis and snap the centre to texels to avoid shimmering
      const up = Math.abs(L.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(up, L).normalize();
      const up2 = new THREE.Vector3().crossVectors(L, right).normalize();
      let cx = center.dot(right), cy = center.dot(up2);
      cx = Math.round(cx / texel) * texel;
      cy = Math.round(cy / texel) * texel;
      const cz = center.dot(L);
      const snapped = right.clone().multiplyScalar(cx).add(up2.clone().multiplyScalar(cy)).add(L.clone().multiplyScalar(cz));
      cam.position.copy(snapped).addScaledVector(L, 300);
      cam.up.copy(up2);
      cam.lookAt(snapped);
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.near = 1; cam.far = 700;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      matrix.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      this.renderer.setRenderTarget(rt);
      this.renderer.setClearColor(0xffffff, 1);
      this.renderer.clear(true, true, false);
      this.chunks.opaqueScene.overrideMaterial = this.shadowMat;
      this.renderer.render(this.chunks.opaqueScene, cam);
      this.chunks.opaqueScene.overrideMaterial = null;
    };
    fit(this.shadowCam, this.shadowRT, 56, U.uShadowMatrix.value);
    if (this.frame % 3 === 0) fit(this.shadowCam2, this.shadowRT2, 200, U.uShadowMatrix2.value);
  }

  render(dt: number) {
    this.frame++;
    const r = this.renderer;
    const cam = this.camera;
    cam.updateMatrixWorld();
    U.uTime.value += dt;
    U.uCamPos.value.copy(cam.position);
    const vd = this.settings.viewDistance * 16;
    U.uFogEnd.value = vd - 8;
    U.uFogStart.value = vd * 0.72;
    this.terrainMat.uniforms.uCutout.value = 1;
    (this.transMat.uniforms.uReflections as THREE.IUniform).value = this.settings.reflections ? 1 : 0;

    this.chunks.update(cam.position.x, cam.position.z);
    this.chunks.sortForCamera(cam.position);
    this.clouds.update(cam.position, U.uTime.value, this.settings.clouds, vd);

    // Shadows
    if (this.settings.shadows) this.updateShadows(cam.position);
    else U.uShadowOn.value = 0;

    // Sky uniforms
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    (this.skyMesh.material as THREE.RawShaderMaterial).uniforms.uInvViewProj.value.copy(vp).invert();

    // ---- Scene pass ----
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.skyScene, this.orthoCam);
    r.render(this.chunks.opaqueScene, cam);
    r.render(this.entityScene, cam);

    // ---- Translucent pass ----
    const tu = this.transMat.uniforms;
    tu.uSceneColor.value = this.rtScene.texture;
    tu.uSceneDepth.value = this.rtScene.depthTexture;
    tu.uNear.value = cam.near;
    tu.uFar.value = cam.far;
    r.setRenderTarget(this.rtTrans);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.chunks.transScene, cam);

    // ---- Composite ----
    const cu = this.compositeMat.uniforms;
    cu.uScene.value = this.rtScene.texture;
    cu.uSceneDepth.value = this.rtScene.depthTexture;
    cu.uTrans.value = this.rtTrans.texture;
    cu.uTransDepth.value = this.rtTrans.depthTexture;
    cu.uNear.value = cam.near;
    cu.uFar.value = cam.far;
    cu.uGodrays.value = this.settings.godrays ? 1 : 0;
    const sunWorld = cam.position.clone().addScaledVector(U.uSunDir.value, 500);
    const sp = sunWorld.project(cam);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).dot(U.uSunDir.value);
    cu.uSunScreen.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    cu.uSunVisible.value = facing > 0 ? Math.min(1, facing * 2) * THREE.MathUtils.smoothstep(U.uSunDir.value.y, -0.02, 0.12) : 0;
    this.quad.material = this.compositeMat;
    r.setRenderTarget(this.rtComp);
    r.render(this.quadScene, this.orthoCam);
    // First-person hand on top, with its own depth so it never clips into walls
    r.clearDepth();
    this.handCamera.fov = this.settings.fov;
    this.handCamera.updateProjectionMatrix();
    r.render(this.handScene, this.handCamera);

    // ---- Bloom ----
    let bloomTex: THREE.Texture = this.rtBloom[0].texture;
    if (this.settings.bloom) {
      this.brightMat.uniforms.uTex.value = this.rtComp.texture;
      this.quad.material = this.brightMat;
      r.setRenderTarget(this.rtBloom[0]);
      r.render(this.quadScene, this.orthoCam);
      this.quad.material = this.blurMat;
      for (let i = 1; i < this.rtBloom.length; i++) {
        this.blurMat.uniforms.uTex.value = this.rtBloom[i - 1].texture;
        this.blurMat.uniforms.uTexel.value.set(1 / this.rtBloom[i - 1].width, 1 / this.rtBloom[i - 1].height);
        this.blurMat.uniforms.uOffset.value = 1;
        r.setRenderTarget(this.rtBloom[i]);
        r.render(this.quadScene, this.orthoCam);
      }
      for (let i = this.rtBloom.length - 2; i >= 0; i--) {
        this.blurMat.uniforms.uTex.value = this.rtBloom[i + 1].texture;
        this.blurMat.uniforms.uTexel.value.set(1 / this.rtBloom[i + 1].width, 1 / this.rtBloom[i + 1].height);
        this.blurMat.uniforms.uOffset.value = 1.5;
        r.setRenderTarget(this.rtBloom[i]);
        r.render(this.quadScene, this.orthoCam);
      }
      bloomTex = this.rtBloom[0].texture;
    }

    // ---- Final ----
    const fu = this.finalMat.uniforms;
    fu.uTex.value = this.rtComp.texture;
    fu.uBloom.value = bloomTex;
    fu.uBloomStrength.value = this.settings.bloom ? 0.22 : 0;
    fu.uFlashAmt.value = this.flash.amount;
    fu.uExposure.value = U.uUnderwater.value > 0.5 ? 1.25 : 1.0;
    this.quad.material = this.finalMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.orthoCam);
  }

  get info() {
    return this.renderer.info;
  }
}

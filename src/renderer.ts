import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createGeometry } from './shapes';
import { MAX_BODIES, type Sim } from './physics';
import { PALETTES, SHAPE_KINDS, type Backdrop, type PaletteId, type Settings, type ShapeKind } from './settings';
import { normalize, scale, type Vec3, vec3 } from './math';

export type QualityLevel = 'low' | 'medium' | 'high';

const BACKDROPS: Record<Backdrop, { wall: string; bg: string; rim: string }> = {
  charcoal: { wall: '#2a2c33', bg: '#121317', rim: '#4a4d57' },
  navy: { wall: '#1d2b4a', bg: '#0b1222', rim: '#3a4d78' },
  paper: { wall: '#e9e5dc', bg: '#cfcac0', rim: '#bdb7aa' },
};

const FOV = 38;
/** How much bigger than the viewport the front rim is drawn, leaving room for parallax. */
const OVERSCAN = 1.06;

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private material: THREE.MeshPhysicalMaterial;
  private meshes = {} as Record<ShapeKind, THREE.InstancedMesh>;
  private walls: THREE.Mesh;
  private wallMaterial: THREE.MeshStandardMaterial;
  private rim: THREE.LineSegments;
  private key: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private box = { w: 1, h: 1, d: 1 };
  private quality: QualityLevel = 'high';
  private shadowsWanted = true;
  private syncedVersion = -1;
  private colorKey = '';
  private parallax = vec3();
  private matrix = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private scl = new THREE.Vector3();
  private color = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping; // keeps palette colours saturated
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.material = new THREE.MeshPhysicalMaterial({ color: 0xffffff });

    this.wallMaterial = new THREE.MeshStandardMaterial({ side: THREE.BackSide, roughness: 0.92, metalness: 0 });
    this.walls = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.wallMaterial);
    this.walls.receiveShadow = true;
    this.scene.add(this.walls);

    this.rim = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }),
    );
    this.scene.add(this.rim);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x404050, 0.35);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xffffff, 2.6);
    this.key.castShadow = true;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key, this.key.target);

    this.buildMeshes('high');
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.applyPixelRatio();
  }

  setBox(box: { w: number; h: number; d: number }): void {
    this.box = box;
    this.walls.scale.set(box.w, box.h, box.d);
    this.rim.scale.set(box.w, box.h, box.d);
    const half = Math.max(box.w, box.h, box.d) * 0.75;
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -half;
    cam.right = cam.top = half;
    cam.near = 1;
    cam.far = 140;
    cam.updateProjectionMatrix();
  }

  setQuality(level: QualityLevel): void {
    if (level === this.quality) return;
    const detailChanged = (level === 'low') !== (this.quality === 'low');
    this.quality = level;
    this.applyPixelRatio();
    this.applyShadows();
    if (detailChanged) this.buildMeshes(level === 'low' ? 'low' : 'high');
  }

  getQuality(): QualityLevel {
    return this.quality;
  }

  applySettings(s: Settings): void {
    this.material.roughness = s.roughness;
    this.material.metalness = s.metalness;
    this.material.clearcoat = s.clearcoat;
    this.material.clearcoatRoughness = 0.1;
    this.key.intensity = s.lightIntensity;
    this.hemi.intensity = 0.15 + s.lightIntensity * 0.08;
    this.scene.environmentIntensity = s.envIntensity;
    this.shadowsWanted = s.shadows;
    this.applyShadows();
    const bd = BACKDROPS[s.backdrop];
    this.wallMaterial.color.set(bd.wall);
    (this.rim.material as THREE.LineBasicMaterial).color.set(bd.rim);
    this.scene.background = new THREE.Color(bd.bg);
    const key = `${s.palette}`;
    if (key !== this.colorKey) {
      this.colorKey = key;
      this.syncedVersion = -1; // forces a colour refresh on next frame
    }
  }

  /**
   * Places the camera so the box's open front fills the viewport. `tilt` is
   * the gravity direction; with parallax on, the camera leans against it so
   * the box feels like a physical object.
   */
  updateCamera(tilt: Vec3, parallax: boolean, dt: number): void {
    const { h, d } = this.box;
    const dist = (h / 2 / OVERSCAN) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const target = parallax ? vec3(-tilt.x * 1.1, -tilt.y * 0.8, 0) : vec3();
    const k = 1 - Math.exp(-dt / 0.12);
    this.parallax.x += (target.x - this.parallax.x) * k;
    this.parallax.y += (target.y - this.parallax.y) * k;
    this.camera.position.set(this.parallax.x, this.parallax.y, d / 2 + dist);
    this.camera.lookAt(this.parallax.x * 0.4, this.parallax.y * 0.4, -d / 2);
  }

  /** Points the key light. With follow-tilt the light stays put in the "real" world as the box turns. */
  updateLight(gravityDir: Vec3, follow: boolean): void {
    const g = follow ? normalize(gravityDir) : vec3(0, -0.6, -0.8);
    const up = scale(g, -1);
    const dir = normalize(vec3(up.x * 0.75 + 0.25, up.y * 0.75 + 0.3, up.z * 0.4 + 0.85));
    const dist = 60;
    this.key.position.set(dir.x * dist, dir.y * dist, dir.z * dist);
    this.key.target.position.set(0, 0, 0);
  }

  render(sim: Sim, palette: PaletteId, alpha: number): void {
    this.syncInstances(sim, palette, alpha);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }

  private applyPixelRatio(): void {
    const dpr = window.devicePixelRatio || 1;
    const cap = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
  }

  private applyShadows(): void {
    const on = this.shadowsWanted && this.quality !== 'low';
    const size = this.quality === 'high' ? 2048 : 1024;
    this.key.castShadow = on;
    if (this.key.shadow.mapSize.x !== size) {
      this.key.shadow.mapSize.set(size, size);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    for (const k of SHAPE_KINDS) this.meshes[k].castShadow = on;
    this.walls.receiveShadow = on;
    this.material.needsUpdate = true;
    this.wallMaterial.needsUpdate = true;
  }

  private buildMeshes(detail: 'low' | 'high'): void {
    for (const k of SHAPE_KINDS) {
      const old = this.meshes[k];
      if (old) {
        this.scene.remove(old);
        old.geometry.dispose();
        old.dispose();
      }
      const mesh = new THREE.InstancedMesh(createGeometry(k, detail), this.material, MAX_BODIES);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = this.shadowsWanted && this.quality !== 'low';
      mesh.receiveShadow = true;
      mesh.setColorAt(0, this.color.set('#fff'));
      this.meshes[k] = mesh;
      this.scene.add(mesh);
    }
    this.syncedVersion = -1;
  }

  private syncInstances(sim: Sim, palette: PaletteId, alpha: number): void {
    const recolor = sim.version !== this.syncedVersion;
    this.syncedVersion = sim.version;
    const prev = sim.prev;
    const curr = sim.curr;
    const colors = PALETTES[palette];
    const items = sim.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const o = i * 7;
      this.pos.set(
        prev[o] + (curr[o] - prev[o]) * alpha,
        prev[o + 1] + (curr[o + 1] - prev[o + 1]) * alpha,
        prev[o + 2] + (curr[o + 2] - prev[o + 2]) * alpha,
      );
      // Normalised lerp, taking the short way round.
      const sign = prev[o + 3] * curr[o + 3] + prev[o + 4] * curr[o + 4] + prev[o + 5] * curr[o + 5] + prev[o + 6] * curr[o + 6] < 0 ? -1 : 1;
      this.quat
        .set(
          prev[o + 3] + (curr[o + 3] * sign - prev[o + 3]) * alpha,
          prev[o + 4] + (curr[o + 4] * sign - prev[o + 4]) * alpha,
          prev[o + 5] + (curr[o + 5] * sign - prev[o + 5]) * alpha,
          prev[o + 6] + (curr[o + 6] * sign - prev[o + 6]) * alpha,
        )
        .normalize();
      this.scl.setScalar(it.scale);
      this.matrix.compose(this.pos, this.quat, this.scl);
      const mesh = this.meshes[it.kind];
      mesh.setMatrixAt(it.inst, this.matrix);
      if (recolor) mesh.setColorAt(it.inst, pickColor(this.color, colors, it.seed));
    }
    for (const k of SHAPE_KINDS) {
      const mesh = this.meshes[k];
      mesh.count = sim.instCount[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (recolor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

function pickColor(out: THREE.Color, colors: string[], seed: number): THREE.Color {
  if (!colors.length) return out.setHSL(seed, 0.75, 0.55, THREE.SRGBColorSpace);
  out.set(colors[Math.floor(seed * colors.length) % colors.length]);
  // A little per-object variation keeps big piles from looking flat.
  const jitter = ((seed * 9301 + 49297) % 1) - 0.5;
  return out.offsetHSL(0, 0, jitter * 0.06);
}

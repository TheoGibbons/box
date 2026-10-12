import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createGeometry } from './shapes';
import { MAX_BODIES, type Sim } from './physics';
import { PALETTES, SHAPE_KINDS, type Backdrop, type PaletteId, type Settings, type ShapeKind } from './settings';
import { lampDirection, REST_DOWN, type Vec3 } from './math';

export type QualityLevel = 'low' | 'medium' | 'high';

const BACKDROPS: Record<Backdrop, { wall: string; bg: string; rim: string }> = {
  charcoal: { wall: '#3a3d46', bg: '#121317', rim: '#5a5e6a' },
  navy: { wall: '#283960', bg: '#0b1222', rim: '#4a5f90' },
  paper: { wall: '#e9e5dc', bg: '#cfcac0', rim: '#bdb7aa' },
};


export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private material: THREE.MeshPhysicalMaterial;
  private meshes = {} as Record<ShapeKind, THREE.InstancedMesh>;
  private walls: THREE.Mesh;
  private wallMaterial: THREE.MeshStandardMaterial;
  private checker: THREE.Texture;
  private rim: THREE.LineSegments;
  private key: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private fill: THREE.PointLight;
  private box = { w: 1, h: 1, d: 1 };
  private quality: QualityLevel = 'high';
  private shadowsWanted = true;
  private syncedVersion = -1;
  private colorKey = '';
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

    // The projection is replaced every frame by updateCamera's off-axis frustum.
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.material = new THREE.MeshPhysicalMaterial({ color: 0xffffff });

    // shadowSide: the walls have no thickness, so render both faces into the shadow map.
    this.wallMaterial = new THREE.MeshStandardMaterial({
      side: THREE.BackSide,
      shadowSide: THREE.DoubleSide,
      roughness: 0.92,
      metalness: 0,
      // Environment light ignores shadows, so keep it low on the walls or the
      // shadows they throw on each other wash out.
      envMapIntensity: 0.2,
    });
    this.walls = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.wallMaterial);
    this.checker = createCheckerTexture(this.renderer.capabilities.getMaxAnisotropy());
    this.walls.receiveShadow = true;
    this.scene.add(this.walls);

    this.rim = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 }),
    );
    this.scene.add(this.rim);

    // Fills the side walls, which the key light (from the viewer's side) barely reaches.
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x9a9ab0, 0.9);
    this.scene.add(this.hemi);

    // Light coming in through the "window": lights the side walls, which the
    // key light only grazes, and falls off into the corners like a real box.
    this.fill = new THREE.PointLight(0xffffff, 1, 0, 0);
    this.scene.add(this.fill);

    this.key = new THREE.DirectionalLight(0xfff4e6, 2.6); // warm, like a room lamp
    this.key.castShadow = true;
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.04;
    this.scene.add(this.key, this.key.target);

    this.buildMeshes('high');
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.applyPixelRatio();
  }

  setBox(box: { w: number; h: number; d: number }): void {
    this.box = box;
    this.walls.geometry.dispose();
    this.walls.geometry = createWallGeometry(box.w, box.h, box.d);
    this.rim.scale.set(box.w, box.h, box.d);
    this.fill.position.set(0, 0, box.d / 2 + box.d * 0.6);
    const half = Math.hypot(box.w, box.h, box.d) / 2 + 1;
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
    this.hemi.intensity = 0.15 + s.lightIntensity * 0.05;
    this.fill.intensity = 0.12 + s.lightIntensity * 0.1;
    this.scene.environmentIntensity = s.envIntensity;
    this.shadowsWanted = s.shadows;
    this.applyShadows();
    const bd = BACKDROPS[s.backdrop];
    this.wallMaterial.color.set(bd.wall);
    const map = s.walls === 'checker' ? this.checker : null;
    if (this.wallMaterial.map !== map) {
      this.wallMaterial.map = map;
      this.wallMaterial.needsUpdate = true;
    }
    (this.rim.material as THREE.LineBasicMaterial).color.set(bd.rim);
    this.scene.background = new THREE.Color(bd.bg);
    const key = `${s.palette}`;
    if (key !== this.colorKey) {
      this.colorKey = key;
      this.syncedVersion = -1; // forces a colour refresh on next frame
    }
  }

  /**
   * Treats the screen as a window onto the box: the box's open front sits
   * exactly on the screen rectangle and the camera sits at the viewer's eye,
   * with an off-axis frustum through the screen's edges. As the eye moves,
   * the opening stays glued to the bezel while the inside shifts behind it.
   *
   * `eye` is the unit direction from the screen centre to the viewer,
   * `distance` the viewing distance in world units, and `strength` scales the
   * sideways offset (1 = physically accurate).
   */
  updateCamera(eye: Vec3, distance: number, strength: number): void {
    const { w, h, d } = this.box;
    const screenZ = d / 2;
    const ez = Math.max(0.2, eye.z);
    const ex = (eye.x / ez) * distance * strength;
    const ey = (eye.y / ez) * distance * strength;
    this.camera.position.set(ex, ey, screenZ + distance);
    this.camera.quaternion.identity();
    this.camera.updateMatrixWorld();
    const near = distance * 0.5;
    const k = near / distance;
    this.camera.near = near;
    this.camera.far = distance + d + 50;
    this.camera.projectionMatrix.makePerspective(
      (-w / 2 - ex) * k,
      (w / 2 - ex) * k,
      (h / 2 - ey) * k,
      (-h / 2 - ey) * k,
      near,
      this.camera.far,
    );
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  /**
   * Points the key light at the box from a lamp in front of the phone. With
   * follow-tilt the lamp stays put in the room, so tilting the phone changes
   * the angle the light comes in at and the walls throw shadows inside.
   * `down` is the phone's (smoothed) gravity direction.
   */
  updateLight(down: Vec3, follow: boolean): void {
    const dir = lampDirection(follow ? down : REST_DOWN);
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
    this.walls.castShadow = on;
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

/** Target size of one checker square, in world units (about two objects across). */
const CHECKER_TILE = 2.2;

/**
 * The inside of the box (front face culled by BackSide), with UVs in world
 * units so checker squares are square on every wall whatever the box's
 * shape. Squares are fitted to divide the depth exactly, so the side walls
 * get clean rows from the glass to the back.
 */
function createWallGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  // Drop the front (+z) face. It's culled when drawn, but it would still
  // block the lamp in the shadow map now that the walls cast shadows.
  const index = geo.index!;
  const FRONT = 4; // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const kept = Array.from(index.array).filter((_, i) => Math.floor(i / 6) !== FRONT);
  geo.setIndex(kept);
  geo.clearGroups();
  const tile = d / Math.max(1, Math.round(d / CHECKER_TILE));
  const period = tile * 2; // the texture holds 2×2 squares
  const pos = geo.attributes.position;
  const normal = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i) + d / 2; // depth measured from the back wall
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    if (nx > 0.5) uv.setXY(i, z / period, y / period);
    else if (ny > 0.5) uv.setXY(i, x / period, z / period);
    else uv.setXY(i, x / period, y / period);
  }
  uv.needsUpdate = true;
  return geo;
}

/** A 2×2 checker that tints the wall colour: full strength and a darker shade. */
function createCheckerTexture(anisotropy: number): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#8c8c8c';
  ctx.fillRect(0, 0, size / 2, size / 2);
  ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

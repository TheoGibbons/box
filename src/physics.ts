import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { BOUNDING_RADIUS, colliderDesc } from './shapes';
import { SHAPE_KINDS, type ShapeKind, type ShapeMode } from './settings';
import {
  add,
  angleBetween,
  clampIntoBox,
  length,
  normalize,
  rng,
  scale,
  sub,
  vec3,
  type Vec3,
} from './math';

type Rapier = typeof RAPIER_NS;
type Box = { w: number; h: number; d: number };

export const STEP = 1 / 60;
export const MAX_BODIES = 1000;
const WALL = 4; // wall half-thickness; thick walls stop fast bodies tunnelling out
const FLOATS = 7; // x y z qx qy qz qw

export interface Item {
  body: RAPIER_NS.RigidBody;
  kind: ShapeKind;
  /** Instance index within the renderer's mesh for this kind. */
  inst: number;
  scale: number;
  /** Stable random number in [0, 1) used to pick the object's colour. */
  seed: number;
}

interface Pending {
  kind: ShapeKind;
  scale: number;
  seed: number;
}

export interface RayHit {
  point: Vec3;
  normal: Vec3;
}

/**
 * Owns the Rapier world: the box walls, the dynamic objects, and the
 * interpolation buffers the renderer reads from.
 */
export class Sim {
  readonly world: RAPIER_NS.World;
  readonly items: Item[] = [];
  readonly instCount: Record<ShapeKind, number> = { cube: 0, sphere: 0, capsule: 0, cylinder: 0 };
  /** Body transforms before and after the latest step, for render interpolation. */
  prev = new Float32Array(MAX_BODIES * FLOATS);
  curr = new Float32Array(MAX_BODIES * FLOATS);
  /** Average physics step time in ms. */
  stepMs = 0;
  /** Bumped whenever items are added or removed, so the renderer can resync. */
  version = 0;

  private walls: RAPIER_NS.Collider[] = [];
  private glass: RAPIER_NS.Collider | null = null;
  private pending: Pending[] = [];
  private fresh: { p: Vec3; r: number }[] = [];
  private lastWakeGravity: Vec3 = vec3(0, -1, 0);
  private steps = 0;
  private rand = rng(0x5eed);
  private restitution = 0.25;
  private friction = 0.6;

  constructor(
    private R: Rapier,
    private box: Box,
  ) {
    this.world = new R.World({ x: 0, y: -40, z: 0 });
    this.world.timestep = STEP;
    this.buildWalls();
  }

  get bodyCount(): number {
    return this.items.length;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  setBox(box: Box): void {
    this.box = box;
    this.buildWalls();
    for (const it of this.items) {
      const t = it.body.translation();
      const r = BOUNDING_RADIUS[it.kind] * it.scale;
      const c = clampIntoBox(t, box, r);
      if (c.x !== t.x || c.y !== t.y || c.z !== t.z) it.body.setTranslation(c, true);
    }
    this.snapshot(true);
  }

  setGravity(g: Vec3): void {
    this.world.gravity = { x: g.x, y: g.y, z: g.z };
    // Sleeping bodies ignore gravity changes, so wake everything when the
    // direction or strength has moved noticeably.
    const last = this.lastWakeGravity;
    const ratio = length(g) / Math.max(1e-6, length(last));
    if (angleBetween(g, last) > 0.02 || Math.abs(ratio - 1) > 0.05) {
      this.lastWakeGravity = g;
      this.wakeAll();
    }
  }

  setMaterial(restitution: number, friction: number): void {
    this.restitution = restitution;
    this.friction = friction;
    const apply = (c: RAPIER_NS.Collider) => {
      c.setRestitution(restitution);
      c.setFriction(friction);
    };
    this.walls.forEach(apply);
    for (const it of this.items) {
      for (let i = 0; i < it.body.numColliders(); i++) apply(it.body.collider(i));
    }
    this.wakeAll();
  }

  /** Removes every object and spawns `count` fresh ones. */
  respawn(count: number, mode: ShapeMode, size: number): void {
    for (const it of this.items) this.world.removeRigidBody(it.body);
    this.items.length = 0;
    this.pending.length = 0;
    for (const k of SHAPE_KINDS) this.instCount[k] = 0;
    this.version++;
    this.setCount(count, mode, size);
  }

  /** Grows or shrinks the population, keeping existing objects where they are. */
  setCount(count: number, mode: ShapeMode, size: number): void {
    count = Math.min(MAX_BODIES, Math.max(0, Math.round(count)));
    let total = this.items.length + this.pending.length;
    while (total > count && this.pending.length) {
      this.pending.pop();
      total--;
    }
    while (total > count) {
      this.removeLast();
      total--;
    }
    for (; total < count; total++) {
      const kind = mode === 'mixed' ? SHAPE_KINDS[Math.floor(this.rand() * SHAPE_KINDS.length)] : mode;
      this.pending.push({ kind, scale: size * (0.85 + this.rand() * 0.3), seed: this.rand() });
    }
    this.drainPending(Infinity, false);
  }

  step(): void {
    const t0 = performance.now();
    this.drainPending(24, true);
    this.world.step();
    this.fresh.length = 0;
    if (++this.steps % 60 === 0) this.rescueEscapees();
    this.snapshot(false);
    this.stepMs += (performance.now() - t0 - this.stepMs) * 0.1;
  }

  /** Throws everything away from the floor (the side gravity points to). */
  shake(strength = 1): void {
    const g = this.world.gravity;
    const gMag = Math.max(1, length(g));
    const up = normalize(scale(g, -1));
    const k = strength * Math.sqrt(gMag / 40);
    for (const it of this.items) {
      const m = it.body.mass();
      const lift = (8 + this.rand() * 10) * k;
      const v = add(scale(up, lift), scale(this.randomUnit(), 7 * k));
      it.body.applyImpulse(scale(v, m), true);
      it.body.applyTorqueImpulse(scale(this.randomUnit(), m * 0.4 * k), true);
    }
  }

  /** Radial blast at a point on a surface, e.g. where the user tapped. */
  blast(hit: RayHit, radius = 4.5, strength = 1): void {
    const gMag = Math.max(1, length(this.world.gravity));
    const k = strength * Math.sqrt(gMag / 40) * 22;
    for (const it of this.items) {
      const p = it.body.translation();
      const d = sub(p, hit.point);
      const dist = length(d);
      if (dist > radius) continue;
      const falloff = 1 - dist / radius;
      const dir = normalize(add(normalize(d, hit.normal), scale(hit.normal, 0.9)), hit.normal);
      const m = it.body.mass();
      it.body.applyImpulse(scale(dir, m * k * falloff), true);
      it.body.applyTorqueImpulse(scale(this.randomUnit(), m * 0.5 * falloff), true);
    }
  }

  /** Pushes objects near a point along a direction, like a finger stirring them. */
  stir(point: Vec3, velocity: Vec3, radius = 2.8): void {
    for (const it of this.items) {
      const p = it.body.translation();
      const dist = length(sub(p, point));
      if (dist > radius) continue;
      const falloff = 1 - dist / radius;
      it.body.applyImpulse(scale(velocity, it.body.mass() * falloff), true);
    }
  }

  raycast(origin: Vec3, dir: Vec3): RayHit | null {
    const ray = new this.R.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, 500, true, undefined, undefined, this.glass ?? undefined);
    if (!hit) return null;
    return {
      point: add(origin, scale(dir, hit.timeOfImpact)),
      normal: vec3(hit.normal.x, hit.normal.y, hit.normal.z),
    };
  }

  awakeCount(): number {
    let n = 0;
    for (const it of this.items) if (!it.body.isSleeping()) n++;
    return n;
  }

  wakeAll(): void {
    for (const it of this.items) it.body.wakeUp();
  }

  dispose(): void {
    this.world.free();
  }

  private buildWalls(): void {
    for (const c of this.walls) this.world.removeCollider(c, false);
    this.walls.length = 0;
    const { w, h, d } = this.box;
    const R = this.R;
    const slab = (hx: number, hy: number, hz: number, x: number, y: number, z: number) => {
      const desc = R.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z)
        .setRestitution(this.restitution)
        .setFriction(this.friction);
      const c = this.world.createCollider(desc);
      this.walls.push(c);
      return c;
    };
    const ex = w / 2 + WALL * 2;
    const ey = h / 2 + WALL * 2;
    const ez = d / 2 + WALL * 2;
    slab(WALL, ey, ez, -w / 2 - WALL, 0, 0);
    slab(WALL, ey, ez, w / 2 + WALL, 0, 0);
    slab(ex, WALL, ez, 0, -h / 2 - WALL, 0);
    slab(ex, WALL, ez, 0, h / 2 + WALL, 0);
    slab(ex, ey, WALL, 0, 0, -d / 2 - WALL);
    this.glass = slab(ex, ey, WALL, 0, 0, d / 2 + WALL);
  }

  private removeLast(): void {
    const it = this.items.pop();
    if (!it) return;
    this.instCount[it.kind]--;
    this.world.removeRigidBody(it.body);
    this.version++;
  }

  /**
   * Places queued objects where they don't overlap anything. Objects that
   * can't fit yet stay queued and pour in as space frees up. `preferUp`
   * biases placement away from the floor so late arrivals drop in from above.
   */
  private drainPending(max: number, preferUp: boolean): void {
    if (!this.pending.length) return;
    const R = this.R;
    const up = normalize(scale(this.world.gravity, -1));
    let placed = 0;
    let failures = 0;
    const keep: Pending[] = [];
    for (const p of this.pending) {
      if (placed >= max || failures >= 8) {
        keep.push(p);
        continue;
      }
      const r = BOUNDING_RADIUS[p.kind] * p.scale;
      const desc = colliderDesc(R, p.kind, p.scale);
      let spot: { pos: Vec3; rot: RAPIER_NS.Rotation } | null = null;
      for (let attempt = 0; attempt < 40 && !spot; attempt++) {
        const pos = this.randomPointInBox(r, preferUp ? up : null);
        const rot = this.randomRotation();
        if (this.fresh.some((f) => length(sub(f.p, pos)) < f.r + r)) continue;
        if (this.world.intersectionWithShape(pos, rot, desc.shape)) continue;
        spot = { pos, rot };
      }
      if (!spot) {
        failures++;
        keep.push(p);
        continue;
      }
      this.fresh.push({ p: spot.pos, r });
      const body = this.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(spot.pos.x, spot.pos.y, spot.pos.z)
          .setRotation(spot.rot)
          .setLinearDamping(0.08)
          .setAngularDamping(0.25),
      );
      this.world.createCollider(desc.setRestitution(this.restitution).setFriction(this.friction), body);
      const item: Item = { body, kind: p.kind, inst: this.instCount[p.kind]++, scale: p.scale, seed: p.seed };
      this.items.push(item);
      this.writeTransform(this.items.length - 1, item, true);
      placed++;
    }
    this.pending = keep;
    if (placed) this.version++;
  }

  private randomPointInBox(r: number, up: Vec3 | null): Vec3 {
    const { w, h, d } = this.box;
    const hx = Math.max(0, w / 2 - r);
    const hy = Math.max(0, h / 2 - r);
    const hz = Math.max(0, d / 2 - r);
    const pick = () => vec3((this.rand() * 2 - 1) * hx, (this.rand() * 2 - 1) * hy, (this.rand() * 2 - 1) * hz);
    let p = pick();
    if (up) {
      // Keep the sample from the upper part of the box.
      for (let i = 0; i < 6 && p.x * up.x + p.y * up.y + p.z * up.z < 0; i++) p = pick();
    }
    return p;
  }

  private randomRotation(): RAPIER_NS.Rotation {
    // Shoemake's uniform random quaternion.
    const u1 = this.rand();
    const u2 = this.rand() * Math.PI * 2;
    const u3 = this.rand() * Math.PI * 2;
    const a = Math.sqrt(1 - u1);
    const b = Math.sqrt(u1);
    return { x: a * Math.sin(u2), y: a * Math.cos(u2), z: b * Math.sin(u3), w: b * Math.cos(u3) };
  }

  private randomUnit(): Vec3 {
    const z = this.rand() * 2 - 1;
    const t = this.rand() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    return vec3(s * Math.cos(t), s * Math.sin(t), z);
  }

  /** Puts back anything that escaped the box (e.g. after an extreme fling). */
  private rescueEscapees(): void {
    const { w, h, d } = this.box;
    for (const it of this.items) {
      const t = it.body.translation();
      if (Math.abs(t.x) > w / 2 + 0.5 || Math.abs(t.y) > h / 2 + 0.5 || Math.abs(t.z) > d / 2 + 0.5) {
        const r = BOUNDING_RADIUS[it.kind] * it.scale;
        it.body.setTranslation(clampIntoBox(t, this.box, r), true);
        it.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  private snapshot(both: boolean): void {
    const tmp = this.prev;
    this.prev = this.curr;
    this.curr = tmp;
    for (let i = 0; i < this.items.length; i++) this.writeTransform(i, this.items[i], both);
  }

  private writeTransform(i: number, it: Item, both: boolean): void {
    const t = it.body.translation();
    const q = it.body.rotation();
    const o = i * FLOATS;
    const c = this.curr;
    c[o] = t.x;
    c[o + 1] = t.y;
    c[o + 2] = t.z;
    c[o + 3] = q.x;
    c[o + 4] = q.y;
    c[o + 5] = q.z;
    c[o + 6] = q.w;
    if (both) this.prev.set(c.subarray(o, o + FLOATS), o);
  }
}

import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { Sim } from '../src/physics';
import { boxDimensions, vec3 } from '../src/math';

beforeAll(async () => {
  await RAPIER.init();
});

const box = boxDimensions(16 / 9);

function inside(sim: Sim, b: { w: number; h: number; d: number }, slack = 0.6): boolean {
  return sim.items.every((it) => {
    const t = it.body.translation();
    return Math.abs(t.x) < b.w / 2 + slack && Math.abs(t.y) < b.h / 2 + slack && Math.abs(t.z) < b.d / 2 + slack;
  });
}

describe('Sim', () => {
  it('spawns the requested number of objects without overlaps blowing up', () => {
    const sim = new Sim(RAPIER, box);
    sim.respawn(600, 'mixed', 1);
    for (let i = 0; i < 240 && sim.pendingCount; i++) sim.step();
    expect(sim.bodyCount + sim.pendingCount).toBe(600);
    expect(sim.bodyCount).toBe(600);
    for (let i = 0; i < 120; i++) sim.step();
    expect(inside(sim, box)).toBe(true);
    sim.dispose();
  });

  it('keeps instance indices dense per shape when the count changes', () => {
    const sim = new Sim(RAPIER, box);
    sim.respawn(300, 'mixed', 1);
    sim.setCount(120, 'mixed', 1);
    sim.setCount(200, 'mixed', 1);
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.bodyCount).toBe(200);
    for (const kind of ['cube', 'sphere', 'capsule', 'cylinder'] as const) {
      const insts = sim.items.filter((it) => it.kind === kind).map((it) => it.inst).sort((a, b) => a - b);
      expect(insts).toEqual(insts.map((_, i) => i));
      expect(sim.instCount[kind]).toBe(insts.length);
    }
    sim.dispose();
  });

  it('settles objects onto the floor gravity points at', () => {
    const sim = new Sim(RAPIER, box);
    sim.respawn(200, 'sphere', 1);
    sim.setGravity(vec3(0, -40, 0));
    for (let i = 0; i < 300; i++) sim.step();
    const avgY = sim.items.reduce((s, it) => s + it.body.translation().y, 0) / sim.bodyCount;
    expect(avgY).toBeLessThan(-box.h / 4);
    // Flip gravity: sleeping bodies must wake up and fall the other way.
    sim.setGravity(vec3(0, 40, 0));
    for (let i = 0; i < 300; i++) sim.step();
    const avgY2 = sim.items.reduce((s, it) => s + it.body.translation().y, 0) / sim.bodyCount;
    expect(avgY2).toBeGreaterThan(box.h / 4);
    sim.dispose();
  });

  it('survives shaking, blasting and the box shrinking', () => {
    const sim = new Sim(RAPIER, box);
    sim.respawn(400, 'mixed', 1.2);
    for (let i = 0; i < 60; i++) sim.step();
    sim.shake(10);
    const hit = sim.raycast(vec3(0, 0, 50), vec3(0, 0, -1));
    expect(hit).not.toBeNull();
    sim.blast(hit!, 6, 3);
    for (let i = 0; i < 60; i++) sim.step();
    const portrait = boxDimensions(9 / 19.5);
    sim.setBox(portrait);
    for (let i = 0; i < 180; i++) sim.step();
    expect(inside(sim, portrait, 1)).toBe(true);
    sim.dispose();
  });

  it('ignores the front glass when ray casting from the camera', () => {
    const sim = new Sim(RAPIER, box);
    sim.respawn(100, 'cube', 1);
    sim.step();
    const hit = sim.raycast(vec3(0, 0, 50), vec3(0, 0, -1));
    expect(hit!.point.z).toBeLessThan(box.d / 2);
    sim.dispose();
  });
});

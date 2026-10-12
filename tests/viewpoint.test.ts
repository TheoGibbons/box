import { describe, expect, it } from 'vitest';
import { Viewpoint } from '../src/viewpoint';
import { gyroVote, rotateX, rotateZ, vec3 } from '../src/math';

const DT = 1 / 60;

describe('Viewpoint (gyro)', () => {
  it('starts looking straight on', () => {
    const v = new Viewpoint();
    expect(v.eye.z).toBeCloseTo(1, 6);
  });

  it('turning the right edge away puts the viewer to the left', () => {
    const v = new Viewpoint();
    v.recenterTime = 1e9; // no recentering, just integration
    for (let i = 0; i < 30; i++) v.rotate(vec3(0, 0.5, 0), DT); // +y, 0.25 rad total
    expect(v.eye.x).toBeCloseTo(-Math.sin(0.25), 3);
    expect(v.eye.y).toBeCloseTo(0, 6);
  });

  it('tipping the top edge away puts the viewer below (the screen now faces up)', () => {
    const v = new Viewpoint();
    v.recenterTime = 1e9;
    for (let i = 0; i < 30; i++) v.rotate(vec3(-0.5, 0, 0), DT);
    expect(v.eye.y).toBeCloseTo(-Math.sin(0.25), 3);
  });

  it('drifts back to straight on when the phone is held still', () => {
    const v = new Viewpoint();
    for (let i = 0; i < 30; i++) v.rotate(vec3(0, 0.8, 0), DT);
    expect(v.eye.x).toBeLessThan(-0.1);
    for (let i = 0; i < 60 * 15; i++) v.rotate(vec3(), DT);
    expect(v.eye.z).toBeCloseTo(1, 3);
  });

  it('caps extreme rotations', () => {
    const v = new Viewpoint();
    v.recenterTime = 1e9;
    for (let i = 0; i < 120; i++) v.rotate(vec3(0, 3, 0), DT);
    expect(Math.acos(v.eye.z)).toBeLessThanOrEqual((40 * Math.PI) / 180 + 1e-6);
  });
});

describe('Viewpoint (gravity fallback)', () => {
  it('agrees with the gyro path for a forward tilt', () => {
    const g0 = vec3(0, -0.8, -0.6);
    const angle = 0.2;
    const gyro = new Viewpoint();
    gyro.recenterTime = 1e9;
    for (let i = 0; i < 20; i++) gyro.rotate(vec3(angle / (20 * DT), 0, 0), DT);

    const grav = new Viewpoint();
    grav.recenterTime = 1e9;
    grav.fromGravity(g0, DT);
    // A world-fixed vector seen from a device rotated by +angle about x turns by -angle.
    grav.fromGravity(rotateX(g0, -angle), DT);

    expect(grav.eye.x).toBeCloseTo(gyro.eye.x, 3);
    expect(grav.eye.y).toBeCloseTo(gyro.eye.y, 3);
    expect(grav.eye.z).toBeCloseTo(gyro.eye.z, 3);
  });
});

describe('Viewpoint (pointer)', () => {
  it('follows the mouse like a moving head', () => {
    const v = new Viewpoint();
    for (let i = 0; i < 120; i++) v.fromPointer(1, -1, DT);
    expect(v.eye.x).toBeGreaterThan(0.2);
    expect(v.eye.y).toBeGreaterThan(0.2);
  });
});

describe('gyroVote', () => {
  const g = vec3(0, -1, 0);
  const dt = 0.016;
  // Turning the phone at +2 rad/s about z makes world-fixed gravity turn the other way.
  const gNow = rotateZ(g, -2 * dt);
  it('agrees when the reported rotation explains the gravity change', () => {
    expect(gyroVote(vec3(0, 0, 2), g, gNow, dt)).toBeGreaterThan(0.99);
  });
  it('disagrees when the sign is flipped', () => {
    expect(gyroVote(vec3(0, 0, -2), g, gNow, dt)).toBeLessThan(-0.99);
  });
  it('abstains when barely moving', () => {
    expect(gyroVote(vec3(0, 0, 0.1), g, g, dt)).toBeNull();
  });
});

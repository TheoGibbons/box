import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { decideGyroMapping, GYRO_MAPPINGS, gyroToOmega, gyroVote, normalize, vec3, type GyroMapping } from '../src/math';

const DEG = 180 / Math.PI;
const DT = 1 / 60;

/** Simulates a phone wobbling in the hand and returns what each layout would conclude. */
function detect(layout: GyroMapping, sign: 1 | -1 = 1) {
  const votes: Record<GyroMapping, number[]> = { spec: [], webkit: [] };
  const g = new Vector3(0, -0.8, -0.6).normalize();
  const q = new Quaternion();
  for (let i = 0; i < 600; i++) {
    const t = i * DT;
    // True angular velocity about device x/y/z, rad/s: a mix of all axes.
    const w = new Vector3(Math.sin(t * 2.1) * 1.4, Math.cos(t * 1.3) * 1.6, Math.sin(t * 0.7) * 0.9);
    const prev = vec3(g.x, g.y, g.z);
    // Gravity is fixed in the world, so in the device frame it turns by -w.
    const rate = w.length();
    if (rate > 0) g.applyQuaternion(q.setFromAxisAngle(w.clone().normalize(), -rate * DT));
    const now = vec3(g.x, g.y, g.z);
    const reported =
      layout === 'spec'
        ? { alpha: w.z * DEG * sign, beta: w.x * DEG * sign, gamma: w.y * DEG * sign }
        : { alpha: w.x * DEG * sign, beta: w.y * DEG * sign, gamma: w.z * DEG * sign };
    for (const m of GYRO_MAPPINGS) {
      const v = gyroVote(gyroToOmega(reported, m), normalize(prev), normalize(now), DT);
      if (v !== null) votes[m].push(v);
    }
    const decided = decideGyroMapping(votes);
    if (decided) return decided;
  }
  return null;
}

describe('gyroscope layout detection', () => {
  it('recognises the spec layout (Chrome, Android)', () => {
    expect(detect('spec')).toEqual({ mapping: 'spec', sign: 1 });
  });
  it('recognises the WebKit/iOS layout', () => {
    expect(detect('webkit')).toEqual({ mapping: 'webkit', sign: 1 });
  });
  it('recognises a flipped sign', () => {
    expect(detect('webkit', -1)).toEqual({ mapping: 'webkit', sign: -1 });
  });
});

describe('gyroToOmega', () => {
  it('maps iOS side-to-side turning (its y rate, reported in beta) to the y axis', () => {
    expect(gyroToOmega({ alpha: 0, beta: 90, gamma: 0 }, 'webkit')).toMatchObject({ x: 0, y: Math.PI / 2, z: 0 });
  });
  it('maps spec side-to-side turning (gamma) to the y axis', () => {
    expect(gyroToOmega({ alpha: 0, beta: 0, gamma: 90 }, 'spec')).toMatchObject({ x: 0, y: Math.PI / 2, z: 0 });
  });
});

describe('decideGyroMapping', () => {
  it('waits while the evidence is thin or ambiguous', () => {
    expect(decideGyroMapping({ spec: [0.9, 0.9], webkit: [] })).toBeNull();
    expect(decideGyroMapping({ spec: Array(20).fill(0.8), webkit: Array(20).fill(0.75) })).toBeNull();
  });
});

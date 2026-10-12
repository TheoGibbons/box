import { describe, expect, it } from 'vitest';
import {
  angleBetween,
  boxDimensions,
  clampIntoBox,
  decideMotionSign,
  deviceToScreen,
  dragGravity,
  gravityFromOrientation,
  length,
  rng,
  smoothing,
  vec3,
} from '../src/math';

const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
  expect(a.z).toBeCloseTo(b.z, 5);
};

describe('gravityFromOrientation', () => {
  it('points into the screen when the phone lies flat', () => {
    close(gravityFromOrientation(0, 0), vec3(0, 0, -1));
  });
  it('points to the bottom of the screen when held upright', () => {
    close(gravityFromOrientation(90, 0), vec3(0, -1, 0));
  });
  it('points right when the right edge is lowered', () => {
    expect(gravityFromOrientation(0, 30).x).toBeGreaterThan(0.4);
  });
  it('is always a unit vector', () => {
    for (const [b, g] of [[12, 34], [-150, 80], [170, -60]]) {
      expect(length(gravityFromOrientation(b, g))).toBeCloseTo(1, 6);
    }
  });
});

describe('deviceToScreen', () => {
  it('leaves portrait unchanged', () => {
    close(deviceToScreen(vec3(0, -1, 0), 0), vec3(0, -1, 0));
  });
  it('maps landscape (top of phone to the left) so down stays down', () => {
    // Rotated a quarter turn counter-clockwise, real-world down is the device's -x.
    close(deviceToScreen(vec3(-1, 0, 0), 90), vec3(0, -1, 0));
  });
  it('maps the opposite landscape too', () => {
    close(deviceToScreen(vec3(1, 0, 0), 270), vec3(0, -1, 0));
  });
  it('flips upside-down portrait', () => {
    close(deviceToScreen(vec3(0, 1, 0), 180), vec3(0, -1, 0));
  });
});

describe('dragGravity', () => {
  const flat = vec3(0, 0, -1);
  it('dragging right sends things right', () => {
    expect(dragGravity(flat, 50, 0, 0.01).x).toBeGreaterThan(0);
  });
  it('dragging down sends things down', () => {
    expect(dragGravity(flat, 0, 50, 0.01).y).toBeLessThan(0);
  });
  it('rotates by the expected angle and stays normalised', () => {
    const d = dragGravity(flat, 100, 0, 0.005);
    expect(angleBetween(d, flat)).toBeCloseTo(0.5, 5);
    expect(length(d)).toBeCloseTo(1, 6);
  });
});

describe('boxDimensions', () => {
  it('matches the aspect ratio and keeps the area', () => {
    const b = boxDimensions(0.5, 600, 5);
    expect(b.w / b.h).toBeCloseTo(0.5, 6);
    expect(b.w * b.h).toBeCloseTo(600, 6);
    expect(b.d).toBe(5);
  });
  it('clamps absurd aspect ratios', () => {
    expect(boxDimensions(100).w / boxDimensions(100).h).toBeCloseTo(4, 6);
  });
});

describe('clampIntoBox', () => {
  it('pulls outside points back so the radius fits', () => {
    const p = clampIntoBox(vec3(100, -100, 3), { w: 10, h: 20, d: 4 }, 0.5);
    close(p, vec3(4.5, -9.5, 1.5));
  });
});

describe('decideMotionSign', () => {
  it('waits for enough evidence', () => {
    expect(decideMotionSign([0.9, 0.9])).toBeNull();
  });
  it('keeps the spec sign when readings agree', () => {
    expect(decideMotionSign(Array(10).fill(0.95))).toBe(1);
  });
  it('flips when readings disagree', () => {
    expect(decideMotionSign(Array(10).fill(-0.9))).toBe(-1);
  });
  it('ignores weak votes and stays undecided when mixed', () => {
    expect(decideMotionSign([...Array(10).fill(0.1), ...Array(5).fill(0.9)])).toBeNull();
    expect(decideMotionSign([...Array(6).fill(0.9), ...Array(6).fill(-0.9)])).toBeNull();
  });
});

describe('rng', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = rng(42);
    const b = rng(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('smoothing', () => {
  it('is frame-rate independent', () => {
    const once = smoothing(1 / 30, 0.1);
    const twice = 1 - (1 - smoothing(1 / 60, 0.1)) ** 2;
    expect(once).toBeCloseTo(twice, 10);
  });
});

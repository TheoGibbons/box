import { describe, expect, it } from 'vitest';
import { angleBetween, dot, lampDirection, length, normalize, REST_DOWN, REST_LAMP, rotateByArc, vec3 } from '../src/math';

describe('rotateByArc', () => {
  it('takes from onto to', () => {
    const from = normalize(vec3(1, 2, 3));
    const to = normalize(vec3(-2, 0.5, 1));
    const r = rotateByArc(from, from, to);
    expect(angleBetween(r, to)).toBeLessThan(1e-6);
  });
  it('preserves angles between vectors', () => {
    const from = vec3(0, -1, 0);
    const to = normalize(vec3(0.5, -0.2, -0.8));
    const v = normalize(vec3(0.3, 0.4, 0.8));
    expect(dot(rotateByArc(v, from, to), to)).toBeCloseTo(dot(v, from), 10);
  });
  it('handles opposite vectors', () => {
    const r = rotateByArc(vec3(0, 1, 0), vec3(0, 1, 0), vec3(0, -1, 0));
    expect(r.y).toBeCloseTo(-1, 10);
  });
});

describe('lampDirection', () => {
  it('is the rest lamp at the rest pose', () => {
    expect(angleBetween(lampDirection(REST_DOWN), REST_LAMP)).toBeLessThan(1e-9);
  });
  it('keeps a fixed angle to "down", like a lamp fixed in the room', () => {
    const restAngle = angleBetween(REST_LAMP, REST_DOWN);
    for (const down of [vec3(0, 0, -1), vec3(0.5, -0.7, -0.3), vec3(-0.2, -0.95, 0.1)]) {
      expect(angleBetween(lampDirection(down), down)).toBeCloseTo(restAngle, 6);
      expect(length(lampDirection(down))).toBeCloseTo(1, 9);
    }
  });
  it('lowering the right edge moves the light to the left, so the left wall throws a shadow', () => {
    const tilted = normalize(vec3(0.4, -0.75, -0.55));
    expect(lampDirection(tilted).x).toBeLessThan(REST_LAMP.x - 0.2);
  });
  it('tipping the top edge back brings the light down from above', () => {
    const flatter = normalize(vec3(0, -0.4, -0.9));
    expect(lampDirection(flatter).y).toBeLessThan(REST_LAMP.y);
  });
});

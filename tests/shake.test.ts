import { describe, expect, it } from 'vitest';
import { ShakeDetector } from '../src/shake';
import { add, scale, vec3 } from '../src/math';

const resting = vec3(0, 9.81, 0);

describe('ShakeDetector', () => {
  it('recognises opposing acceleration on any axis, including diagonals', () => {
    for (const direction of [vec3(20, 0, 0), vec3(0, 20, 0), vec3(0, 0, 20), vec3(12, 12, 12)]) {
      const detector = new ShakeDetector();
      expect(detector.update(resting, direction, 0)).toBe(false);
      expect(detector.update(resting, scale(direction, -1), 100)).toBe(true);
    }
  });

  it('ignores sensor noise, walking-sized movement and gentle tilts', () => {
    const detector = new ShakeDetector();
    const fallback = new ShakeDetector();
    for (let i = 0; i < 600; i++) {
      const t = i / 60;
      const noise = vec3(8 * Math.sin(t * 8), 0.2, 0.1);
      const angle = t * 0.5;
      const tilted = vec3(9.81 * Math.sin(angle), 9.81 * Math.cos(angle), 0);
      expect(detector.update(tilted, noise, t * 1000)).toBe(false);
      expect(fallback.update(tilted, null, t * 1000)).toBe(false);
    }
  });

  it('ignores one bump and sustained acceleration', () => {
    const detector = new ShakeDetector();
    expect(detector.update(resting, vec3(20, 0, 0), 0)).toBe(false);
    for (let at = 20; at <= 2000; at += 20) {
      expect(detector.update(resting, at < 1000 ? vec3() : vec3(25, 0, 0), at)).toBe(false);
    }
  });

  it('does not combine movements outside the gesture window', () => {
    const detector = new ShakeDetector();
    detector.update(resting, vec3(20, 0, 0), 0);
    detector.update(resting, vec3(), 300);
    expect(detector.update(resting, vec3(-20, 0, 0), 480)).toBe(false);
  });

  it('limits repeated tosses during a continuous shake, then allows another', () => {
    const detector = new ShakeDetector();
    detector.update(resting, vec3(20, 0, 0), 0);
    expect(detector.update(resting, vec3(-20, 0, 0), 100)).toBe(true);
    for (let at = 120; at < 900; at += 20) {
      expect(detector.update(resting, vec3(at % 40 ? 20 : -20, 0, 0), at)).toBe(false);
    }
    expect(detector.update(resting, vec3(20, 0, 0), 900)).toBe(false);
    expect(detector.update(resting, vec3(-20, 0, 0), 1000)).toBe(true);
  });

  it('filters out gravity when linear acceleration is absent or incomplete', () => {
    for (const unavailable of [null, { x: null, y: 0, z: 0 }]) {
      const detector = new ShakeDetector();
      expect(detector.update(resting, unavailable, 0)).toBe(false);
      expect(detector.update(add(resting, vec3(24, 0, 0)), unavailable, 50)).toBe(false);
      expect(detector.update(add(resting, vec3(-24, 0, 0)), unavailable, 150)).toBe(true);
    }
  });

  it('does not mistake an initial gravity reading for movement', () => {
    const detector = new ShakeDetector();
    for (let at = 0; at < 1000; at += 20) {
      expect(detector.update(vec3(0, 0, -9.81), null, at)).toBe(false);
    }
  });

  it('forgets incomplete gestures after stale or invalid readings and explicit reset', () => {
    const detector = new ShakeDetector();
    detector.update(resting, vec3(20, 0, 0), 0);
    expect(detector.update(resting, vec3(-20, 0, 0), 2000)).toBe(false);
    detector.reset();
    expect(detector.update(resting, vec3(20, 0, 0), 2050)).toBe(false);
    expect(detector.update(null, vec3(NaN, 0, 0), 2100)).toBe(false);
    expect(detector.update(null, vec3(-20, 0, 0), 2150)).toBe(false);
  });
});

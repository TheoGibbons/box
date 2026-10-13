import { describe, expect, it } from 'vitest';
import { defaultSettings, LIMITS, MATERIAL_PRESETS, sanitize } from '../src/settings';

const d = defaultSettings(false);

describe('sanitize', () => {
  it('returns defaults for junk', () => {
    expect(sanitize(null, d)).toEqual(d);
    expect(sanitize('nope', d)).toEqual(d);
  });
  it('keeps valid values', () => {
    const s = sanitize({ count: 250, shape: 'sphere', shadows: false, palette: 'ocean' }, d);
    expect(s).toMatchObject({ count: 250, shape: 'sphere', shadows: false, palette: 'ocean' });
  });
  it('clamps numbers into range', () => {
    expect(sanitize({ count: 99999 }, d).count).toBe(LIMITS.count.max);
    expect(sanitize({ gravity: -5 }, d).gravity).toBe(LIMITS.gravity.min);
  });
  it('drops wrong types and unknown enum values', () => {
    const s = sanitize({ count: '300', shape: 'teapot', shadows: 'yes', quality: 'ultra', extra: 1 }, d);
    expect(s).toEqual(d);
  });
  it('rejects non-finite numbers', () => {
    expect(sanitize({ size: NaN, friction: Infinity }, d)).toEqual(d);
  });
  it('defaults fewer objects on mobile', () => {
    expect(defaultSettings(true).count).toBeLessThan(d.count);
  });
  it('defaults to metal, checkerboard walls and half-strength shakes on every device', () => {
    for (const mobile of [false, true]) {
      expect(defaultSettings(mobile)).toMatchObject({
        ...MATERIAL_PRESETS.metal,
        walls: 'checker',
        shakeStrength: 0.5,
      });
    }
  });
  it('keeps older saved preferences and supplies the new shake-strength default', () => {
    const saved = { ...d, ...MATERIAL_PRESETS.plastic, walls: 'plain' };
    const { shakeStrength: _previouslyAbsent, ...legacy } = saved;
    expect(sanitize(legacy, d)).toMatchObject({ ...legacy, shakeStrength: 0.5 });
  });
  it('allows disabling or boosting shakes and clamps saved strength to the slider range', () => {
    expect(sanitize({ shakeStrength: 0 }, d).shakeStrength).toBe(0);
    expect(sanitize({ shakeStrength: 1.25 }, d).shakeStrength).toBe(1.25);
    expect(sanitize({ shakeStrength: -1 }, d).shakeStrength).toBe(LIMITS.shakeStrength.min);
    expect(sanitize({ shakeStrength: 999 }, d).shakeStrength).toBe(LIMITS.shakeStrength.max);
    expect(sanitize({ shakeStrength: Infinity }, d).shakeStrength).toBe(0.5);
  });
});

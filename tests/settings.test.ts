import { describe, expect, it } from 'vitest';
import { defaultSettings, LIMITS, sanitize } from '../src/settings';

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
});

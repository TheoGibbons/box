import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortraitMode } from '../src/portrait';

function environment(type?: OrientationType, lock?: (orientation: 'portrait') => Promise<void>) {
  const orientation = Object.assign(new EventTarget(), { type, lock });
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { fullscreenElement: null as object | null, visibilityState: 'visible' });
  const guard = { hidden: true } as HTMLElement;
  const content = [{ inert: false }, { inert: false }] as HTMLElement[];
  vi.stubGlobal('screen', { orientation: type ? orientation : undefined });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  return { orientation, win, doc, guard, content };
}

afterEach(() => vi.unstubAllGlobals());

describe('PortraitMode', () => {
  it('blocks mobile landscape and restores controls on return to portrait', () => {
    const env = environment('landscape-primary');
    const mode = new PortraitMode(true, env.guard, env.content);
    expect(mode.blocked).toBe(true);
    expect(env.guard.hidden).toBe(false);
    expect(env.content.every((element) => element.inert)).toBe(true);
    env.orientation.type = 'portrait-primary';
    env.orientation.dispatchEvent(new Event('change'));
    expect(mode.blocked).toBe(false);
    expect(env.guard.hidden).toBe(true);
    expect(env.content.every((element) => !element.inert)).toBe(true);
  });

  it('uses physical screen orientation even if a keyboard makes the viewport wide', () => {
    const env = environment('portrait-primary');
    vi.stubGlobal('innerHeight', 300);
    const mode = new PortraitMode(true, env.guard, env.content);
    expect(mode.blocked).toBe(false);
  });

  it('supports legacy orientation and then viewport dimensions as fallbacks', () => {
    const env = environment();
    Object.assign(env.win, { orientation: -90 });
    const mode = new PortraitMode(true, env.guard, env.content);
    expect(mode.blocked).toBe(true);
    Object.assign(env.win, { orientation: 180 });
    env.win.dispatchEvent(new Event('orientationchange'));
    expect(mode.blocked).toBe(false);
    Object.assign(env.win, { orientation: undefined });
    vi.stubGlobal('innerWidth', 844);
    vi.stubGlobal('innerHeight', 390);
    env.win.dispatchEvent(new Event('resize'));
    expect(mode.blocked).toBe(true);
  });

  it('leaves desktop orientation and controls alone', () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const env = environment('landscape-primary', lock);
    const mode = new PortraitMode(false, env.guard, env.content);
    expect(mode.blocked).toBe(false);
    expect(env.guard.hidden).toBe(true);
    expect(lock).not.toHaveBeenCalled();
  });

  it('handles a rejected lock and retries after entering fullscreen', async () => {
    const lock = vi.fn().mockRejectedValueOnce(new Error('Fullscreen required')).mockResolvedValue(undefined);
    const env = environment('landscape-primary', lock);
    const mode = new PortraitMode(true, env.guard, env.content);
    await Promise.resolve();
    expect(mode.blocked).toBe(true);
    expect(lock).toHaveBeenCalledWith('portrait');
    env.doc.fullscreenElement = {};
    env.doc.dispatchEvent(new Event('fullscreenchange'));
    await Promise.resolve();
    expect(lock).toHaveBeenCalledTimes(2);
  });
});

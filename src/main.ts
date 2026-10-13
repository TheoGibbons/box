import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import './style.css';
import { Sim, STEP } from './physics';
import { Renderer, type QualityLevel } from './renderer';
import { MotionInput, type MotionState } from './motion';
import { attachPointer, HeldKeys, isTyping } from './input';
import { UI } from './ui';
import { Viewpoint } from './viewpoint';
import {
  defaultSettings,
  loadSettings,
  MATERIAL_PRESETS,
  saveSettings,
  type Settings,
} from './settings';
import {
  boxDimensions,
  clamp,
  dragGravity,
  length,
  lerpVec,
  normalize,
  scale,
  smoothing,
  vec3,
  type Vec3,
} from './math';

const REST_TILT = normalize(vec3(0, -0.8, -0.6));
const DRAG_SENSITIVITY = 0.0065; // radians per CSS pixel
const KEY_TILT_SPEED = 1.6; // radians per second
const MAX_SUBSTEPS = 4;
/** Rough CSS pixels per physical inch; browsers don't expose the real value. */
const PX_PER_INCH_MOBILE = 150;
const PX_PER_INCH_DESKTOP = 96;
/** Typical eye-to-screen distance in inches. */
const VIEW_INCHES_MOBILE = 12;
const VIEW_INCHES_DESKTOP = 24;
/** Keep the box at least this many object-widths deep. */
const MIN_DEPTH = 2;

async function main(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui') as HTMLElement;
  const loading = document.getElementById('loading') as HTMLElement;

  await RAPIER.init();

  const mobile = matchMedia('(pointer: coarse)').matches;
  const defaults = defaultSettings(mobile);
  let s: Settings = loadSettings(defaults);

  const pxPerInch = mobile ? PX_PER_INCH_MOBILE : PX_PER_INCH_DESKTOP;
  /** World units per real-world inch on this screen. */
  const unitsPerInch = (h: number) => (pxPerInch * h) / innerHeight;
  const computeBox = () => {
    const { w, h } = boxDimensions(innerWidth / innerHeight);
    return { w, h, d: Math.max(MIN_DEPTH, s.depth * unitsPerInch(h)) };
  };
  const viewDistance = () => (mobile ? VIEW_INCHES_MOBILE : VIEW_INCHES_DESKTOP) * unitsPerInch(box.h);

  let box = computeBox();
  const sim = new Sim(RAPIER, box);
  const view = new Renderer(canvas);
  view.setBox(box);
  view.setSize(innerWidth, innerHeight);

  const motion = new MotionInput();
  const viewpoint = new Viewpoint();
  let pointerAt: { x: number; y: number } | null = null;
  const keys = new HeldKeys();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  let tiltDir: Vec3 = { ...REST_TILT };
  let gravity: Vec3 = scale(tiltDir, s.gravity);
  let motionSmooth: Vec3 = vec3(0, -1, 0);
  /** Which way is down for the phone, smoothed so shakes don't flicker the lighting. */
  let pose: Vec3 = { ...REST_TILT };
  let paused = false;
  let acc = 0;
  let last = performance.now();
  let quietUntil = last + 3000; // ignore frame-rate dips while things settle
  let fpsFrames = 0;
  let fpsStart = last;
  let slowWindows = 0;
  let statsText = '';
  let wakeLock: { release(): Promise<void> } | null = null;

  // ---- settings application -------------------------------------------------

  const initialQuality = (): QualityLevel => (s.quality === 'auto' ? (mobile ? 'medium' : 'high') : s.quality);

  function applyAll(): void {
    view.applySettings(s);
    view.setQuality(initialQuality());
    sim.setMaterial(s.bounciness, s.friction);
    motion.invert = s.invertMotion;
    void updateWakeLock();
  }

  let saveTimer = 0;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveSettings(s), 300);
  };

  let countTimer = 0;

  const ui = new UI(
    uiRoot,
    {
      shake: () => shake(),
      togglePause: () => setPaused(!paused),
      reset: () => respawn(),
      level: () => level(),
      toggleMotion: () => void toggleMotion(),
      toggleFullscreen: () => toggleFullscreen(),
      set(key, value, commit) {
        if (s[key] === value && !commit) return;
        s = { ...s, [key]: value };
        persist();
        switch (key) {
          case 'count':
            clearTimeout(countTimer);
            countTimer = window.setTimeout(() => sim.setCount(s.count, s.shape, s.size), commit ? 0 : 120);
            break;
          case 'shape':
            respawn();
            break;
          case 'size':
            if (commit) respawn();
            break;
          case 'bounciness':
          case 'friction':
            sim.setMaterial(s.bounciness, s.friction);
            break;
          case 'quality':
            slowWindows = 0;
            view.setQuality(initialQuality());
            break;
          case 'invertMotion':
            motion.invert = s.invertMotion;
            break;
          case 'depth':
            resizeBox();
            break;
          case 'keepAwake':
            void updateWakeLock();
            break;
          case 'showStats':
            ui.setStats(s.showStats ? statsText || '…' : null);
            break;
          default:
            view.applySettings(s);
        }
        if (commit) ui.sync(s);
      },
      preset(name) {
        s = { ...s, ...MATERIAL_PRESETS[name] };
        if (name === 'rubber') s.bounciness = 0.7;
        sim.setMaterial(s.bounciness, s.friction);
        view.applySettings(s);
        ui.sync(s);
        persist();
      },
      resetSettings() {
        const prev = s;
        s = { ...defaults };
        applyAll();
        if (prev.count !== s.count || prev.shape !== s.shape || prev.size !== s.size) respawn();
        ui.sync(s);
        ui.setStats(null);
        persist();
        ui.toast('Settings restored');
      },
    },
    s,
  );

  // ---- actions --------------------------------------------------------------

  function resizeBox(): void {
    box = computeBox();
    sim.setBox(box);
    view.setBox(box);
  }

  function respawn(): void {
    sim.respawn(s.count, s.shape, s.size);
    quietUntil = performance.now() + 3000;
  }

  function shake(): void {
    if (paused) setPaused(false);
    sim.shake(1);
  }

  function level(): void {
    if (motion.active) {
      ui.toast('Phone motion is steering gravity — turn it off to level the box');
      return;
    }
    tiltDir = { ...REST_TILT };
  }

  function setPaused(p: boolean): void {
    paused = p;
    ui.setPaused(p);
    if (!p) last = performance.now();
  }

  async function toggleMotion(): Promise<void> {
    if (motion.active || motion.state === 'waiting') {
      motion.disable();
      setMotionPref(false);
      ui.toast('Phone motion off — drag to tilt');
      return;
    }
    setMotionPref(true);
    const result = await motion.enable();
    const messages: Partial<Record<MotionState, string>> = {
      waiting: 'Tilt your phone to move everything',
      denied: 'Motion access was denied. Allow it in your browser settings and reload.',
      insecure: 'Phone motion needs the page to be served over HTTPS',
      unsupported: 'No motion sensor found on this device',
    };
    if (messages[result]) ui.toast(messages[result]!, 3500);
  }

  function setMotionPref(on: boolean): void {
    if (s.motion === on) return;
    s = { ...s, motion: on };
    persist();
  }

  /**
   * iOS only grants motion access from inside a user gesture, so "on by
   * default" there means the first tap anywhere asks for it. Taps on the
   * toolbar are left to its own buttons.
   */
  function enableMotionOnFirstTap(): void {
    const handler = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('.toolbar, .panel')) return;
      window.removeEventListener('touchend', handler, true);
      window.removeEventListener('click', handler, true);
      if (motion.state === 'needs-permission') {
        void motion.enable().then((r) => {
          if (r === 'denied') ui.toast('Motion access was denied — drag to tilt instead', 3500);
        });
      }
    };
    window.addEventListener('touchend', handler, true);
    window.addEventListener('click', handler, true);
  }

  function toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }

  async function updateWakeLock(): Promise<void> {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (s.keepAwake && !wakeLock && nav.wakeLock && document.visibilityState === 'visible') {
      try {
        wakeLock = await nav.wakeLock.request('screen');
      } catch {
        wakeLock = null;
      }
    } else if (!s.keepAwake && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      await lock.release().catch(() => {});
    }
  }

  /** Converts a client position to a ray hit inside the box. */
  function pick(x: number, y: number) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, view.camera);
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    return sim.raycast(vec3(o.x, o.y, o.z), vec3(d.x, d.y, d.z));
  }

  function ripple(x: number, y: number): void {
    const r = document.createElement('div');
    r.className = 'ripple';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.append(r);
    r.addEventListener('animationend', () => r.remove());
  }

  // ---- input ----------------------------------------------------------------

  attachPointer(canvas, {
    dragStirs: () => motion.active,
    tilt(dx, dy) {
      if (motion.active) return;
      tiltDir = dragGravity(tiltDir, dx, dy, DRAG_SENSITIVITY);
    },
    poke(x, y) {
      const hit = pick(x, y);
      if (!hit) return;
      if (paused) setPaused(false);
      sim.blast(hit);
      ripple(x, y);
    },
    stir(x, y, vx, vy) {
      const hit = pick(x, y);
      if (!hit) return;
      const unitsPerPx = box.h / canvas.clientHeight;
      let v = vec3(vx * unitsPerPx, -vy * unitsPerPx, 0);
      const speed = length(v);
      if (speed > 40) v = scale(v, 40 / speed);
      sim.stir(hit.point, scale(v, 0.35));
    },
  });

  window.addEventListener('keydown', (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key.toLowerCase()) {
      case ' ':
        e.preventDefault();
        if (!e.repeat) shake();
        break;
      case 'p':
        setPaused(!paused);
        break;
      case 'r':
        respawn();
        break;
      case 'l':
        level();
        break;
      case 'm':
        if (motion.available) void toggleMotion();
        break;
      case 'f':
        toggleFullscreen();
        break;
      case 'h':
        ui.toggleHidden();
        break;
      case 's':
        ui.togglePanel();
        break;
      case 'escape':
        ui.togglePanel(false);
        break;
      default:
        if (e.key.startsWith('Arrow')) e.preventDefault();
    }
  });

  // On desktop the mouse stands in for the viewer's head.
  window.addEventListener('pointermove', (e) => {
    pointerAt = e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : null;
  });
  document.documentElement.addEventListener('pointerleave', () => (pointerAt = null));

  motion.onChange = (state) => {
    if (state === 'on') viewpoint.reset();
    ui.setMotion(state);
  };
  ui.setMotion(motion.state);

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    view.setSize(innerWidth, innerHeight);
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeBox();
    }, 120);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      last = performance.now();
      quietUntil = last + 2000;
      void updateWakeLock();
    } else {
      wakeLock = null; // the browser releases it automatically
    }
  });

  // ---- start ----------------------------------------------------------------

  applyAll();
  respawn();
  view.updateLight(pose, s.lightFollowsTilt);

  if (mobile && s.motion) {
    if (motion.state === 'off') void motion.enable(); // Android: no prompt needed
    else if (motion.state === 'needs-permission') enableMotionOnFirstTap();
  }
  setTimeout(() => {
    if (motion.state === 'needs-permission' && s.motion) ui.toast('Tap anywhere to steer with your phone’s motion', 4000);
    else if (!motion.active) ui.toast(mobile ? 'Drag to tilt · tap to blast' : 'Drag to tilt · click to blast · Space to shake', 4000);
  }, 600);

  loading.classList.add('done');
  loading.addEventListener('transitionend', () => loading.remove());

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    // Arrow keys tilt like a slow drag.
    if (!motion.active) {
      const kx = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
      const ky = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
      if (kx || ky) tiltDir = dragGravity(tiltDir, kx * KEY_TILT_SPEED * dt, ky * KEY_TILT_SPEED * dt, 1);
    }

    let target: Vec3;
    if (motion.active && !motion.isStale()) {
      // A smoothed copy keeps slow tilts steady; the raw reading carries the shakes.
      motionSmooth = lerpVec(motionSmooth, motion.gravity, smoothing(dt, 0.12));
      const boosted = lerpVec(motionSmooth, motion.gravity, s.shakeSensitivity);
      target = scale(boosted, s.gravity);
      const mag = length(target);
      const cap = s.gravity * 4;
      if (mag > cap) target = scale(target, cap / mag);
    } else {
      target = scale(tiltDir, s.gravity);
    }
    gravity = lerpVec(gravity, target, smoothing(dt, motion.active ? 0.02 : 0.05));

    if (!paused) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < MAX_SUBSTEPS) {
        sim.setGravity(gravity);
        sim.step();
        acc -= STEP;
        n++;
      }
      if (n === MAX_SUBSTEPS) acc = 0; // we're behind; drop time rather than spiral
    }
    const alpha = paused ? 1 : clamp(acc / STEP, 0, 1);

    updateViewpoint(dt);
    view.updateCamera(viewpoint.eye, viewDistance(), s.parallax);
    const poseTarget = motion.active && !motion.isStale() ? motionSmooth : tiltDir;
    pose = normalize(lerpVec(pose, normalize(poseTarget), smoothing(dt, 0.15)));
    view.updateLight(pose, s.lightFollowsTilt);
    view.render(sim, s.palette, alpha);

    measure(now);
  }

  function updateViewpoint(dt: number): void {
    if (motion.active && !motion.isStale()) {
      if (motion.rotation) viewpoint.rotate(motion.rotation, dt);
      else viewpoint.fromGravity(motion.gravity, dt);
    } else if (pointerAt) {
      viewpoint.fromPointer((pointerAt.x / innerWidth) * 2 - 1, (pointerAt.y / innerHeight) * 2 - 1, dt);
    } else {
      viewpoint.center(dt);
    }
  }

  function measure(now: number): void {
    fpsFrames++;
    const elapsed = now - fpsStart;
    if (elapsed < 1000) return;
    const fps = (fpsFrames * 1000) / elapsed;
    fpsFrames = 0;
    fpsStart = now;

    if (s.quality === 'auto' && now > quietUntil && !paused) {
      slowWindows = fps < 45 ? slowWindows + 1 : 0;
      const q = view.getQuality();
      if (slowWindows >= 2 && q !== 'low') {
        const next: QualityLevel = q === 'high' ? 'medium' : 'low';
        view.setQuality(next);
        slowWindows = 0;
        quietUntil = now + 3000;
        ui.toast(`Lowered quality to ${next} to keep things smooth`);
      } else if (slowWindows >= 2 && q === 'low' && s.count > 200) {
        slowWindows = 0;
        quietUntil = now + 10000;
        ui.toast('Still struggling — try fewer objects in Settings', 3500);
      }
    }

    if (s.showStats) {
      statsText = `${fps.toFixed(0)} fps · physics ${sim.stepMs.toFixed(1)} ms\n${sim.awakeCount()}/${sim.bodyCount} awake${
        sim.pendingCount ? ` · ${sim.pendingCount} queued` : ''
      } · ${view.getQuality()}${motion.active ? ' · motion' : ''}`;
      ui.setStats(statsText);
    }
  }

  requestAnimationFrame(frame);
}

function showError(err: unknown): void {
  console.error(err);
  const loading = document.getElementById('loading');
  if (!loading) return;
  loading.classList.add('error');
  loading.innerHTML = `<div><h1>Couldn't start the simulation</h1><p>${
    String((err as Error)?.message ?? err).replace(/[<>&]/g, '')
  }</p><p>This needs a browser with WebGL and WebAssembly support.</p></div>`;
}

main().catch(showError);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

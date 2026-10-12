export interface PointerHandlers {
  /** Drag that tilts the box, in CSS pixels since the last call. */
  tilt(dx: number, dy: number): void;
  /** Quick tap / click without movement. */
  poke(x: number, y: number): void;
  /** Drag that pushes objects under the pointer; velocity in CSS px/s. */
  stir(x: number, y: number, vx: number, vy: number): void;
  /** Whether a plain drag should stir instead of tilt (true while phone motion drives gravity). */
  dragStirs(): boolean;
}

const TAP_SLOP = 6;
const TAP_MS = 450;

type Mode = 'pending' | 'tilt' | 'stir';

interface Track {
  mode: Mode;
  forceStir: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastT: number;
  startT: number;
}

/** Routes pointer gestures on the canvas to tilt, poke and stir actions. */
export function attachPointer(el: HTMLElement, h: PointerHandlers): () => void {
  const tracks = new Map<number, Track>();

  const down = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    el.setPointerCapture(e.pointerId);
    const now = performance.now();
    tracks.set(e.pointerId, {
      mode: 'pending',
      // A second finger, right mouse button or Shift turns a drag into a stir.
      forceStir: e.button === 2 || e.shiftKey || tracks.size > 0,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: now,
      startT: now,
    });
  };

  const move = (e: PointerEvent) => {
    const t = tracks.get(e.pointerId);
    if (!t) return;
    const now = performance.now();
    if (t.mode === 'pending') {
      if (Math.hypot(e.clientX - t.startX, e.clientY - t.startY) < TAP_SLOP) return;
      t.mode = t.forceStir || h.dragStirs() ? 'stir' : 'tilt';
    }
    const dx = e.clientX - t.lastX;
    const dy = e.clientY - t.lastY;
    const dt = Math.max(1, now - t.lastT) / 1000;
    if (t.mode === 'tilt') h.tilt(dx, dy);
    else h.stir(e.clientX, e.clientY, dx / dt, dy / dt);
    t.lastX = e.clientX;
    t.lastY = e.clientY;
    t.lastT = now;
  };

  const up = (e: PointerEvent) => {
    const t = tracks.get(e.pointerId);
    if (!t) return;
    tracks.delete(e.pointerId);
    if (e.type === 'pointerup' && t.mode === 'pending' && performance.now() - t.startT < TAP_MS) {
      h.poke(e.clientX, e.clientY);
    }
  };

  const noMenu = (e: Event) => e.preventDefault();

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', noMenu);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('contextmenu', noMenu);
  };
}

/** Tracks which keys are held, for continuous arrow-key tilting. */
export class HeldKeys {
  private held = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!isTyping(e)) this.held.add(e.key);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.key));
    window.addEventListener('blur', () => this.held.clear());
  }

  has(key: string): boolean {
    return this.held.has(key);
  }
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  if (t.tagName === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    // Sliders count: their arrow keys belong to the slider, not the box.
    return type !== 'checkbox' && type !== 'radio' && type !== 'button';
  }
  return false;
}

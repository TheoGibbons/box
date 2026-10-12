import {
  decideMotionSign,
  deviceToScreen,
  dot,
  gravityFromOrientation,
  length,
  normalize,
  scale,
  vec3,
  type Vec3,
} from './math';

export type MotionState = 'unsupported' | 'needs-permission' | 'off' | 'waiting' | 'on' | 'denied' | 'insecure';

type PermissionFn = () => Promise<'granted' | 'denied' | 'default'>;

const STANDARD_G = 9.81;

/**
 * Turns DeviceMotionEvent readings into an effective gravity vector in the
 * screen frame, in units of standard gravity (1.0 = phone at rest).
 *
 * `accelerationIncludingGravity` is (device acceleration - gravity), so the
 * pull felt by things inside a box held by the phone is its negation. That
 * captures both tilt and shakes with no extra work.
 */
export class MotionInput {
  state: MotionState;
  onChange: (s: MotionState) => void = () => {};
  /** Effective gravity in g units, screen frame. */
  readonly gravity: Vec3 = vec3(0, -1, 0);
  invert = false;

  private sign: 1 | -1 = 1;
  private votes: number[] = [];
  private signLocked = false;
  private orientationDown: Vec3 | null = null;
  private orientationAt = 0;
  private lastEventAt = 0;
  private waitTimer = 0;

  constructor() {
    const DM = globalThis.DeviceMotionEvent as unknown as { requestPermission?: PermissionFn } | undefined;
    if (!DM) this.state = 'unsupported';
    else if (!window.isSecureContext) this.state = 'insecure';
    else if (typeof DM.requestPermission === 'function') this.state = 'needs-permission';
    else this.state = 'off';
  }

  get active(): boolean {
    return this.state === 'on';
  }

  /** Whether we should offer a motion toggle at all. */
  get available(): boolean {
    return this.state !== 'unsupported';
  }

  /**
   * Starts listening. On iOS this must run inside a user gesture handler,
   * because it may show the permission prompt.
   */
  async enable(): Promise<MotionState> {
    if (this.state === 'unsupported' || this.state === 'insecure') return this.state;
    const DM = DeviceMotionEvent as unknown as { requestPermission?: PermissionFn };
    const DO = (globalThis.DeviceOrientationEvent as unknown as { requestPermission?: PermissionFn }) ?? {};
    if (typeof DM.requestPermission === 'function') {
      try {
        // Both prompts must be requested synchronously within the gesture.
        const [motion] = await Promise.all([
          DM.requestPermission(),
          typeof DO.requestPermission === 'function' ? DO.requestPermission().catch(() => 'denied') : Promise.resolve('granted'),
        ]);
        if (motion !== 'granted') return this.set('denied');
      } catch {
        return this.set('denied');
      }
    }
    window.addEventListener('devicemotion', this.onMotion);
    window.addEventListener('deviceorientation', this.onOrientation);
    this.set('waiting');
    // Desktop browsers often define the API but never deliver readings.
    clearTimeout(this.waitTimer);
    this.waitTimer = window.setTimeout(() => {
      if (this.state === 'waiting') {
        this.stopListening();
        this.set('unsupported');
      }
    }, 2000);
    return this.state;
  }

  disable(): void {
    this.stopListening();
    if (this.state === 'on' || this.state === 'waiting') this.set('off');
  }

  private stopListening(): void {
    window.removeEventListener('devicemotion', this.onMotion);
    window.removeEventListener('deviceorientation', this.onOrientation);
    clearTimeout(this.waitTimer);
  }

  private set(s: MotionState): MotionState {
    if (this.state !== s) {
      this.state = s;
      this.onChange(s);
    }
    return s;
  }

  private onOrientation = (e: DeviceOrientationEvent): void => {
    if (e.beta == null || e.gamma == null) return;
    this.orientationDown = gravityFromOrientation(e.beta, e.gamma);
    this.orientationAt = performance.now();
  };

  private onMotion = (e: DeviceMotionEvent): void => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const now = performance.now();
    this.lastEventAt = now;
    if (this.state === 'waiting') {
      clearTimeout(this.waitTimer);
      this.set('on');
    }
    const raw = vec3(a.x, a.y, a.z);
    const downSpec = scale(raw, -1 / STANDARD_G); // spec says the phone at rest reads +g "up"
    this.learnSign(downSpec, now);
    const sign = this.sign * (this.invert ? -1 : 1);
    const screen = deviceToScreen(scale(downSpec, sign), screenAngle());
    this.gravity.x = screen.x;
    this.gravity.y = screen.y;
    this.gravity.z = screen.z;
  };

  /**
   * Some browsers have historically reported the opposite sign. While the
   * phone is roughly still, compare against the orientation sensor's idea of
   * "down" and flip if they disagree.
   */
  private learnSign(downSpec: Vec3, now: number): void {
    if (this.signLocked || !this.orientationDown || now - this.orientationAt > 200) return;
    const mag = length(downSpec);
    if (mag < 0.85 || mag > 1.15) return; // only trust readings without much shaking
    this.votes.push(dot(normalize(downSpec), this.orientationDown));
    const decided = decideMotionSign(this.votes);
    if (decided || this.votes.length >= 60) {
      if (decided) this.sign = decided;
      this.signLocked = true;
    }
  }

  /** True if readings have gone stale (e.g. tab backgrounded). */
  isStale(): boolean {
    return this.active && performance.now() - this.lastEventAt > 1000;
  }
}

function screenAngle(): number {
  const so = screen.orientation;
  if (so && typeof so.angle === 'number') return so.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

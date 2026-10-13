import { dot, length, lerpVec, sub, vec3, type Vec3 } from './math';

type Acceleration = { x: number | null; y: number | null; z: number | null } | null;

const THRESHOLD = 12; // m/s² of movement, excluding gravity
const WINDOW_MS = 450;
const COOLDOWN_MS = 800;
const MAX_GAP_MS = 500;

function read(a: Acceleration): Vec3 | null {
  if (!a || a.x == null || a.y == null || a.z == null) return null;
  if (![a.x, a.y, a.z].every(Number.isFinite)) return null;
  return vec3(a.x, a.y, a.z);
}

/** Recognises a strong back-and-forth movement, rather than a tilt or one bump. */
export class ShakeDetector {
  private baseline: Vec3 | null = null;
  private lastAt: number | null = null;
  private peak: { acceleration: Vec3; at: number } | null = null;
  private cooldownUntil = 0;

  reset(): void {
    this.baseline = null;
    this.lastAt = null;
    this.peak = null;
    this.cooldownUntil = 0;
  }

  /** Prefer the sensor's linear acceleration; otherwise filter gravity out. */
  update(includingGravity: Acceleration, acceleration: Acceleration, now: number): boolean {
    if (this.lastAt !== null && (now - this.lastAt > MAX_GAP_MS || now < this.lastAt)) this.reset();
    const dt = this.lastAt === null ? 0 : (now - this.lastAt) / 1000;
    this.lastAt = now;

    const raw = read(includingGravity);
    let linear = read(acceleration);
    if (raw) {
      this.baseline = this.baseline ? lerpVec(this.baseline, raw, 1 - Math.exp(-dt / 0.3)) : raw;
      linear ??= sub(raw, this.baseline);
    }
    if (!linear) {
      this.peak = null;
      return false;
    }
    const magnitude = length(linear);
    if (now < this.cooldownUntil || magnitude < THRESHOLD) return false;

    if (this.peak && now - this.peak.at <= WINDOW_MS) {
      // Opposing peaks reject sustained acceleration and single impacts.
      if (dot(this.peak.acceleration, linear) < -0.5 * length(this.peak.acceleration) * magnitude) {
        this.peak = null;
        this.cooldownUntil = now + COOLDOWN_MS;
        return true;
      }
    } else {
      this.peak = { acceleration: linear, at: now };
    }
    return false;
  }
}

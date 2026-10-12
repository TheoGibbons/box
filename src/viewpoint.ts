import { Quaternion, Vector3 } from 'three';
import { normalize, smoothing, type Vec3 } from './math';

const Z = new Vector3(0, 0, 1);
const IDENTITY = new Quaternion();
/** Beyond this the view would swing unnaturally far, so rotation is capped. */
const MAX_ANGLE = (40 * Math.PI) / 180;

/**
 * Estimates where the viewer's eye is relative to the screen, for the
 * "window into a box" effect. The viewer is assumed to stay put while the
 * phone turns, so the eye's direction in the screen frame is the inverse of
 * the phone's rotation.
 *
 * The rotation is measured from a reference that drifts back to the current
 * pose over a few seconds, like iOS parallax wallpapers: whatever angle you
 * hold the phone at becomes "straight on", and only movement shows parallax.
 */
export class Viewpoint {
  /** Unit vector from the screen centre towards the eye, screen frame. */
  readonly eye = new Vector3(0, 0, 1);
  /** Seconds for the reference pose to catch up with the phone. */
  recenterTime = 2.5;

  /** Phone orientation relative to the reference (device → reference frame). */
  private q = new Quaternion();
  private dq = new Quaternion();
  private axis = new Vector3();
  private gRef: Vector3 | null = null;
  private gTmp = new Vector3();
  private qInv = new Quaternion();

  /** Gyro path: integrate body angular velocity (rad/s, screen frame). */
  rotate(omega: Vec3, dt: number): void {
    const rate = Math.hypot(omega.x, omega.y, omega.z);
    if (rate > 1e-6) {
      this.axis.set(omega.x / rate, omega.y / rate, omega.z / rate);
      this.dq.setFromAxisAngle(this.axis, rate * dt);
      this.q.multiply(this.dq);
    }
    this.gRef = null;
    this.relax(dt);
  }

  /**
   * Fallback without a gyroscope: infer rotation from how gravity moved
   * relative to a slowly adapting reference. Turning about the gravity axis
   * can't be seen this way, so it gives less parallax than the gyro path.
   */
  fromGravity(g: Vec3, dt: number): void {
    const n = normalize(g);
    this.gTmp.set(n.x, n.y, n.z);
    if (!this.gRef) this.gRef = this.gTmp.clone();
    // The reference follows the phone slowly, which is the recentering here.
    this.gRef.lerp(this.gTmp, smoothing(dt, this.recenterTime)).normalize();
    this.q.setFromUnitVectors(this.gTmp, this.gRef);
    this.clamp();
    this.update();
  }

  /** Desktop: treat the mouse as the viewer's head; nx/ny in [-1, 1], y down. */
  fromPointer(nx: number, ny: number, dt: number, maxAngle = 0.3): void {
    const t = Math.tan(maxAngle);
    const target = new Vector3(nx * t, -ny * t, 1).normalize();
    this.eye.lerp(target, smoothing(dt, 0.15)).normalize();
    this.q.setFromUnitVectors(Z, this.eye).invert();
    this.gRef = null;
  }

  /** Ease back to looking straight on (e.g. no input). */
  center(dt: number): void {
    this.gRef = null;
    this.q.slerp(IDENTITY, smoothing(dt, 0.4));
    this.update();
  }

  reset(): void {
    this.q.identity();
    this.gRef = null;
    this.update();
  }

  private relax(dt: number): void {
    this.q.slerp(IDENTITY, smoothing(dt, this.recenterTime));
    this.clamp();
    this.update();
  }

  private clamp(): void {
    const angle = 2 * Math.acos(Math.min(1, Math.abs(this.q.w)));
    if (angle > MAX_ANGLE) this.q.slerp(IDENTITY, 1 - MAX_ANGLE / angle);
  }

  private update(): void {
    this.qInv.copy(this.q).invert();
    this.eye.copy(Z).applyQuaternion(this.qInv);
  }
}

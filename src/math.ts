// Pure helpers with no DOM, Three.js or Rapier dependencies, so they can be
// unit tested in Node.
//
// Coordinate frame used everywhere ("screen frame"): +x points to the right of
// the screen, +y to the top of the screen, +z out of the screen toward the
// viewer. The box's open front (the "glass") faces +z.

export type Vec3 = { x: number; y: number; z: number };

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);

export const scale = (v: Vec3, s: number): Vec3 => vec3(v.x * s, v.y * s, v.z * s);

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);

export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export function normalize(v: Vec3, fallback: Vec3 = vec3(0, -1, 0)): Vec3 {
  const l = length(v);
  return l > 1e-9 ? scale(v, 1 / l) : { ...fallback };
}

export const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 =>
  vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Angle between two vectors in radians. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  return Math.acos(clamp(dot(a, b) / (la * lb), -1, 1));
}

/** Rotate around the screen's x axis (positive = right-hand rule). */
export function rotateX(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

/** Rotate around the screen's y axis (positive = right-hand rule). */
export function rotateY(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

/** Rotate around the screen's z axis (positive = counter-clockwise). */
export function rotateZ(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}

const DEG = Math.PI / 180;

/**
 * Unit "down" direction in the device frame derived from DeviceOrientationEvent
 * beta/gamma (degrees). Flat, face up -> (0,0,-1); upright portrait -> (0,-1,0);
 * right edge lowered (gamma > 0) -> +x.
 */
export function gravityFromOrientation(betaDeg: number, gammaDeg: number): Vec3 {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  return vec3(Math.sin(g) * Math.cos(b), -Math.sin(b), -Math.cos(g) * Math.cos(b));
}

/**
 * Converts a vector from the device's natural frame to the current screen
 * frame, given `screen.orientation.angle` in degrees (90 = device rotated a
 * quarter turn counter-clockwise, i.e. the top of the phone points left).
 */
export function deviceToScreen(v: Vec3, screenAngleDeg: number): Vec3 {
  return rotateZ(v, screenAngleDeg * DEG);
}

/**
 * Applies a pointer drag to the gravity direction like a trackball: dragging
 * right sends things right, dragging down sends things down.
 * `dx`/`dy` are in CSS pixels; `sensitivity` is radians per pixel.
 */
export function dragGravity(dir: Vec3, dx: number, dy: number, sensitivity: number): Vec3 {
  let d = rotateY(dir, -dx * sensitivity);
  d = rotateX(d, -dy * sensitivity);
  return normalize(d);
}

/** Inner dimensions of the box for a viewport aspect ratio (width / height). */
export function boxDimensions(aspect: number, area = 600, depth = 5): { w: number; h: number; d: number } {
  const a = clamp(aspect, 0.25, 4);
  const h = Math.sqrt(area / a);
  return { w: h * a, h, d: depth };
}

/** Clamp a point so a sphere of radius `r` around it sits inside the box. */
export function clampIntoBox(p: Vec3, box: { w: number; h: number; d: number }, r: number): Vec3 {
  const hx = Math.max(0, box.w / 2 - r);
  const hy = Math.max(0, box.h / 2 - r);
  const hz = Math.max(0, box.d / 2 - r);
  return vec3(clamp(p.x, -hx, hx), clamp(p.y, -hy, hy), clamp(p.z, -hz, hz));
}

/**
 * Decides whether raw `accelerationIncludingGravity` readings need negating so
 * that `-reading` points down. Each vote is the dot product of the
 * sign-as-specified down vector with a reference down vector (e.g. from
 * DeviceOrientationEvent). Returns null until there's enough evidence.
 */
export function decideMotionSign(votes: number[], minVotes = 8): 1 | -1 | null {
  const strong = votes.filter((v) => Math.abs(v) > 0.5);
  if (strong.length < minVotes) return null;
  const agree = strong.filter((v) => v > 0).length;
  if (agree >= strong.length * 0.75) return 1;
  if (agree <= strong.length * 0.25) return -1;
  return null;
}

/** Deterministic PRNG (mulberry32) so spawns and colours are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exponential smoothing factor for a time constant, independent of frame rate. */
export const smoothing = (dt: number, tau: number): number => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/**
 * Checks a gyroscope reading against how gravity actually moved. For a
 * world-fixed vector seen from a rotating device, d(g)/dt = -omega × g.
 * Returns the cosine between predicted and observed change, or null when the
 * motion is too small to judge. `omega` is rad/s; `gPrev`/`gNow` are unit-ish.
 */
export function gyroVote(omega: Vec3, gPrev: Vec3, gNow: Vec3, dt: number): number | null {
  if (length(omega) < 0.6 || dt <= 0 || dt > 0.1) return null;
  const predicted = scale(cross(omega, gPrev), -dt);
  const observed = sub(gNow, gPrev);
  if (length(predicted) < 0.01 || length(observed) < 0.01) return null;
  return dot(normalize(predicted), normalize(observed));
}

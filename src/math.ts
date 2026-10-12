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

/**
 * How a browser lays out DeviceMotionEvent.rotationRate. The spec puts the
 * rate about z in `alpha`, x in `beta` and y in `gamma`; WebKit on iOS
 * reports the gyroscope's x/y/z as alpha/beta/gamma instead.
 */
export type GyroMapping = 'spec' | 'webkit';
export const GYRO_MAPPINGS: GyroMapping[] = ['spec', 'webkit'];

/** Converts rotationRate (deg/s) to angular velocity (rad/s) about device x/y/z. */
export function gyroToOmega(r: { alpha: number; beta: number; gamma: number }, mapping: GyroMapping): Vec3 {
  const k = Math.PI / 180;
  return mapping === 'spec' ? vec3(r.beta * k, r.gamma * k, r.alpha * k) : vec3(r.alpha * k, r.beta * k, r.gamma * k);
}

/**
 * Picks the rotationRate layout and sign whose predictions best match how
 * gravity actually moved. `votes` holds gyroVote results per mapping; the
 * right mapping scores near +1 (or -1 if its sign is flipped) and the wrong
 * one hovers near 0. Returns null until one clearly wins.
 */
export function decideGyroMapping(
  votes: Record<GyroMapping, number[]>,
  minVotes = 15,
): { mapping: GyroMapping; sign: 1 | -1 } | null {
  const scored = GYRO_MAPPINGS.map((mapping) => {
    const v = votes[mapping];
    const mean = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    return { mapping, n: v.length, mean };
  }).sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));
  const [best, other] = scored;
  if (best.n < minVotes || Math.abs(best.mean) < 0.6) return null;
  if (other.n >= minVotes / 2 && Math.abs(other.mean) > Math.abs(best.mean) - 0.3) return null;
  return { mapping: best.mapping, sign: best.mean > 0 ? 1 : -1 };
}

/**
 * Applies the smallest rotation that takes unit vector `from` to unit vector
 * `to` onto `v` (Rodrigues' formula).
 */
export function rotateByArc(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const a = normalize(from);
  const b = normalize(to);
  const c = clamp(dot(a, b), -1, 1);
  let axis = cross(a, b);
  const s = length(axis);
  if (s < 1e-9) {
    if (c > 0) return { ...v };
    // Opposite vectors: any perpendicular axis works for a half turn.
    axis = normalize(Math.abs(a.x) < 0.9 ? cross(a, vec3(1, 0, 0)) : cross(a, vec3(0, 1, 0)));
  } else {
    axis = scale(axis, 1 / s);
  }
  const angle = Math.atan2(s, c);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  return add(add(scale(v, cosA), scale(cross(axis, v), sinA)), scale(axis, dot(axis, v) * (1 - cosA)));
}

/** How "down" points when the phone is held at a typical reading angle. */
export const REST_DOWN = normalize(vec3(0, -0.8, -0.6));
/** Direction to the room's lamp at that pose: above and in front of the screen. */
export const REST_LAMP = normalize(vec3(0.12, 0.5, 1));

/**
 * Direction towards a lamp fixed in the room, in the screen frame, given
 * which way is down for the phone right now. The lamp turns with the world,
 * so tilting the phone changes the angle light comes in at and the box's
 * walls throw shadows. Turning about the vertical can't be seen from
 * gravity, so that doesn't move the light.
 */
export function lampDirection(down: Vec3): Vec3 {
  return normalize(rotateByArc(REST_LAMP, REST_DOWN, down));
}

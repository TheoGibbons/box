import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { ShapeKind } from './settings';

type Rapier = typeof RAPIER_NS;

// Nominal dimensions at size 1. Each object is uniformly scaled by its own
// factor, applied to both the render instance and the collider.
const CUBE_HALF = 0.45;
const SPHERE_R = 0.5;
const CAPSULE_R = 0.3;
const CAPSULE_HALF_H = 0.3;
const CYL_R = 0.45;
const CYL_HALF_H = 0.2;

/** Radius of a sphere enclosing the shape at scale 1, used for spawn spacing. */
export const BOUNDING_RADIUS: Record<ShapeKind, number> = {
  cube: Math.sqrt(3) * CUBE_HALF,
  sphere: SPHERE_R,
  capsule: CAPSULE_HALF_H + CAPSULE_R,
  cylinder: Math.hypot(CYL_R, CYL_HALF_H),
};

export function createGeometry(kind: ShapeKind, detail: 'low' | 'high'): THREE.BufferGeometry {
  const hi = detail === 'high';
  switch (kind) {
    case 'cube':
      return new RoundedBoxGeometry(CUBE_HALF * 2, CUBE_HALF * 2, CUBE_HALF * 2, hi ? 3 : 1, 0.09);
    case 'sphere':
      return new THREE.SphereGeometry(SPHERE_R, hi ? 24 : 12, hi ? 16 : 8);
    case 'capsule':
      return new THREE.CapsuleGeometry(CAPSULE_R, CAPSULE_HALF_H * 2, hi ? 6 : 3, hi ? 16 : 8);
    case 'cylinder':
      return new THREE.CylinderGeometry(CYL_R, CYL_R, CYL_HALF_H * 2, hi ? 28 : 12);
  }
}

export function colliderDesc(R: Rapier, kind: ShapeKind, s: number): RAPIER_NS.ColliderDesc {
  switch (kind) {
    case 'cube':
      return R.ColliderDesc.cuboid(CUBE_HALF * s, CUBE_HALF * s, CUBE_HALF * s);
    case 'sphere':
      return R.ColliderDesc.ball(SPHERE_R * s);
    case 'capsule':
      return R.ColliderDesc.capsule(CAPSULE_HALF_H * s, CAPSULE_R * s);
    case 'cylinder':
      return R.ColliderDesc.cylinder(CYL_HALF_H * s, CYL_R * s);
  }
}

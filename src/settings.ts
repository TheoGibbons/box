import { clamp } from './math';

export const SHAPE_KINDS = ['cube', 'sphere', 'capsule', 'cylinder'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type ShapeMode = 'mixed' | ShapeKind;
export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type Backdrop = 'charcoal' | 'navy' | 'paper';
export type WallPattern = 'plain' | 'checker';

export const PALETTES = {
  candy: ['#ff5d73', '#ffb347', '#ffe066', '#7bd389', '#4cc9f0', '#9b5de5', '#f15bb5'],
  sunset: ['#ff6b35', '#f7c59f', '#efa00b', '#d65108', '#c1292e', '#ffd166'],
  ocean: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8', '#48cae4'],
  forest: ['#2d6a4f', '#40916c', '#52b788', '#95d5b2', '#d8f3dc', '#b7a57a'],
  neon: ['#39ff14', '#ff073a', '#0ff0fc', '#fe00fe', '#fffb00', '#ff9a00'],
  mono: ['#f5f5f5', '#d4d4d4', '#a3a3a3', '#737373', '#404040', '#1c1c1c'],
  gold: ['#d4af37', '#c5a028', '#e6c35c', '#b8860b', '#f0d77b'],
  rainbow: [] as string[], // generated per object from its colour seed
} satisfies Record<string, string[]>;
export type PaletteId = keyof typeof PALETTES;
export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];

export interface Settings {
  count: number;
  shape: ShapeMode;
  size: number;
  palette: PaletteId;
  roughness: number;
  metalness: number;
  clearcoat: number;
  gravity: number;
  bounciness: number;
  friction: number;
  shakeSensitivity: number;
  lightIntensity: number;
  envIntensity: number;
  shadows: boolean;
  lightFollowsTilt: boolean;
  /** Inside depth of the box in (estimated) real-world inches. */
  depth: number;
  /** 0 = flat, 1 = physically accurate, >1 exaggerated. */
  parallax: number;
  backdrop: Backdrop;
  walls: WallPattern;
  quality: Quality;
  showStats: boolean;
  invertMotion: boolean;
  keepAwake: boolean;
  /** Steer with the phone's motion sensors when available (toggled by the toolbar button). */
  motion: boolean;
  /** Toolbar tucked away behind its chevron tab. */
  toolbarCollapsed: boolean;
}

export const LIMITS = {
  count: { min: 100, max: 900, step: 10 },
  size: { min: 0.6, max: 1.4, step: 0.05 },
  roughness: { min: 0, max: 1, step: 0.01 },
  metalness: { min: 0, max: 1, step: 0.01 },
  clearcoat: { min: 0, max: 1, step: 0.01 },
  gravity: { min: 5, max: 120, step: 1 },
  bounciness: { min: 0, max: 0.95, step: 0.01 },
  friction: { min: 0, max: 1.5, step: 0.01 },
  shakeSensitivity: { min: 0, max: 3, step: 0.05 },
  lightIntensity: { min: 0, max: 6, step: 0.05 },
  envIntensity: { min: 0, max: 2, step: 0.05 },
  depth: { min: 0.3, max: 3, step: 0.05 },
  parallax: { min: 0, max: 3, step: 0.05 },
} as const;
type NumericKey = keyof typeof LIMITS;

export const MATERIAL_PRESETS = {
  plastic: { roughness: 0.35, metalness: 0, clearcoat: 0.3 },
  glossy: { roughness: 0.08, metalness: 0, clearcoat: 1 },
  matte: { roughness: 0.9, metalness: 0, clearcoat: 0 },
  metal: { roughness: 0.22, metalness: 1, clearcoat: 0 },
  rubber: { roughness: 0.7, metalness: 0, clearcoat: 0 },
} as const;
export type MaterialPreset = keyof typeof MATERIAL_PRESETS;

export function defaultSettings(mobile: boolean): Settings {
  return {
    count: mobile ? 350 : 600,
    shape: 'mixed',
    size: 1,
    palette: 'candy',
    ...MATERIAL_PRESETS.plastic,
    gravity: 40,
    bounciness: 0.25,
    friction: 0.6,
    shakeSensitivity: 1,
    lightIntensity: 2.6,
    envIntensity: 0.6,
    shadows: true,
    lightFollowsTilt: true,
    depth: 1,
    parallax: 1.5,
    backdrop: 'charcoal',
    walls: 'plain',
    quality: 'auto',
    showStats: false,
    invertMotion: false,
    keepAwake: false,
    motion: true,
    toolbarCollapsed: false,
  };
}

const ENUMS: Partial<Record<keyof Settings, readonly string[]>> = {
  shape: ['mixed', ...SHAPE_KINDS],
  palette: PALETTE_IDS,
  quality: ['auto', 'low', 'medium', 'high'],
  backdrop: ['charcoal', 'navy', 'paper'],
  walls: ['plain', 'checker'],
};

/** Merges untrusted input (localStorage, URL) over defaults, dropping anything invalid. */
export function sanitize(input: unknown, defaults: Settings): Settings {
  const out: Settings = { ...defaults };
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  const target = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    const value = src[key];
    const fallback = defaults[key];
    if (typeof fallback === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const lim = LIMITS[key as NumericKey];
      target[key] = lim ? clamp(value, lim.min, lim.max) : value;
    } else if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') target[key] = value;
    } else if (typeof value === 'string' && ENUMS[key]?.includes(value)) {
      target[key] = value;
    }
  }
  return out;
}

const STORAGE_KEY = 'box.settings.v1';

export function loadSettings(defaults: Settings): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitize(raw ? JSON.parse(raw) : null, defaults);
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private mode, blocked); settings just won't persist.
  }
}

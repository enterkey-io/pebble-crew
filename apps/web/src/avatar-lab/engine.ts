/** Original procedural study. No vendor artwork or animation runtime. */
import type { Shape } from '@hermes-client/core';
export { SHAPES } from '@hermes-client/core';
export type { Shape } from '@hermes-client/core';
export const STATES = ['ready', 'thinking', 'working', 'waiting', 'attention', 'done'] as const;
export type Activity = (typeof STATES)[number];
export const COLORS = [
  { id: 'iris', label: 'Iris', hex: '#aca8ed' },
  { id: 'citron', label: 'Citron', hex: '#d4dc85' },
  { id: 'clay', label: 'Clay', hex: '#eeaa8d' },
  { id: 'lagoon', label: 'Lagoon', hex: '#8dcec6' },
  { id: 'rose', label: 'Rose', hex: '#e7a5ba' },
  { id: 'sky', label: 'Sky', hex: '#9bbfe8' },
  { id: 'white', label: 'White', hex: '#f4f3ef' },
  { id: 'umber', label: 'Umber', hex: '#9c7658' },
  { id: 'moss', label: 'Moss', hex: '#789463' },
  { id: 'ocean', label: 'Ocean', hex: '#5e8fb5' },
  { id: 'heather', label: 'Heather', hex: '#8b76b5' },
  { id: 'sienna', label: 'Sienna', hex: '#b67559' },
] as const;

/** Fixed normalized paths can be replayed as native vector paths on other platforms. */
export const BODY_PATHS: Record<Shape, string> = {
  pebble: 'M21 32 C27 13 48 9 66 17 C88 20 94 42 86 65 C80 86 57 92 36 83 C16 77 11 52 21 32 Z',
  beacon:
    'M38 15 Q50 9 62 16 L80 28 Q89 34 89 46 L87 65 Q86 77 75 82 L57 89 Q48 92 38 87 L21 76 Q12 70 13 59 L14 38 Q15 29 25 23 Z',
  petal: 'M50 22 C70 4 94 27 80 48 C100 66 76 93 53 80 C34 99 6 78 21 54 C2 33 27 7 50 22 Z',
  kite: 'M43 14 Q50 8 58 15 L85 43 Q93 50 85 59 L59 85 Q50 94 42 85 L15 59 Q7 50 15 42 Z',
  arch: 'M17 54 C17 0 83 0 83 54 L83 75 Q83 86 72 86 L28 86 Q17 86 17 75 Z',
  cairn: 'M34 18 Q50 10 67 20 L86 65 Q92 83 74 87 L25 87 Q9 84 15 68 Z',
  seed: 'M27 22 C49 9 77 10 86 32 C98 56 72 82 36 90 C17 83 9 49 27 22 Z',
  dune: 'M12 56 C14 36 28 20 45 19 C62 18 62 10 75 17 C87 24 89 42 88 59 C89 77 75 87 51 87 C28 90 8 80 12 56 Z',
  flint:
    'M22 22 Q25 16 34 16 L64 12 Q71 12 77 21 L91 46 Q95 54 87 63 L66 87 Q61 92 51 88 L18 76 Q10 73 12 61 L15 35 Q16 26 22 22 Z',
  drift:
    'M13 35 C21 14 42 17 56 23 C70 28 87 18 92 39 C98 60 86 77 66 82 C48 89 31 85 18 74 C7 63 6 49 13 35 Z',
};

export interface Pose {
  x: number;
  y: number;
  rotation: number;
  sx: number;
  sy: number;
  gazeX: number;
  gazeY: number;
  leftOpen: number;
  rightOpen: number;
  leftTilt: number;
  rightTilt: number;
  orbit: number;
  orbitOpacity: number;
  dots: [number, number, number];
}

export function seedFromId(id: string): number {
  let value = 2166136261;
  for (let i = 0; i < id.length; i++) value = Math.imul(value ^ id.charCodeAt(i), 16777619);
  return value >>> 0;
}

const TAU = Math.PI * 2;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Pure, time-based pose. No DOM, timers, randomness, device data or model access. */
export function samplePose(
  state: Activity,
  milliseconds: number,
  seed: number,
  reduced = false,
): Pose {
  const t = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) / 1000 : 0;
  const phase = (seed % 10007) / 10007;
  const wave = Math.sin(t * 2.4 + phase * TAU);
  const pose: Pose = {
    x: 0,
    y: 0,
    rotation: 0,
    sx: 1,
    sy: 1,
    gazeX: 0,
    gazeY: 0,
    leftOpen: 1,
    rightOpen: 1,
    leftTilt: 0,
    rightTilt: 0,
    orbit: 0,
    orbitOpacity: 0,
    dots: [0, 0, 0],
  };
  switch (state) {
    case 'ready':
      // A relaxed look away from the owner, with continuous, seeded micro-motion.
      pose.gazeX = 3.375;
      pose.gazeY = -2.727;
      if (!reduced) {
        pose.gazeX += Math.sin(t * 0.55 + phase * TAU) * 0.32;
        pose.gazeY += Math.cos(t * 0.43 + phase * TAU) * 0.35;
        pose.x = Math.sin(t * 0.75 + phase * TAU) * 0.45;
        pose.y = Math.sin(t * 1.05 + phase * TAU) * 1.25;
        pose.rotation = Math.sin(t * 0.68 + phase * TAU) * 1.4;
        pose.sy = 1 + Math.sin(t * 1.05 + phase * TAU) * 0.014;
        pose.sx = 2 - pose.sy;
      }
      break;
    case 'thinking':
      pose.rotation = -6;
      pose.gazeX = -3;
      pose.gazeY = -3;
      pose.leftOpen = 0.62;
      pose.rightOpen = 0.92;
      pose.leftTilt = -12;
      if (!reduced) {
        pose.rotation += wave * 2;
        pose.y = Math.sin(t * 1.6 + phase * TAU) * 1.2;
        pose.dots = [0, 1, 2].map(
          (i) => 0.22 + 0.78 * Math.max(0, Math.sin(t * 3.2 - i * 1.1)),
        ) as Pose['dots'];
      }
      break;
    case 'working':
      pose.gazeY = 1.7;
      pose.leftOpen = pose.rightOpen = 0.69;
      pose.leftTilt = -9;
      pose.rightTilt = 9;
      pose.orbitOpacity = 0.85;
      if (!reduced) {
        pose.x = wave * 0.7;
        pose.rotation = Math.sin(t * 2 + phase * TAU) * 3.2;
        pose.gazeX = Math.sin(t * 1.8) * 3.4;
        pose.sy = 1 + Math.sin(t * 4.8 + phase * TAU) * 0.014;
        pose.sx = 2 - pose.sy;
        pose.orbit = (t * 72 + phase * 360) % 360;
      }
      break;
    case 'waiting':
      pose.gazeX = 3.5;
      pose.leftOpen = pose.rightOpen = 0.48;
      pose.rotation = 4;
      if (!reduced) pose.y = Math.sin(t * 1.15 + phase * TAU) * 1.1;
      break;
    case 'attention':
      pose.leftOpen = pose.rightOpen = 1.28;
      pose.gazeY = -1;
      pose.sy = 1.02;
      pose.sx = 0.98;
      if (!reduced) pose.rotation = Math.sin(t * 1.8 + phase * TAU) * 2;
      break;
    case 'done': {
      pose.leftOpen = pose.rightOpen = 0.34;
      pose.leftTilt = -19;
      pose.rightTilt = 19;
      // A single short acknowledgment, never a perpetual celebration loop.
      const progress = clamp(t / 0.9, 0, 1);
      if (!reduced && progress < 1) {
        pose.y = -Math.sin(progress * Math.PI) * 6;
        pose.rotation = Math.sin(progress * TAU) * 5;
      }
      break;
    }
  }
  if (!reduced && state !== 'done') {
    const interval = 4.7 + phase * 2.4;
    const p = (t + phase * interval) % interval;
    const blink = p < 0.19 ? Math.max(0.07, 1 - Math.sin((p / 0.19) * Math.PI) * 0.97) : 1;
    pose.leftOpen *= blink;
    pose.rightOpen *= blink;
  }
  return pose;
}

/** Bounded pose deadline; offscreen/background suspension belongs to the shared scheduler. */
export function nextPoseDelay(
  state: Activity,
  milliseconds: number,
  seed: number,
  fps: number,
): number {
  const t = Math.max(0, milliseconds) / 1000;
  void seed;
  const frame = 1000 / Math.max(1, Math.min(30, fps));
  if (state === 'done') return t < 0.9 ? frame : Infinity;
  if (state !== 'ready') return frame;
  // Slow idle body/gaze motion is continuous; no stepped held looks.
  // Only visible avatars are sampled. Dense rosters use a lower frame budget.
  return frame;
}

/** Interruption starts at the currently drawn pose, including partially closed eyes. */
export function blendPose(from: Pose, to: Pose, progress: number): Pose {
  const x = Math.max(0, Math.min(1, progress));
  const weight = x * x * (3 - 2 * x);
  const mix = (a: number, b: number) => a + (b - a) * weight;
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    rotation: mix(from.rotation, to.rotation),
    sx: mix(from.sx, to.sx),
    sy: mix(from.sy, to.sy),
    gazeX: mix(from.gazeX, to.gazeX),
    gazeY: mix(from.gazeY, to.gazeY),
    leftOpen: mix(from.leftOpen, to.leftOpen),
    rightOpen: mix(from.rightOpen, to.rightOpen),
    leftTilt: mix(from.leftTilt, to.leftTilt),
    rightTilt: mix(from.rightTilt, to.rightTilt),
    orbit: mix(from.orbit, to.orbit),
    orbitOpacity: mix(from.orbitOpacity, to.orbitOpacity),
    dots: [
      mix(from.dots[0], to.dots[0]),
      mix(from.dots[1], to.dots[1]),
      mix(from.dots[2], to.dots[2]),
    ],
  };
}

/** Frame-rate-independent gaze easing, shared by pointer and rest transitions. */
export function easeGaze(current: number, target: number, elapsedMs: number): number {
  return current + (target - current) * (1 - Math.exp(-clamp(elapsedMs, 0, 100) / 70));
}

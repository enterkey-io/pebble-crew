import { describe, expect, it } from 'vitest';
import {
  blendPose,
  nextPoseDelay,
  samplePose,
  sampleWelcomePose,
  seedFromId,
  STATES,
  easeGaze,
} from './engine';

describe('portable avatar motion', () => {
  it('the loading greeting looks both ways, blinks and gently hops without changing resting avatars', () => {
    const poses = Array.from({ length: 330 }, (_, i) => sampleWelcomePose(i * 10, 123));
    expect(Math.min(...poses.map((p) => p.gazeX))).toBeLessThan(-5);
    expect(Math.max(...poses.map((p) => p.gazeX))).toBeGreaterThan(5);
    expect(Math.min(...poses.map((p) => p.leftOpen))).toBeLessThan(0.1);
    expect(Math.min(...poses.map((p) => p.y))).toBeLessThan(-4.9);
    for (const pose of poses)
      for (const value of Object.values(pose).flat()) expect(Number.isFinite(value)).toBe(true);
    expect(sampleWelcomePose(0, 123, true)).toEqual(sampleWelcomePose(999999, 123, true));
    expect(sampleWelcomePose(Infinity, 123)).toEqual(sampleWelcomePose(0, 123));
    expect(samplePose('ready', 0, 123, true).leftOpen).toBe(1);
  });
  it('replays the same pose regardless of intervening frame samples', () => {
    const seed = seedFromId('stable-bot-id');
    const expected = samplePose('working', 4200, seed);
    for (let t = 0; t < 4200; t += 1000 / 120) samplePose('working', t, seed);
    expect(samplePose('working', 4200, seed)).toEqual(expected);
    expect(seedFromId('another-bot-id')).not.toBe(seed);
  });
  it('keeps all motion finite and bounded over long-running sessions', () => {
    for (const state of STATES) {
      for (const time of [0, 80, 150, 500, 900, 4760, 1e7, 1e10, Infinity, NaN]) {
        const pose = samplePose(state, time, seedFromId(state));
        for (const value of Object.values(pose).flat()) expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(pose.rotation)).toBeLessThanOrEqual(8);
        expect(pose.leftOpen).toBeGreaterThan(0);
        expect(pose.rightOpen).toBeLessThanOrEqual(1.3);
        expect(pose.sx).toBeGreaterThanOrEqual(0.97);
        expect(pose.sy).toBeLessThanOrEqual(1.03);
      }
    }
  });
  it('reduced motion keeps each state recognizable and time-independent', () => {
    for (const state of STATES)
      expect(samplePose(state, 0, 123, true)).toEqual(samplePose(state, 999999, 123, true));
    expect(samplePose('attention', 0, 123, true)).not.toEqual(samplePose('working', 0, 123, true));
  });
  it('bounds completion poses and samples continuous resting motion', () => {
    const seed = seedFromId('fixture');
    expect(samplePose('done', 1000, seed)).toEqual(samplePose('done', 900000, seed));
    expect(nextPoseDelay('done', 1000, seed, 15)).toBe(Infinity);
    expect(nextPoseDelay('ready', 2000, seed, 24)).toBeCloseTo(1000 / 24);
    const rest = samplePose('ready', 2000, seed);
    expect(rest.gazeX).toBeGreaterThan(2.5);
    expect(rest.gazeY).toBeLessThan(-2);
    expect(rest.y).not.toBe(0);
    expect(nextPoseDelay('working', 2000, seed, 15)).toBeCloseTo(1000 / 15);
  });
  it('interrupted transitions preserve their endpoints and bound interpolation', () => {
    const from = samplePose('thinking', 100, 2);
    const to = samplePose('attention', 200, 2);
    expect(blendPose(from, to, -2)).toEqual(from);
    for (const key of ['x', 'leftOpen', 'rotation'] as const) {
      expect(blendPose(from, to, 0.5)[key]).toBeGreaterThanOrEqual(Math.min(from[key], to[key]));
      expect(blendPose(from, to, 0.5)[key]).toBeLessThanOrEqual(Math.max(from[key], to[key]));
      expect(blendPose(from, to, 3)[key]).toBeCloseTo(to[key]);
    }
  });
});

it('gaze easing approaches targets continuously across different refresh rates', () => {
  let a = 0,
    b = 0;
  for (let i = 0; i < 60; i++) a = easeGaze(a, 6, 1000 / 60);
  for (let i = 0; i < 24; i++) b = easeGaze(b, 6, 1000 / 24);
  expect(a).toBeCloseTo(b, 6);
  expect(easeGaze(0, 6, 16)).toBeGreaterThan(0);
  expect(easeGaze(0, 6, 16)).toBeLessThan(2);
});

export const DEFAULT_PLAYBACK_RATE = 1;
export const MIN_PLAYBACK_RATE = 0.5;
export const MAX_PLAYBACK_RATE = 1.25;
export const PLAYBACK_RATE_STEP = 0.05;

function finiteOrDefault(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function clampPlaybackRate(rate: number, pitchPreservingSupported: boolean = true): number {
  if (!pitchPreservingSupported) {
    return DEFAULT_PLAYBACK_RATE;
  }

  const clamped = Math.min(
    MAX_PLAYBACK_RATE,
    Math.max(MIN_PLAYBACK_RATE, finiteOrDefault(rate, DEFAULT_PLAYBACK_RATE)),
  );

  return Math.round(clamped * 100) / 100;
}

export function stepPlaybackRate(
  current: number,
  direction: -1 | 1,
  pitchPreservingSupported: boolean = true,
): number {
  return clampPlaybackRate(current + PLAYBACK_RATE_STEP * direction, pitchPreservingSupported);
}

export function formatPlaybackRate(rate: number): string {
  return `${clampPlaybackRate(rate).toFixed(2)}x`;
}

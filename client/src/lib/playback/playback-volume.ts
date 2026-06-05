export const DEFAULT_PLAYBACK_VOLUME = 1;
export const MIN_PLAYBACK_VOLUME = 0;
export const MAX_PLAYBACK_VOLUME = 1;
export const PLAYBACK_VOLUME_STEP = 0.05;

function finiteOrDefault(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clampPlaybackVolume(value: number | null | undefined): number {
  const clamped = Math.min(
    MAX_PLAYBACK_VOLUME,
    Math.max(MIN_PLAYBACK_VOLUME, finiteOrDefault(value, DEFAULT_PLAYBACK_VOLUME)),
  );

  return Math.round(clamped * 100) / 100;
}

export function stepPlaybackVolume(current: number, direction: -1 | 1): number {
  return clampPlaybackVolume(current + PLAYBACK_VOLUME_STEP * direction);
}

export function formatPlaybackVolume(volume: number): string {
  return `${Math.round(clampPlaybackVolume(volume) * 100)}%`;
}

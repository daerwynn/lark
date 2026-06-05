import type { Segment } from "@/types/Transcript";

// Lyrics appear slightly before their actual start so singers can prepare.
export const LYRIC_SEGMENT_LEAD_SEC = 0.15;

// Grace period after a segment ends before it disappears.
export const LYRIC_SEGMENT_LINGER_SEC = 0.5;

export interface PlaybackPhrasePair {
  activeIndex: number;
  nextIndex: number;
  active: Segment | null;
  next: Segment | null;
}

export interface LyricDisplayTiming {
  displayOffsetSec?: number;
  leadSec?: number;
  lingerSec?: number;
}

function timing(options: LyricDisplayTiming | undefined) {
  return {
    displayOffsetSec: options?.displayOffsetSec ?? 0,
    leadSec: options?.leadSec ?? LYRIC_SEGMENT_LEAD_SEC,
    lingerSec: options?.lingerSec ?? LYRIC_SEGMENT_LINGER_SEC,
  };
}

/**
 * Finds the lyric phrase index that should drive the current display.
 * Uses `hint` to skip already-passed segments but still handles backward seeks.
 */
export function findPlaybackSegmentIndex(
  segments: Segment[],
  time: number,
  hint: number = 0,
  options?: LyricDisplayTiming,
): number {
  if (segments.length === 0) return -1;

  const { displayOffsetSec, leadSec, lingerSec } = timing(options);
  const displayTime = time - displayOffsetSec;
  const start =
    hint >= 0 && hint < segments.length && displayTime >= segments[hint].start - leadSec ? hint : 0;

  for (let i = start; i < segments.length; i++) {
    if (displayTime >= segments[i].end + lingerSec) {
      continue;
    }

    const next = i + 1;
    if (next < segments.length && displayTime >= segments[next].start - leadSec) {
      return next;
    }

    return i;
  }

  return segments.length - 1;
}

export function getPlaybackPhrasePair(
  segments: Segment[],
  time: number,
  hint: number = 0,
  options?: LyricDisplayTiming,
): PlaybackPhrasePair {
  const activeIndex = findPlaybackSegmentIndex(segments, time, hint, options);
  const nextIndex = activeIndex >= 0 && activeIndex + 1 < segments.length ? activeIndex + 1 : -1;

  return {
    activeIndex,
    nextIndex,
    active: activeIndex >= 0 ? segments[activeIndex] : null,
    next: nextIndex >= 0 ? segments[nextIndex] : null,
  };
}

export function isPlaybackSegmentVisible(
  segment: Segment,
  time: number,
  options?: LyricDisplayTiming,
): boolean {
  const { displayOffsetSec, leadSec, lingerSec } = timing(options);
  const displayTime = time - displayOffsetSec;

  return displayTime >= segment.start - leadSec && displayTime <= segment.end + lingerSec;
}

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

/**
 * Finds the lyric phrase index that should drive the current display.
 * Uses `hint` to skip already-passed segments but still handles backward seeks.
 */
export function findPlaybackSegmentIndex(
  segments: Segment[],
  time: number,
  hint: number = 0,
): number {
  if (segments.length === 0) return -1;

  const start =
    hint >= 0 && hint < segments.length && time >= segments[hint].start - LYRIC_SEGMENT_LEAD_SEC
      ? hint
      : 0;

  for (let i = start; i < segments.length; i++) {
    if (time >= segments[i].end + LYRIC_SEGMENT_LINGER_SEC) {
      continue;
    }

    const next = i + 1;
    if (next < segments.length && time >= segments[next].start - LYRIC_SEGMENT_LEAD_SEC) {
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
): PlaybackPhrasePair {
  const activeIndex = findPlaybackSegmentIndex(segments, time, hint);
  const nextIndex = activeIndex >= 0 && activeIndex + 1 < segments.length ? activeIndex + 1 : -1;

  return {
    activeIndex,
    nextIndex,
    active: activeIndex >= 0 ? segments[activeIndex] : null,
    next: nextIndex >= 0 ? segments[nextIndex] : null,
  };
}

export function isPlaybackSegmentVisible(segment: Segment, time: number): boolean {
  return (
    time >= segment.start - LYRIC_SEGMENT_LEAD_SEC && time <= segment.end + LYRIC_SEGMENT_LINGER_SEC
  );
}

import type { PitchSeries } from "@/lib/pitch/state";
import type { Segment } from "@/types/Transcript";
import { findPracticeSegmentIndex } from "./practice-pitch";

export type PracticeLoopSource = "phrase" | "manual";
export type PracticeCountInSec = 0 | 1 | 2;

export interface PracticeLoopRange {
  start: number;
  end: number;
  source: PracticeLoopSource;
  label: string;
}

export const DEFAULT_LOOP_COUNT_IN_SEC: PracticeCountInSec = 1;
export const MIN_PRACTICE_LOOP_DURATION = 0.75;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function clampLoopTime(time: number, duration: number): number {
  const max = Math.max(0, finiteOrZero(duration));
  return Math.min(max, Math.max(0, finiteOrZero(time)));
}

export function normalizePracticeCountIn(value: number): PracticeCountInSec {
  if (!Number.isFinite(value)) return DEFAULT_LOOP_COUNT_IN_SEC;
  return Math.min(2, Math.max(0, Math.round(value))) as PracticeCountInSec;
}

export function createPracticeLoopRange(
  start: number,
  end: number,
  source: PracticeLoopSource,
  duration: number,
  label: string,
): PracticeLoopRange | null {
  const clampedStart = clampLoopTime(start, duration);
  const clampedEnd = clampLoopTime(end, duration);
  const rangeStart = Math.min(clampedStart, clampedEnd);
  const rangeEnd = Math.max(clampedStart, clampedEnd);

  if (rangeEnd - rangeStart < MIN_PRACTICE_LOOP_DURATION) {
    return null;
  }

  return {
    start: rangeStart,
    end: rangeEnd,
    source,
    label,
  };
}

export function createManualLoopRange(
  start: number | null,
  end: number | null,
  duration: number,
): PracticeLoopRange | null {
  if (start == null || end == null) {
    return null;
  }

  return createPracticeLoopRange(start, end, "manual", duration, "Manual loop");
}

export function createPhraseLoopRange(
  segments: Segment[],
  currentTime: number,
  duration: number,
  lyricDisplayOffsetSec: number = 0,
  lyricLeadSec?: number,
): PracticeLoopRange | null {
  const index = findPracticeSegmentIndex(
    segments,
    currentTime,
    lyricDisplayOffsetSec,
    lyricLeadSec,
  );
  const segment = index >= 0 ? segments[index] : null;
  if (!segment) {
    return null;
  }

  return createPracticeLoopRange(
    segment.start,
    segment.end,
    "phrase",
    duration,
    segment.text.trim() || "Phrase loop",
  );
}

export function loopRetrySeekTime(range: PracticeLoopRange, countInSec: number): number {
  return Math.max(0, range.start - normalizePracticeCountIn(countInSec));
}

export function didCrossLoopEnd(
  previousTime: number,
  currentTime: number,
  range: PracticeLoopRange,
): boolean {
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
    return false;
  }
  if (currentTime < previousTime) {
    return false;
  }

  return previousTime < range.end && currentTime >= range.end;
}

export function computeLoopAttemptScore(
  series: PitchSeries,
  range: PracticeLoopRange,
): number | null {
  const scores: number[] = [];

  for (let i = 0; i < series.times.length; i++) {
    const time = series.times[i];
    if (time < range.start || time > range.end) {
      continue;
    }
    if (series.refPitches[i] == null || series.userPitches[i] == null) {
      continue;
    }
    const similarity = series.similarities[i];
    if (!Number.isFinite(similarity)) {
      continue;
    }
    scores.push(Math.min(1, Math.max(0, similarity)));
  }

  if (scores.length === 0) {
    return null;
  }

  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return Math.round(average * 100);
}

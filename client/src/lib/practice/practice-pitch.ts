import type { PitchSeries } from "@/lib/pitch/state";
import { freqToSemitone, snapToRefOctave } from "@/lib/pitch/state";
import type { Segment, Word } from "@/types/Transcript";

export const DEFAULT_PRACTICE_RANGE = 24;
export const MIN_PRACTICE_RANGE = 12;
export const MAX_PRACTICE_RANGE = 48;
export const PRACTICE_WINDOW_BEFORE = 5;
export const PRACTICE_WINDOW_AFTER = 8;
export const PRACTICE_LANE_PADDING_Y = 26;

const SEGMENT_LEAD_SEC = 1;
const SEGMENT_LINGER_SEC = 0.75;
const FALLBACK_SAMPLE_COUNT = 30;
const CHART_PITCH_MATCH_TOLERANCE_SEC = 0.2;

export type ExpectedPitchSource = "chart" | "reference" | "none";

export interface PracticeExpectedNote {
  start: number;
  end: number;
  pitch: number;
  label: string;
  source: ExpectedPitchSource;
  estimated?: boolean;
}

export interface PracticeTracePoint {
  time: number;
  pitch: number;
  similarity: number;
  hasReference: boolean;
}

export interface PracticeMissingChartData {
  absoluteNoteHz: boolean;
  noteKinds: boolean;
  phraseIds: boolean;
  syllableNotes: boolean;
}

export interface PracticePitchCalibration {
  midiOffset: number | null;
  sampleCount: number;
  source: "reference" | "none";
}

export interface PracticeVerticalRange {
  min: number;
  max: number;
  center: number;
  range: number;
}

export interface PracticeLaneModel {
  currentSegment: Segment | null;
  currentSegmentIndex: number;
  expectedSource: ExpectedPitchSource;
  expectedNotes: PracticeExpectedNote[];
  referenceTrace: PracticeTracePoint[];
  userTrace: PracticeTracePoint[];
  matchQuality: number | null;
  latestUserPitch: PracticeTracePoint | null;
  vertical: PracticeVerticalRange;
  missingChartData: PracticeMissingChartData;
  pitchCalibration: PracticePitchCalibration;
  currentExpectedNote: PracticeExpectedNote | null;
  latestCentsDifference: number | null;
}

export interface BuildPracticeLaneArgs {
  segments: Segment[];
  series: PitchSeries;
  currentTime: number;
  semitoneRange?: number;
  windowBefore?: number;
  windowAfter?: number;
  lyricDisplayOffsetSec?: number;
  lyricLeadSec?: number;
}

const DEFAULT_MISSING_CHART_DATA: PracticeMissingChartData = {
  absoluteNoteHz: true,
  noteKinds: true,
  phraseIds: true,
  syllableNotes: true,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clampPracticeRange(range: number): number {
  if (!Number.isFinite(range)) return DEFAULT_PRACTICE_RANGE;
  return Math.min(MAX_PRACTICE_RANGE, Math.max(MIN_PRACTICE_RANGE, Math.round(range)));
}

export function findPracticeSegmentIndex(
  segments: Segment[],
  currentTime: number,
  lyricDisplayOffsetSec: number = 0,
  lyricLeadSec: number = SEGMENT_LEAD_SEC,
): number {
  if (segments.length === 0) return -1;

  const displayTime = currentTime - lyricDisplayOffsetSec;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (displayTime < segment.start - lyricLeadSec) {
      return i;
    }
    if (displayTime > segment.end + SEGMENT_LINGER_SEC) {
      continue;
    }

    const next = i + 1;
    if (next < segments.length && displayTime >= segments[next].start - lyricLeadSec) {
      return next;
    }

    return i;
  }

  const upcoming = segments.findIndex((segment) => displayTime < segment.start);
  return upcoming >= 0 ? upcoming : segments.length - 1;
}

export function isPracticeSegmentDisplayVisible(
  segment: Segment,
  currentTime: number,
  lyricDisplayOffsetSec: number = 0,
  lyricLeadSec: number = SEGMENT_LEAD_SEC,
): boolean {
  const displayTime = currentTime - lyricDisplayOffsetSec;
  return (
    displayTime >= segment.start - lyricLeadSec && displayTime <= segment.end + SEGMENT_LINGER_SEC
  );
}

function wordPitch(word: Word): number | null {
  return isFiniteNumber(word.pitch) ? word.pitch : null;
}

export function extractChartNotes(segments: Segment[]): PracticeExpectedNote[] {
  const notes: PracticeExpectedNote[] = [];

  for (const segment of segments) {
    for (const word of segment.words) {
      const pitch = wordPitch(word);
      if (pitch == null) continue;

      notes.push({
        start: word.start,
        end: word.end,
        pitch,
        label: word.word,
        source: "chart",
        estimated: word.estimated,
      });
    }
  }

  return notes;
}

export function expectedNoteAtTime(
  notes: PracticeExpectedNote[],
  time: number,
  toleranceSec: number = CHART_PITCH_MATCH_TOLERANCE_SEC,
): PracticeExpectedNote | null {
  const exact = notes.find((note) => time >= note.start && time <= note.end);
  if (exact) return exact;

  if (toleranceSec <= 0) {
    return null;
  }

  let best: PracticeExpectedNote | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const note of notes) {
    const distance = Math.min(Math.abs(time - note.start), Math.abs(time - note.end));
    if (distance < bestDistance) {
      best = note;
      bestDistance = distance;
    }
  }

  return best && bestDistance <= toleranceSec ? best : null;
}

function chartPitchAtTime(notes: PracticeExpectedNote[], time: number): number | null {
  return expectedNoteAtTime(notes, time)?.pitch ?? null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function computeChartPitchCalibration(
  series: PitchSeries,
  chartNotes: PracticeExpectedNote[],
): PracticePitchCalibration {
  if (chartNotes.length === 0) {
    return { midiOffset: null, sampleCount: 0, source: "none" };
  }

  const offsets: number[] = [];
  for (let i = 0; i < series.times.length; i++) {
    const time = series.times[i];
    const refHz = series.refPitches[i];
    if (!isFiniteNumber(time) || !isFiniteNumber(refHz) || refHz <= 0) continue;

    const note = expectedNoteAtTime(chartNotes, time, 0);
    if (!note) continue;

    offsets.push(freqToSemitone(refHz) - note.pitch);
  }

  return {
    midiOffset: median(offsets),
    sampleCount: offsets.length,
    source: offsets.length > 0 ? "reference" : "none",
  };
}

function alignTracePitchToPracticeScale(
  hz: number,
  time: number,
  refSemi: number | null,
  chartNotes: PracticeExpectedNote[],
  calibration: PracticePitchCalibration,
  kind: "reference" | "user",
): number {
  const chartPitch = chartPitchAtTime(chartNotes, time);
  let pitch = freqToSemitone(hz);

  if (kind === "user") {
    if (refSemi != null) {
      pitch = snapToRefOctave(refSemi, pitch);
    } else if (chartPitch != null && calibration.midiOffset != null) {
      pitch = snapToRefOctave(chartPitch + calibration.midiOffset, pitch);
    }
  }

  if (calibration.midiOffset != null) {
    return pitch - calibration.midiOffset;
  }

  if (chartPitch != null && refSemi != null) {
    return pitch + chartPitch - refSemi;
  }

  return pitch;
}

function tracePointFromHz(
  hz: number | null | undefined,
  index: number,
  series: PitchSeries,
  chartNotes: PracticeExpectedNote[],
  calibration: PracticePitchCalibration,
  kind: "reference" | "user",
): PracticeTracePoint | null {
  if (!isFiniteNumber(hz) || hz <= 0) return null;

  const time = series.times[index];
  if (!isFiniteNumber(time)) return null;

  const refHz = series.refPitches[index];
  const refSemi = isFiniteNumber(refHz) && refHz > 0 ? freqToSemitone(refHz) : null;
  const pitch = alignTracePitchToPracticeScale(hz, time, refSemi, chartNotes, calibration, kind);

  return {
    time,
    pitch,
    similarity: series.similarities[index] ?? 0,
    hasReference: refSemi != null,
  };
}

export function buildReferenceTrace(
  series: PitchSeries,
  chartNotes: PracticeExpectedNote[] = [],
  calibration: PracticePitchCalibration = computeChartPitchCalibration(series, chartNotes),
): PracticeTracePoint[] {
  return series.refPitches
    .map((hz, index) => tracePointFromHz(hz, index, series, chartNotes, calibration, "reference"))
    .filter((point): point is PracticeTracePoint => point != null);
}

export function buildUserTrace(
  series: PitchSeries,
  chartNotes: PracticeExpectedNote[] = [],
  calibration: PracticePitchCalibration = computeChartPitchCalibration(series, chartNotes),
): PracticeTracePoint[] {
  return series.userPitches
    .map((hz, index) => tracePointFromHz(hz, index, series, chartNotes, calibration, "user"))
    .filter((point): point is PracticeTracePoint => point != null);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function computePhraseMatchQuality(
  series: PitchSeries,
  segment: Segment | null,
  fallbackSampleCount: number = FALLBACK_SAMPLE_COUNT,
): number | null {
  const usable: number[] = [];

  if (segment) {
    for (let i = 0; i < series.times.length; i++) {
      const time = series.times[i];
      if (time < segment.start || time > segment.end) continue;
      if (series.refPitches[i] == null || series.userPitches[i] == null) continue;
      usable.push(series.similarities[i] ?? 0);
    }
  }

  const inPhrase = average(usable);
  if (inPhrase != null) return Math.round(inPhrase * 100);

  const fallback = series.similarities
    .map((similarity, index) => ({ similarity, index }))
    .filter(({ index }) => series.refPitches[index] != null && series.userPitches[index] != null)
    .slice(-fallbackSampleCount)
    .map(({ similarity }) => similarity);

  const rolling = average(fallback);
  return rolling == null ? null : Math.round(rolling * 100);
}

function valuesInWindow<T extends { time?: number; start?: number; end?: number; pitch: number }>(
  items: T[],
  start: number,
  end: number,
): number[] {
  return items
    .filter((item) => {
      const itemStart = item.start ?? item.time ?? 0;
      const itemEnd = item.end ?? item.time ?? 0;
      return itemEnd >= start && itemStart <= end;
    })
    .map((item) => item.pitch);
}

function computeVerticalRange(
  expectedNotes: PracticeExpectedNote[],
  referenceTrace: PracticeTracePoint[],
  userTrace: PracticeTracePoint[],
  currentTime: number,
  range: number,
  windowBefore: number,
  windowAfter: number,
): PracticeVerticalRange {
  const windowStart = currentTime - windowBefore;
  const windowEnd = currentTime + windowAfter;
  const expectedValues = valuesInWindow(expectedNotes, windowStart, windowEnd);
  const traceSource = expectedValues.length > 0 ? [] : [...referenceTrace, ...userTrace];
  const traceValues = valuesInWindow(traceSource, windowStart, windowEnd);
  const values = expectedValues.length > 0 ? expectedValues : traceValues;
  const center = average(values) ?? 60;
  const half = range / 2;

  return {
    min: center - half,
    max: center + half,
    center,
    range,
  };
}

export interface PracticeTimeViewport {
  currentTime: number;
  width: number;
  windowBefore?: number;
  windowAfter?: number;
}

export function practiceTimeToX({
  time,
  currentTime,
  width,
  windowBefore = PRACTICE_WINDOW_BEFORE,
  windowAfter = PRACTICE_WINDOW_AFTER,
}: PracticeTimeViewport & { time: number }): number {
  const start = currentTime - windowBefore;
  const span = windowBefore + windowAfter;
  return ((time - start) / span) * width;
}

export function practicePitchToY(
  pitch: number,
  vertical: PracticeVerticalRange,
  height: number,
  paddingY: number = PRACTICE_LANE_PADDING_Y,
): number {
  const plotHeight = Math.max(1, height - paddingY * 2);
  const normalized = (pitch - vertical.min) / vertical.range;
  const clamped = Math.min(1, Math.max(0, normalized));
  return paddingY + (1 - clamped) * plotHeight;
}

export function computePitchCentsDifference(
  expectedPitch: number | null | undefined,
  userPitch: number | null | undefined,
): number | null {
  if (!isFiniteNumber(expectedPitch) || !isFiniteNumber(userPitch)) return null;
  return Math.round((userPitch - expectedPitch) * 100);
}

export function filterPitchSeriesSince(series: PitchSeries, startTime: number): PitchSeries {
  if (!Number.isFinite(startTime) || startTime <= 0) {
    return series;
  }

  const refPitches: (number | null)[] = [];
  const userPitches: (number | null)[] = [];
  const similarities: number[] = [];
  const times: number[] = [];

  for (let i = 0; i < series.times.length; i++) {
    if (series.times[i] < startTime) continue;
    refPitches.push(series.refPitches[i] ?? null);
    userPitches.push(series.userPitches[i] ?? null);
    similarities.push(series.similarities[i] ?? 0);
    times.push(series.times[i]);
  }

  return { refPitches, userPitches, similarities, times };
}

function notesFromReferenceTrace(trace: PracticeTracePoint[]): PracticeExpectedNote[] {
  return trace.map((point) => ({
    start: point.time,
    end: point.time,
    pitch: point.pitch,
    label: "",
    source: "reference",
  }));
}

export function buildPracticeLaneModel({
  segments,
  series,
  currentTime,
  semitoneRange = DEFAULT_PRACTICE_RANGE,
  windowBefore = PRACTICE_WINDOW_BEFORE,
  windowAfter = PRACTICE_WINDOW_AFTER,
  lyricDisplayOffsetSec = 0,
  lyricLeadSec = SEGMENT_LEAD_SEC,
}: BuildPracticeLaneArgs): PracticeLaneModel {
  const range = clampPracticeRange(semitoneRange);
  const currentSegmentIndex = findPracticeSegmentIndex(
    segments,
    currentTime,
    lyricDisplayOffsetSec,
    lyricLeadSec,
  );
  const currentSegment = currentSegmentIndex >= 0 ? segments[currentSegmentIndex] : null;
  const chartNotes = extractChartNotes(segments);
  const hasChartNotes = chartNotes.length > 0;
  const pitchCalibration = computeChartPitchCalibration(series, chartNotes);
  const referenceTrace = buildReferenceTrace(series, chartNotes, pitchCalibration);
  const userTrace = buildUserTrace(series, chartNotes, pitchCalibration);
  const expectedNotes = hasChartNotes ? chartNotes : notesFromReferenceTrace(referenceTrace);
  const expectedSource: ExpectedPitchSource = hasChartNotes
    ? "chart"
    : referenceTrace.length > 0
      ? "reference"
      : "none";
  const latestUserPitch = userTrace.length > 0 ? userTrace[userTrace.length - 1] : null;
  const expectedForLatestUser = latestUserPitch
    ? expectedNoteAtTime(expectedNotes, latestUserPitch.time)
    : null;

  return {
    currentSegment,
    currentSegmentIndex,
    expectedSource,
    expectedNotes,
    referenceTrace,
    userTrace,
    matchQuality: computePhraseMatchQuality(series, currentSegment),
    latestUserPitch,
    vertical: computeVerticalRange(
      expectedNotes,
      referenceTrace,
      userTrace,
      currentTime,
      range,
      windowBefore,
      windowAfter,
    ),
    missingChartData: hasChartNotes
      ? DEFAULT_MISSING_CHART_DATA
      : {
          ...DEFAULT_MISSING_CHART_DATA,
          syllableNotes: true,
        },
    pitchCalibration,
    currentExpectedNote: expectedNoteAtTime(expectedNotes, currentTime),
    latestCentsDifference: computePitchCentsDifference(
      expectedForLatestUser?.pitch,
      latestUserPitch?.pitch,
    ),
  };
}

import type { PitchLiveDisplayKind, PitchSeries } from "@/lib/pitch/state";
import { freqToSemitone, snapToRefOctave } from "@/lib/pitch/state";
import {
  buildLiveVoiceTracePoint,
  computeRollingBaselineOctaveOffset,
  LiveVoiceDisplayStabilizer,
  type LiveVoiceTracePoint,
} from "@/lib/pitch/live-voice-trace";
import type { Segment, Word } from "@/types/Transcript";

export const DEFAULT_PRACTICE_RANGE = 24;
export const MIN_PRACTICE_RANGE = 12;
export const MAX_PRACTICE_RANGE = 48;
export const PRACTICE_WINDOW_BEFORE = 5;
export const PRACTICE_WINDOW_AFTER = 8;
export const PRACTICE_LANE_PADDING_Y = 26;
export const MAX_TRACE_CONNECTION_GAP_SEC = 0.15;

const SEGMENT_LEAD_SEC = 1;
const SEGMENT_LINGER_SEC = 0.75;
const FALLBACK_SAMPLE_COUNT = 30;
const CHART_PITCH_MATCH_TOLERANCE_SEC = 0.2;
const STABLE_VERTICAL_PADDING_SEMITONES = 6;

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
  breakBefore?: boolean;
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
  source: "guide-vocal" | "user-mic" | "reference" | "none";
  confidence: number;
  quality: "none" | "low" | "ok" | "good";
}

export interface PracticeVerticalRange {
  min: number;
  max: number;
  center: number;
  range: number;
  source: "chart" | "stable-fallback";
  manualRange: boolean;
}

export interface PracticeLaneModel {
  currentSegment: Segment | null;
  currentSegmentIndex: number;
  expectedSource: ExpectedPitchSource;
  expectedNotes: PracticeExpectedNote[];
  referenceTrace: PracticeTracePoint[];
  rawUserTrace: PracticeTracePoint[];
  userTrace: PracticeTracePoint[];
  rawLiveVoiceTrace: LiveVoiceTracePoint[];
  chartRelativeVoiceTrace: LiveVoiceTracePoint[];
  liveVoiceTrace: LiveVoiceTracePoint[];
  matchQuality: number | null;
  latestUserPitch: PracticeTracePoint | null;
  latestLiveVoicePoint: LiveVoiceTracePoint | null;
  latestChartRelativeVoicePoint: LiveVoiceTracePoint | null;
  vertical: PracticeVerticalRange;
  missingChartData: PracticeMissingChartData;
  pitchCalibration: PracticePitchCalibration;
  currentExpectedNote: PracticeExpectedNote | null;
  latestCentsDifference: number | null;
  latestLiveCentsDifference: number | null;
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

export interface MicLatencyAdjustmentEstimate {
  observedOffsetMs: number;
  suggestedAdjustmentMs: number;
  sampleCount: number;
}

export type PracticeViewMode = "follow" | "review";

export interface PracticeReviewState {
  mode: PracticeViewMode;
  center: number;
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

function clampPracticeReviewCenter(center: number, duration: number): number {
  const max = Math.max(0, Number.isFinite(duration) ? duration : 0);
  return Math.min(max, Math.max(0, Number.isFinite(center) ? center : 0));
}

export function practiceReviewStateForPlayback(
  state: PracticeReviewState,
  isPlaying: boolean,
  currentTime: number,
  duration: number,
): PracticeReviewState {
  if (isPlaying || state.mode !== "follow") {
    return state;
  }

  return {
    mode: "review",
    center: clampPracticeReviewCenter(currentTime, duration),
  };
}

export function panPracticeReview(
  state: PracticeReviewState,
  deltaSec: number,
  duration: number,
): PracticeReviewState {
  return {
    mode: "review",
    center: clampPracticeReviewCenter(state.center + deltaSec, duration),
  };
}

export function followPracticePlayback(currentTime: number, duration: number): PracticeReviewState {
  return {
    mode: "follow",
    center: clampPracticeReviewCenter(currentTime, duration),
  };
}

export function reviewPracticeAttempt(currentTime: number, duration: number): PracticeReviewState {
  return {
    mode: "review",
    center: clampPracticeReviewCenter(currentTime, duration),
  };
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

function expectedMidiForNote(
  note: PracticeExpectedNote | null,
  calibration: PracticePitchCalibration,
): number | null {
  if (!note) return null;
  return calibration.midiOffset == null ? note.pitch : note.pitch + calibration.midiOffset;
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
    return { midiOffset: null, sampleCount: 0, source: "none", confidence: 0, quality: "none" };
  }

  const offsets: number[] = [];
  for (let i = 0; i < series.times.length; i++) {
    const time = series.times[i];
    const refHz = series.refPitches[i];
    if (!isFiniteNumber(time) || !isFiniteNumber(refHz) || refHz <= 0) continue;

    const note = expectedNoteAtTime(chartNotes, time, CHART_PITCH_MATCH_TOLERANCE_SEC);
    if (!note) continue;

    offsets.push(freqToSemitone(refHz) - note.pitch);
  }

  return {
    midiOffset: median(offsets),
    sampleCount: offsets.length,
    source: offsets.length > 0 ? "reference" : "none",
    confidence: Math.min(1, offsets.length / FALLBACK_SAMPLE_COUNT),
    quality: offsets.length === 0 ? "none" : offsets.length >= FALLBACK_SAMPLE_COUNT ? "ok" : "low",
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
    } else if (chartPitch != null) {
      pitch = snapToRefOctave(chartPitch, pitch);
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
  breakBefore = false,
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
    breakBefore,
  };
}

function buildTraceFromPitches(
  pitches: (number | null | undefined)[],
  series: PitchSeries,
  chartNotes: PracticeExpectedNote[],
  calibration: PracticePitchCalibration,
  kind: "reference" | "user",
): PracticeTracePoint[] {
  const points: PracticeTracePoint[] = [];
  let pendingBreak = false;

  for (let index = 0; index < pitches.length; index++) {
    pendingBreak ||= series.traceBreaks?.[index] ?? false;
    const point = tracePointFromHz(
      pitches[index],
      index,
      series,
      chartNotes,
      calibration,
      kind,
      pendingBreak,
    );
    if (!point) continue;

    points.push(point);
    pendingBreak = false;
  }

  return points;
}

export function buildReferenceTrace(
  series: PitchSeries,
  chartNotes: PracticeExpectedNote[] = [],
  calibration: PracticePitchCalibration = computeChartPitchCalibration(series, chartNotes),
): PracticeTracePoint[] {
  return buildTraceFromPitches(series.refPitches, series, chartNotes, calibration, "reference");
}

export function buildUserTrace(
  series: PitchSeries,
  chartNotes: PracticeExpectedNote[] = [],
  calibration: PracticePitchCalibration = computeChartPitchCalibration(series, chartNotes),
): PracticeTracePoint[] {
  return buildTraceFromPitches(series.userPitches, series, chartNotes, calibration, "user");
}

export function buildRawUserTrace(
  series: PitchSeries,
  chartNotes: PracticeExpectedNote[] = [],
  calibration: PracticePitchCalibration = computeChartPitchCalibration(series, chartNotes),
): PracticeTracePoint[] {
  return buildTraceFromPitches(
    series.rawMicHz ?? series.rawUserPitches ?? [],
    series,
    chartNotes,
    calibration,
    "user",
  );
}

export function buildRawLiveVoiceTrace(
  series: PitchSeries,
  chartNotes: PracticeExpectedNote[],
  calibration: PracticePitchCalibration = computeChartPitchCalibration(series, chartNotes),
): LiveVoiceTracePoint[] {
  void chartNotes;
  void calibration;

  const points: LiveVoiceTracePoint[] = [];
  const hasStoredLiveDisplay =
    (series.liveDisplayPitch?.length ?? 0) > 0 || (series.liveKind?.length ?? 0) > 0;

  for (let index = 0; index < series.times.length; index++) {
    const time = series.times[index];
    if (!isFiniteNumber(time)) continue;

    if (hasStoredLiveDisplay) {
      const point = storedLiveVoiceTracePoint(series, index, time);
      if (point) points.push(point);
      continue;
    }

    const point = legacyRawLiveVoiceTracePoint(series, index, time);
    if (point) points.push(point);
  }

  return points;
}

function storedLiveVoiceTracePoint(
  series: PitchSeries,
  index: number,
  time: number,
): LiveVoiceTracePoint | null {
  const displayPitch = series.liveDisplayPitch?.[index] ?? null;
  if (!isFiniteNumber(displayPitch)) return null;

  const kind = normalizeLiveKind(series.liveKind?.[index]);
  const rawHz = kind === "voiced" ? (series.rawMicHz?.[index] ?? null) : null;
  const storedRawMidi = series.rawMicMidi?.[index] ?? null;
  const rawMidi = isFiniteNumber(storedRawMidi)
    ? storedRawMidi
    : isFiniteNumber(rawHz)
      ? freqToSemitone(rawHz)
      : null;

  return {
    time,
    songTimeSec: time,
    rawHz,
    rawMidi,
    rawDisplayMidi: displayPitch,
    displayMidi: displayPitch,
    stableHz: kind === "voiced" ? rawHz : null,
    stableMidi: rawMidi,
    expectedChartPitch: series.expectedChartPitchAtFrame?.[index] ?? null,
    expectedMidi: series.liveExpectedRawMidi?.[index] ?? null,
    centsFromExpected: series.liveCentsFromExpected?.[index] ?? null,
    absoluteOctaveOffsetFromExpected: series.liveRegisterOffset?.[index] ?? null,
    baselineOctaveOffset: null,
    baselineRelativeOctaveOffset: null,
    offsetSource: series.liveOffsetSource?.[index] ?? null,
    micToChartOffset: series.micToChartOffsetAtFrame?.[index] ?? null,
    micToChartOffsetSampleCount: series.micToChartOffsetSampleCount?.[index] ?? 0,
    micToChartOffsetLocked: series.micToChartOffsetLocked?.[index] ?? false,
    guideVocalOffset: series.guideVocalOffsetAtFrame?.[index] ?? null,
    guideVocalOffsetSampleCount: series.guideVocalOffsetSampleCount?.[index] ?? 0,
    guideVocalConfidence: series.guideVocalConfidenceAtFrame?.[index] ?? 0,
    guideVocalQuality: series.guideVocalQualityAtFrame?.[index] ?? null,
    userMicOffset: series.userMicOffsetAtFrame?.[index] ?? null,
    userMicOffsetSampleCount: series.userMicOffsetSampleCount?.[index] ?? 0,
    userMicOffsetLocked: series.userMicOffsetLocked?.[index] ?? false,
    clarity: series.rawMicClarity?.[index] ?? null,
    rms: series.rawMicRms?.[index] ?? null,
    voiced: kind === "voiced",
    kind,
    traceBreak: series.traceBreaks?.[index] ?? false,
    accepted: kind === "voiced",
    scored: series.livePointScored?.[index] ?? false,
    dropReason: series.liveDropReason?.[index] ?? (kind === "silence" ? "unvoiced" : undefined),
    pitch: displayPitch,
  };
}

function legacyRawLiveVoiceTracePoint(
  series: PitchSeries,
  index: number,
  time: number,
): LiveVoiceTracePoint | null {
  const rawHz = series.rawMicHz?.[index] ?? null;
  const voiced = series.rawMicVoiced?.[index] ?? rawHz != null;

  if (voiced && isFiniteNumber(rawHz) && rawHz > 0) {
    const rawMidi = series.rawMicMidi?.[index] ?? freqToSemitone(rawHz);
    if (!isFiniteNumber(rawMidi)) return null;

    return {
      time,
      songTimeSec: time,
      rawHz,
      rawMidi,
      rawDisplayMidi: rawMidi,
      displayMidi: rawMidi,
      stableHz: rawHz,
      stableMidi: rawMidi,
      expectedChartPitch: null,
      expectedMidi: null,
      centsFromExpected: null,
      absoluteOctaveOffsetFromExpected: null,
      baselineOctaveOffset: null,
      baselineRelativeOctaveOffset: null,
      offsetSource: null,
      micToChartOffset: null,
      micToChartOffsetSampleCount: 0,
      micToChartOffsetLocked: false,
      guideVocalOffset: null,
      guideVocalOffsetSampleCount: 0,
      guideVocalConfidence: 0,
      guideVocalQuality: null,
      userMicOffset: null,
      userMicOffsetSampleCount: 0,
      userMicOffsetLocked: false,
      clarity: series.rawMicClarity?.[index] ?? null,
      rms: series.rawMicRms?.[index] ?? null,
      voiced: true,
      kind: "voiced",
      traceBreak: series.traceBreaks?.[index] ?? false,
      accepted: true,
      scored: false,
      pitch: rawMidi,
    };
  }

  return null;
}

function normalizeLiveKind(kind: PitchLiveDisplayKind | null | undefined): PitchLiveDisplayKind {
  return kind === "silence" ? "silence" : "voiced";
}

export function buildChartRelativeVoiceTrace(
  series: PitchSeries,
  chartNotes: PracticeExpectedNote[],
  calibration: PracticePitchCalibration = computeChartPitchCalibration(series, chartNotes),
): LiveVoiceTracePoint[] {
  const points: LiveVoiceTracePoint[] = [];
  let pendingBreak = false;
  let baselineOctaveOffset: number | null = null;
  const hasChartNotes = chartNotes.length > 0;
  const displayStabilizer = new LiveVoiceDisplayStabilizer();

  for (let index = 0; index < series.times.length; index++) {
    pendingBreak ||= series.traceBreaks?.[index] ?? false;
    const rawHz = series.rawMicHz?.[index] ?? null;
    const voiced = series.rawMicVoiced?.[index] ?? rawHz != null;
    const time = series.times[index];
    if (!voiced || rawHz == null) {
      if (displayStabilizer.noteMissing(time).traceBreak) {
        pendingBreak = true;
      }
      continue;
    }

    const note = expectedNoteAtTime(chartNotes, time, 0);
    const refHz = series.refPitches[index];
    const refMidi = isFiniteNumber(refHz) && refHz > 0 ? freqToSemitone(refHz) : null;
    if (!note && (hasChartNotes || refMidi == null)) {
      if (displayStabilizer.noteMissing(time).traceBreak) {
        pendingBreak = true;
      }
      continue;
    }

    const expectedMidi = note ? expectedMidiForNote(note, calibration) : refMidi;
    const point = buildLiveVoiceTracePoint({
      time,
      rawHz,
      expectedMidi,
      expectedLaneMidi: note?.pitch ?? refMidi,
      baselineOctaveOffset,
      clarity: series.rawMicClarity?.[index] ?? null,
      rms: series.rawMicRms?.[index] ?? null,
      traceBreak: pendingBreak,
    });
    if (!point) {
      if (displayStabilizer.noteMissing(time).traceBreak) {
        pendingBreak = true;
      }
      continue;
    }

    const stablePoint = displayStabilizer.stabilize(point);
    if (!stablePoint) {
      continue;
    }

    stablePoint.traceBreak ||= pendingBreak;
    points.push(stablePoint);
    baselineOctaveOffset = computeRollingBaselineOctaveOffset(points, baselineOctaveOffset);
    const updatedPoint = points[points.length - 1];
    if (updatedPoint && baselineOctaveOffset != null) {
      updatedPoint.baselineOctaveOffset = baselineOctaveOffset;
      updatedPoint.baselineRelativeOctaveOffset =
        updatedPoint.absoluteOctaveOffsetFromExpected == null
          ? null
          : updatedPoint.absoluteOctaveOffsetFromExpected - baselineOctaveOffset;
    }
    pendingBreak = false;
  }

  return points;
}

export function buildLiveVoiceTrace(
  series: PitchSeries,
  chartNotes: PracticeExpectedNote[],
  calibration: PracticePitchCalibration = computeChartPitchCalibration(series, chartNotes),
): LiveVoiceTracePoint[] {
  return buildRawLiveVoiceTrace(series, chartNotes, calibration);
}

export function shouldConnectTracePoints(
  previous: PracticeTracePoint,
  point: PracticeTracePoint,
  maxGapSec: number = MAX_TRACE_CONNECTION_GAP_SEC,
): boolean {
  if (previous.breakBefore || point.breakBefore) return false;
  if (!Number.isFinite(previous.time) || !Number.isFinite(point.time)) return false;
  return point.time - previous.time <= maxGapSec;
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

function computeVerticalRange(
  chartNotes: PracticeExpectedNote[],
  referenceTrace: PracticeTracePoint[],
  selectedRange: number,
): PracticeVerticalRange {
  const chartValues = chartNotes.map((note) => note.pitch).filter(isFiniteNumber);
  const values =
    chartValues.length > 0
      ? chartValues
      : referenceTrace.map((point) => point.pitch).filter(isFiniteNumber);
  const source: PracticeVerticalRange["source"] =
    chartValues.length > 0 ? "chart" : "stable-fallback";
  const minPitch = values.length > 0 ? Math.min(...values) : 60;
  const maxPitch = values.length > 0 ? Math.max(...values) : 60;
  const center = (minPitch + maxPitch) / 2;
  const requiredRange = Math.max(1, maxPitch - minPitch + STABLE_VERTICAL_PADDING_SEMITONES);
  const range = Math.max(selectedRange, requiredRange);
  const half = range / 2;

  return {
    min: center - half,
    max: center + half,
    center,
    range,
    source,
    manualRange: selectedRange >= requiredRange,
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
  const rawUserPitches: (number | null)[] = [];
  const rawMicHz: (number | null)[] = [];
  const rawMicMidi: (number | null)[] = [];
  const rawMicClarity: (number | null)[] = [];
  const rawMicRms: (number | null)[] = [];
  const rawMicVoiced: boolean[] = [];
  const scoringExpectedHz: (number | null)[] = [];
  const scoringMicHz: (number | null)[] = [];
  const scoringSimilarities: number[] = [];
  const micFrameIds: (number | null)[] = [];
  const traceBreaks: boolean[] = [];
  const liveDisplayPitch: (number | null)[] = [];
  const liveCentsFromExpected: (number | null)[] = [];
  const liveRegisterOffset: (number | null)[] = [];
  const liveKind: (PitchLiveDisplayKind | null)[] = [];
  const liveDropReason: NonNullable<PitchSeries["liveDropReason"]> = [];
  const liveOffsetSource: NonNullable<PitchSeries["liveOffsetSource"]> = [];
  const expectedChartPitchAtFrame: (number | null)[] = [];
  const liveExpectedRawMidi: (number | null)[] = [];
  const micToChartOffsetAtFrame: (number | null)[] = [];
  const micToChartOffsetSampleCount: number[] = [];
  const micToChartOffsetLocked: boolean[] = [];
  const guideVocalOffsetAtFrame: (number | null)[] = [];
  const guideVocalOffsetSampleCount: number[] = [];
  const guideVocalConfidenceAtFrame: number[] = [];
  const guideVocalQualityAtFrame: NonNullable<PitchSeries["guideVocalQualityAtFrame"]> = [];
  const userMicOffsetAtFrame: (number | null)[] = [];
  const userMicOffsetSampleCount: number[] = [];
  const userMicOffsetLocked: boolean[] = [];
  const livePointScored: boolean[] = [];
  const similarities: number[] = [];
  const times: number[] = [];

  for (let i = 0; i < series.times.length; i++) {
    if (series.times[i] < startTime) continue;
    refPitches.push(series.refPitches[i] ?? null);
    userPitches.push(series.userPitches[i] ?? null);
    rawUserPitches.push(series.rawUserPitches?.[i] ?? null);
    rawMicHz.push(series.rawMicHz?.[i] ?? null);
    rawMicMidi.push(series.rawMicMidi?.[i] ?? null);
    rawMicClarity.push(series.rawMicClarity?.[i] ?? null);
    rawMicRms.push(series.rawMicRms?.[i] ?? null);
    rawMicVoiced.push(series.rawMicVoiced?.[i] ?? series.rawMicHz?.[i] != null);
    scoringExpectedHz.push(series.scoringExpectedHz?.[i] ?? null);
    scoringMicHz.push(series.scoringMicHz?.[i] ?? null);
    scoringSimilarities.push(series.scoringSimilarities?.[i] ?? series.similarities[i] ?? 0);
    micFrameIds.push(series.micFrameIds?.[i] ?? null);
    traceBreaks.push(series.traceBreaks?.[i] ?? false);
    liveDisplayPitch.push(series.liveDisplayPitch?.[i] ?? null);
    liveCentsFromExpected.push(series.liveCentsFromExpected?.[i] ?? null);
    liveRegisterOffset.push(series.liveRegisterOffset?.[i] ?? null);
    liveKind.push(series.liveKind?.[i] ?? null);
    liveDropReason.push(series.liveDropReason?.[i] ?? null);
    liveOffsetSource.push(series.liveOffsetSource?.[i] ?? null);
    expectedChartPitchAtFrame.push(series.expectedChartPitchAtFrame?.[i] ?? null);
    liveExpectedRawMidi.push(series.liveExpectedRawMidi?.[i] ?? null);
    micToChartOffsetAtFrame.push(series.micToChartOffsetAtFrame?.[i] ?? null);
    micToChartOffsetSampleCount.push(series.micToChartOffsetSampleCount?.[i] ?? 0);
    micToChartOffsetLocked.push(series.micToChartOffsetLocked?.[i] ?? false);
    guideVocalOffsetAtFrame.push(series.guideVocalOffsetAtFrame?.[i] ?? null);
    guideVocalOffsetSampleCount.push(series.guideVocalOffsetSampleCount?.[i] ?? 0);
    guideVocalConfidenceAtFrame.push(series.guideVocalConfidenceAtFrame?.[i] ?? 0);
    guideVocalQualityAtFrame.push(series.guideVocalQualityAtFrame?.[i] ?? null);
    userMicOffsetAtFrame.push(series.userMicOffsetAtFrame?.[i] ?? null);
    userMicOffsetSampleCount.push(series.userMicOffsetSampleCount?.[i] ?? 0);
    userMicOffsetLocked.push(series.userMicOffsetLocked?.[i] ?? false);
    livePointScored.push(series.livePointScored?.[i] ?? false);
    similarities.push(series.similarities[i] ?? 0);
    times.push(series.times[i]);
  }

  return {
    refPitches,
    userPitches,
    rawUserPitches,
    rawMicHz,
    rawMicMidi,
    rawMicClarity,
    rawMicRms,
    rawMicVoiced,
    scoringExpectedHz,
    scoringMicHz,
    scoringSimilarities,
    micFrameIds,
    traceBreaks,
    liveDisplayPitch,
    liveCentsFromExpected,
    liveRegisterOffset,
    liveKind,
    liveDropReason,
    liveOffsetSource,
    expectedChartPitchAtFrame,
    liveExpectedRawMidi,
    micToChartOffsetAtFrame,
    micToChartOffsetSampleCount,
    micToChartOffsetLocked,
    guideVocalOffsetAtFrame,
    guideVocalOffsetSampleCount,
    guideVocalConfidenceAtFrame,
    guideVocalQualityAtFrame,
    userMicOffsetAtFrame,
    userMicOffsetSampleCount,
    userMicOffsetLocked,
    livePointScored,
    similarities,
    times,
  };
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

export function estimateMicLatencyAdjustment(
  series: PitchSeries,
  expectedNotes: PracticeExpectedNote[],
  maxDistanceSec: number = 0.45,
): MicLatencyAdjustmentEstimate | null {
  if (series.times.length === 0 || expectedNotes.length === 0) return null;

  const offsets: number[] = [];
  let wasVoiced = false;

  for (let index = 0; index < series.times.length; index++) {
    const time = series.times[index];
    const kind = series.liveKind?.[index] ?? (series.rawMicVoiced?.[index] ? "voiced" : "silence");
    const voiced = kind === "voiced";

    if (voiced && !wasVoiced) {
      let nearest: PracticeExpectedNote | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const note of expectedNotes) {
        const distance = Math.abs(time - note.start);
        if (distance < nearestDistance) {
          nearest = note;
          nearestDistance = distance;
        }
      }

      if (nearest && nearestDistance <= maxDistanceSec) {
        offsets.push(time - nearest.start);
      }
    }

    wasVoiced = voiced;
  }

  const observedOffsetSec = median(offsets);
  if (observedOffsetSec == null) return null;

  return {
    observedOffsetMs: Math.round(observedOffsetSec * 1000),
    suggestedAdjustmentMs: Math.round(-observedOffsetSec * 1000),
    sampleCount: offsets.length,
  };
}

export function buildPracticeLaneModel({
  segments,
  series,
  currentTime,
  semitoneRange = DEFAULT_PRACTICE_RANGE,
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
  const rawUserTrace = buildRawUserTrace(series, chartNotes, pitchCalibration);
  const userTrace = buildUserTrace(series, chartNotes, pitchCalibration);
  const rawLiveVoiceTrace = buildRawLiveVoiceTrace(series, chartNotes, pitchCalibration);
  const chartRelativeVoiceTrace = buildChartRelativeVoiceTrace(
    series,
    chartNotes,
    pitchCalibration,
  );
  const liveVoiceTrace = rawLiveVoiceTrace;
  const expectedNotes = hasChartNotes ? chartNotes : notesFromReferenceTrace(referenceTrace);
  const expectedSource: ExpectedPitchSource = hasChartNotes
    ? "chart"
    : referenceTrace.length > 0
      ? "reference"
      : "none";
  const latestUserPitch = userTrace.length > 0 ? userTrace[userTrace.length - 1] : null;
  const latestLiveVoicePoint =
    liveVoiceTrace.length > 0 ? liveVoiceTrace[liveVoiceTrace.length - 1] : null;
  const latestChartRelativeVoicePoint =
    chartRelativeVoiceTrace.length > 0
      ? chartRelativeVoiceTrace[chartRelativeVoiceTrace.length - 1]
      : null;
  const expectedForLatestUser = latestUserPitch
    ? expectedNoteAtTime(expectedNotes, latestUserPitch.time)
    : null;

  return {
    currentSegment,
    currentSegmentIndex,
    expectedSource,
    expectedNotes,
    referenceTrace,
    rawUserTrace,
    userTrace,
    rawLiveVoiceTrace,
    chartRelativeVoiceTrace,
    liveVoiceTrace,
    matchQuality: computePhraseMatchQuality(series, currentSegment),
    latestUserPitch,
    latestLiveVoicePoint,
    latestChartRelativeVoicePoint,
    vertical: computeVerticalRange(chartNotes, referenceTrace, range),
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
    latestLiveCentsDifference: latestLiveVoicePoint?.centsFromExpected ?? null,
  };
}

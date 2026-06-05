import type { PracticePitchFeedbackSettings } from "@/lib/practice/practice-settings";
import { freqToSemitone } from "./state";

export type LiveVoiceAccuracy = "green" | "yellow" | "red" | "none";
export type LiveVoiceRegister = "baseline" | "higher" | "lower" | "extreme";

export interface LiveVoiceTracePoint {
  time: number;
  rawHz: number;
  rawMidi: number;
  displayMidi: number;
  expectedMidi: number | null;
  centsFromExpected: number | null;
  absoluteOctaveOffsetFromExpected: number | null;
  baselineOctaveOffset: number | null;
  baselineRelativeOctaveOffset: number | null;
  clarity: number | null;
  rms: number | null;
  voiced: true;
  traceBreak: boolean;
  pitch: number;
}

export interface LiveVoiceNormalization {
  displayMidi: number;
  centsFromExpected: number;
  absoluteOctaveOffsetFromExpected: number;
  baselineOctaveOffset: number | null;
  baselineRelativeOctaveOffset: number | null;
}

export interface BuildLiveVoicePointArgs {
  time: number;
  rawHz: number | null | undefined;
  expectedMidi: number | null | undefined;
  expectedLaneMidi?: number | null | undefined;
  baselineOctaveOffset?: number | null;
  clarity?: number | null;
  rms?: number | null;
  traceBreak?: boolean;
}

export interface LiveVoiceTraceStyle {
  accuracy: LiveVoiceAccuracy;
  register: LiveVoiceRegister;
  stroke: string;
  marker: string;
}

export const LIVE_VOICE_BASELINE_SAMPLE_COUNT = 45;
export const LIVE_VOICE_BASELINE_MAX_CENTS = 150;
export const LIVE_VOICE_MAX_CONNECTION_GAP_SEC = 0.15;

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundedCents(value: number): number {
  return Math.round(value * 100);
}

function rgba([r, g, b]: [number, number, number], alpha = 0.95): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function normalizeMicPitchForExpected(
  rawMidi: number,
  expectedMidi: number,
  baselineOctaveOffset: number | null = null,
): LiveVoiceNormalization {
  const octaveShift = Math.round((expectedMidi - rawMidi) / 12);
  const displayMidi = rawMidi + octaveShift * 12;
  const absoluteOctaveOffsetFromExpected = octaveShift === 0 ? 0 : -octaveShift;
  const centsFromExpected = roundedCents(displayMidi - expectedMidi);
  const baselineRelativeOctaveOffset =
    baselineOctaveOffset == null ? null : absoluteOctaveOffsetFromExpected - baselineOctaveOffset;

  return {
    displayMidi,
    centsFromExpected,
    absoluteOctaveOffsetFromExpected,
    baselineOctaveOffset,
    baselineRelativeOctaveOffset,
  };
}

export function buildLiveVoiceTracePoint({
  time,
  rawHz,
  expectedMidi,
  expectedLaneMidi = expectedMidi,
  baselineOctaveOffset = null,
  clarity = null,
  rms = null,
  traceBreak = false,
}: BuildLiveVoicePointArgs): LiveVoiceTracePoint | null {
  if (!Number.isFinite(time) || !isFinitePositive(rawHz)) {
    return null;
  }

  const rawMidi = freqToSemitone(rawHz);
  if (expectedMidi == null || !Number.isFinite(expectedMidi)) {
    return {
      time,
      rawHz,
      rawMidi,
      displayMidi: rawMidi,
      expectedMidi: null,
      centsFromExpected: null,
      absoluteOctaveOffsetFromExpected: null,
      baselineOctaveOffset: null,
      baselineRelativeOctaveOffset: null,
      clarity,
      rms,
      voiced: true,
      traceBreak,
      pitch: rawMidi,
    };
  }

  const normalized = normalizeMicPitchForExpected(rawMidi, expectedMidi, baselineOctaveOffset);
  const laneShift =
    expectedLaneMidi != null && Number.isFinite(expectedLaneMidi)
      ? expectedLaneMidi - expectedMidi
      : 0;

  return {
    time,
    rawHz,
    rawMidi,
    displayMidi: normalized.displayMidi,
    expectedMidi,
    centsFromExpected: normalized.centsFromExpected,
    absoluteOctaveOffsetFromExpected: normalized.absoluteOctaveOffsetFromExpected,
    baselineOctaveOffset: normalized.baselineOctaveOffset,
    baselineRelativeOctaveOffset: normalized.baselineRelativeOctaveOffset,
    clarity,
    rms,
    voiced: true,
    traceBreak,
    pitch: normalized.displayMidi + laneShift,
  };
}

export function computeRollingBaselineOctaveOffset(
  points: LiveVoiceTracePoint[],
  previousBaseline: number | null = null,
  sampleCount: number = LIVE_VOICE_BASELINE_SAMPLE_COUNT,
): number | null {
  const usable = points
    .filter(
      (point) =>
        point.absoluteOctaveOffsetFromExpected != null &&
        point.centsFromExpected != null &&
        Math.abs(point.centsFromExpected) <= LIVE_VOICE_BASELINE_MAX_CENTS,
    )
    .slice(-Math.max(1, sampleCount));

  if (usable.length === 0) {
    return previousBaseline;
  }

  const counts = new Map<number, number>();
  for (const point of usable) {
    const offset = point.absoluteOctaveOffsetFromExpected;
    if (offset == null) continue;
    counts.set(offset, (counts.get(offset) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return previousBaseline;
  }

  let bestOffset: number | null = null;
  let bestCount = -1;
  for (const [offset, count] of counts) {
    if (count > bestCount) {
      bestOffset = offset;
      bestCount = count;
    } else if (count === bestCount && offset === previousBaseline) {
      bestOffset = offset;
    }
  }

  return bestOffset;
}

export function liveVoiceAccuracyFromCents(
  centsFromExpected: number | null | undefined,
  settings: PracticePitchFeedbackSettings,
): LiveVoiceAccuracy {
  if (typeof centsFromExpected !== "number" || !Number.isFinite(centsFromExpected)) {
    return "none";
  }

  const abs = Math.abs(centsFromExpected);
  if (abs <= settings.greenCents) return "green";
  if (abs <= settings.yellowCents) return "yellow";
  return "red";
}

export function liveVoiceRegisterFromRelativeOffset(
  relativeOffset: number | null | undefined,
): LiveVoiceRegister {
  if (typeof relativeOffset !== "number" || !Number.isFinite(relativeOffset)) {
    return "baseline";
  }
  if (Math.abs(relativeOffset) >= 2) return "extreme";
  if (relativeOffset > 0) return "higher";
  if (relativeOffset < 0) return "lower";
  return "baseline";
}

export function styleLiveVoiceTracePoint(
  point: LiveVoiceTracePoint,
  settings: PracticePitchFeedbackSettings,
): LiveVoiceTraceStyle {
  const accuracy = liveVoiceAccuracyFromCents(point.centsFromExpected, settings);
  const register = liveVoiceRegisterFromRelativeOffset(point.baselineRelativeOctaveOffset);
  const palette: Record<LiveVoiceAccuracy, Record<LiveVoiceRegister, [number, number, number]>> = {
    green: {
      baseline: [78, 255, 126],
      higher: [156, 255, 190],
      lower: [22, 166, 84],
      extreme: [255, 255, 255],
    },
    yellow: {
      baseline: [255, 218, 82],
      higher: [255, 238, 151],
      lower: [190, 145, 26],
      extreme: [255, 178, 70],
    },
    red: {
      baseline: [255, 88, 88],
      higher: [255, 155, 145],
      lower: [175, 40, 56],
      extreme: [255, 66, 220],
    },
    none: {
      baseline: [185, 190, 198],
      higher: [218, 222, 230],
      lower: [120, 126, 136],
      extreme: [210, 120, 255],
    },
  };

  const rgb = palette[accuracy][register];
  return {
    accuracy,
    register,
    stroke: rgba(rgb, register === "extreme" ? 1 : 0.96),
    marker: rgba(rgb, 1),
  };
}

export function shouldConnectLiveVoiceTracePoints(
  previous: LiveVoiceTracePoint,
  point: LiveVoiceTracePoint,
  maxGapSec: number = LIVE_VOICE_MAX_CONNECTION_GAP_SEC,
): boolean {
  if (previous.traceBreak || point.traceBreak) return false;
  if (!Number.isFinite(previous.time) || !Number.isFinite(point.time)) return false;
  return point.time - previous.time <= maxGapSec;
}

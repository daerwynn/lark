import type { PracticePitchFeedbackSettings } from "@/lib/practice/practice-settings";
import { freqToSemitone, semitoneToFreq } from "./state";

export type LiveVoiceAccuracy = "green" | "yellow" | "orange" | "red" | "none";
export type LiveVoiceRegister = "baseline" | "higher" | "lower" | "extreme";
export type LiveVoiceTraceKind = "voiced" | "silence";

export interface LiveVoiceTracePoint {
  time: number;
  songTimeSec: number;
  rawHz: number | null;
  rawMidi: number | null;
  rawDisplayMidi: number;
  displayMidi: number;
  stableHz: number | null;
  stableMidi: number | null;
  expectedMidi: number | null;
  centsFromExpected: number | null;
  absoluteOctaveOffsetFromExpected: number | null;
  baselineOctaveOffset: number | null;
  baselineRelativeOctaveOffset: number | null;
  clarity: number | null;
  rms: number | null;
  voiced: boolean;
  kind: LiveVoiceTraceKind;
  traceBreak: boolean;
  accepted: boolean;
  dropReason?: string;
  pitch: number;
}

export interface LivePitchFrame {
  id: number;
  detectedAtMs: number;
  songTimeSec: number | null;
  rawHz: number;
  rawMidi: number;
  stableHz: number | null;
  stableMidi: number | null;
  clarity: number;
  rms: number;
  accepted: boolean;
  dropReason?: string;
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

export interface BuildRawLiveVoicePointArgs {
  time: number;
  rawHz: number | null | undefined;
  displayMidi?: number | null | undefined;
  expectedMidi?: number | null | undefined;
  baselineOctaveOffset?: number | null;
  clarity?: number | null;
  rms?: number | null;
  traceBreak?: boolean;
}

export interface BuildLiveVoiceSilencePointArgs {
  time: number;
  displayMidi: number | null | undefined;
  expectedMidi?: number | null | undefined;
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
export const RAW_LIVE_VOICE_MAX_CONNECTION_GAP_SEC = 0.25;
export const LIVE_VOICE_MISSING_HOLD_SEC = 0.25;
export const LIVE_VOICE_JUMP_THRESHOLD_ST = 4;
export const LIVE_VOICE_CONFIRMED_JUMP_FRAMES = 2;
export const LIVE_VOICE_JUMP_TOLERANCE_ST = 1.5;
export const LIVE_VOICE_EMA_ALPHA = 0.35;
export const LIVE_VOICE_MEDIAN_WINDOW = 5;

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

export function buildRawLiveVoiceTracePoint({
  time,
  rawHz,
  displayMidi,
  expectedMidi,
  baselineOctaveOffset = null,
  clarity = null,
  rms = null,
  traceBreak = false,
}: BuildRawLiveVoicePointArgs): LiveVoiceTracePoint | null {
  if (!Number.isFinite(time) || !isFinitePositive(rawHz)) {
    return null;
  }

  const rawMidi = freqToSemitone(rawHz);
  const pitch =
    typeof displayMidi === "number" && Number.isFinite(displayMidi) ? displayMidi : rawMidi;
  const expectedMidiValue =
    typeof expectedMidi === "number" && Number.isFinite(expectedMidi) ? expectedMidi : null;
  const normalized =
    expectedMidiValue == null
      ? null
      : normalizeMicPitchForExpected(rawMidi, expectedMidiValue, baselineOctaveOffset);

  return {
    time,
    songTimeSec: time,
    rawHz,
    rawMidi,
    rawDisplayMidi: pitch,
    displayMidi: pitch,
    stableHz: semitoneToFreq(pitch),
    stableMidi: pitch,
    expectedMidi: normalized == null ? null : expectedMidiValue,
    centsFromExpected: normalized?.centsFromExpected ?? null,
    absoluteOctaveOffsetFromExpected: normalized?.absoluteOctaveOffsetFromExpected ?? null,
    baselineOctaveOffset: normalized?.baselineOctaveOffset ?? null,
    baselineRelativeOctaveOffset: normalized?.baselineRelativeOctaveOffset ?? null,
    clarity,
    rms,
    voiced: true,
    kind: "voiced",
    traceBreak,
    accepted: true,
    pitch,
  };
}

export function buildLiveVoiceSilencePoint({
  time,
  displayMidi,
  expectedMidi = null,
  clarity = null,
  rms = null,
  traceBreak = false,
}: BuildLiveVoiceSilencePointArgs): LiveVoiceTracePoint | null {
  if (!Number.isFinite(time) || typeof displayMidi !== "number" || !Number.isFinite(displayMidi)) {
    return null;
  }

  return {
    time,
    songTimeSec: time,
    rawHz: null,
    rawMidi: null,
    rawDisplayMidi: displayMidi,
    displayMidi,
    stableHz: null,
    stableMidi: null,
    expectedMidi:
      typeof expectedMidi === "number" && Number.isFinite(expectedMidi) ? expectedMidi : null,
    centsFromExpected: null,
    absoluteOctaveOffsetFromExpected: null,
    baselineOctaveOffset: null,
    baselineRelativeOctaveOffset: null,
    clarity,
    rms,
    voiced: false,
    kind: "silence",
    traceBreak,
    accepted: false,
    dropReason: "unvoiced",
    pitch: displayMidi,
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
      songTimeSec: time,
      rawHz,
      rawMidi,
      rawDisplayMidi: rawMidi,
      displayMidi: rawMidi,
      stableHz: semitoneToFreq(rawMidi),
      stableMidi: rawMidi,
      expectedMidi: null,
      centsFromExpected: null,
      absoluteOctaveOffsetFromExpected: null,
      baselineOctaveOffset: null,
      baselineRelativeOctaveOffset: null,
      clarity,
      rms,
      voiced: true,
      kind: "voiced",
      traceBreak,
      accepted: true,
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
    songTimeSec: time,
    rawHz,
    rawMidi,
    rawDisplayMidi: normalized.displayMidi,
    displayMidi: normalized.displayMidi,
    stableHz: semitoneToFreq(normalized.displayMidi),
    stableMidi: normalized.displayMidi,
    expectedMidi,
    centsFromExpected: normalized.centsFromExpected,
    absoluteOctaveOffsetFromExpected: normalized.absoluteOctaveOffsetFromExpected,
    baselineOctaveOffset: normalized.baselineOctaveOffset,
    baselineRelativeOctaveOffset: normalized.baselineRelativeOctaveOffset,
    clarity,
    rms,
    voiced: true,
    kind: "voiced",
    traceBreak,
    accepted: true,
    pitch: normalized.displayMidi + laneShift,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export class LiveVoiceDisplayStabilizer {
  private stableMidi: number | null = null;
  private emaMidi: number | null = null;
  private pendingJumpMidi: number | null = null;
  private pendingJumpCount = 0;
  private recentMidi: number[] = [];
  private lastAcceptedTime: number | null = null;
  private missingSince: number | null = null;

  constructor(
    private readonly config = {
      medianWindow: LIVE_VOICE_MEDIAN_WINDOW,
      emaAlpha: LIVE_VOICE_EMA_ALPHA,
      jumpThresholdSemitones: LIVE_VOICE_JUMP_THRESHOLD_ST,
      confirmedJumpFrames: LIVE_VOICE_CONFIRMED_JUMP_FRAMES,
      jumpToleranceSemitones: LIVE_VOICE_JUMP_TOLERANCE_ST,
      missingHoldSec: LIVE_VOICE_MISSING_HOLD_SEC,
    },
  ) {}

  reset(): void {
    this.stableMidi = null;
    this.emaMidi = null;
    this.pendingJumpMidi = null;
    this.pendingJumpCount = 0;
    this.recentMidi = [];
    this.lastAcceptedTime = null;
    this.missingSince = null;
  }

  noteMissing(time: number): { traceBreak: boolean; held: boolean } {
    if (!Number.isFinite(time)) {
      return { traceBreak: true, held: false };
    }

    if (this.lastAcceptedTime == null) {
      return { traceBreak: true, held: false };
    }

    this.missingSince ??= time;
    const missingFor = time - this.missingSince;
    if (missingFor <= this.config.missingHoldSec) {
      return { traceBreak: false, held: true };
    }

    this.reset();
    return { traceBreak: true, held: false };
  }

  stabilize(point: LiveVoiceTracePoint): LiveVoiceTracePoint | null {
    this.missingSince = null;
    const inputMidi = point.rawDisplayMidi;
    if (!Number.isFinite(inputMidi)) {
      return null;
    }

    if (this.stableMidi != null) {
      const jump = Math.abs(inputMidi - this.stableMidi);
      if (jump > this.config.jumpThresholdSemitones) {
        if (
          this.pendingJumpMidi != null &&
          Math.abs(inputMidi - this.pendingJumpMidi) <= this.config.jumpToleranceSemitones
        ) {
          this.pendingJumpCount += 1;
        } else {
          this.pendingJumpMidi = inputMidi;
          this.pendingJumpCount = 1;
        }

        if (this.pendingJumpCount < this.config.confirmedJumpFrames) {
          return null;
        }

        this.recentMidi = [];
        this.emaMidi = null;
      }
    }

    this.pendingJumpMidi = null;
    this.pendingJumpCount = 0;
    this.recentMidi.push(inputMidi);
    while (this.recentMidi.length > this.config.medianWindow) {
      this.recentMidi.shift();
    }

    const medianMidi = median(this.recentMidi);
    const stableMidi =
      this.emaMidi == null
        ? medianMidi
        : this.emaMidi * this.config.emaAlpha + medianMidi * (1 - this.config.emaAlpha);
    this.emaMidi = stableMidi;
    this.stableMidi = stableMidi;
    this.lastAcceptedTime = point.time;

    const laneShift = point.pitch - point.rawDisplayMidi;
    const centsFromExpected =
      point.expectedMidi == null ? null : Math.round((stableMidi - point.expectedMidi) * 100);

    return {
      ...point,
      displayMidi: stableMidi,
      stableMidi,
      stableHz: semitoneToFreq(stableMidi),
      centsFromExpected,
      pitch: stableMidi + laneShift,
      accepted: true,
    };
  }
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
  if (abs <= settings.orangeCents) return "orange";
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
  if (point.kind === "silence" || !point.voiced) {
    return {
      accuracy: "none",
      register: "baseline",
      stroke: "rgba(78, 82, 88, 0.68)",
      marker: "rgba(92, 96, 104, 0.88)",
    };
  }

  const accuracy = liveVoiceAccuracyFromCents(point.centsFromExpected, settings);
  const register = liveVoiceRegisterFromRelativeOffset(point.absoluteOctaveOffsetFromExpected);
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
    orange: {
      baseline: [255, 145, 58],
      higher: [255, 188, 119],
      lower: [188, 92, 28],
      extreme: [255, 105, 190],
    },
    red: {
      baseline: [255, 88, 88],
      higher: [255, 155, 145],
      lower: [175, 40, 56],
      extreme: [255, 66, 220],
    },
    none: {
      baseline: [235, 255, 245],
      higher: [255, 255, 255],
      lower: [170, 184, 178],
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

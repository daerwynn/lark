import {
  MIC_LATENCY_COMPENSATION_SEC,
  PITCH_BUFFER_SIZE,
  PITCH_WINDOW_SAMPLES,
  PUSH_INTERVAL_SEC,
  SEMITONE_TOLERANCE,
  SMOOTHING,
} from "./constants";
import { createPitchDetector, detectPitchFromSamplesRef } from "./detect";

export interface PitchSeries {
  refPitches: (number | null)[];
  userPitches: (number | null)[];
  rawUserPitches?: (number | null)[];
  rawMicHz?: (number | null)[];
  rawMicMidi?: (number | null)[];
  rawMicClarity?: (number | null)[];
  rawMicRms?: (number | null)[];
  rawMicVoiced?: boolean[];
  scoringExpectedHz?: (number | null)[];
  scoringMicHz?: (number | null)[];
  scoringSimilarities?: number[];
  micFrameIds?: (number | null)[];
  traceBreaks?: boolean[];
  liveDisplayPitch?: (number | null)[];
  liveCentsFromExpected?: (number | null)[];
  liveRegisterOffset?: (number | null)[];
  liveKind?: (PitchLiveDisplayKind | null)[];
  liveDropReason?: (PitchLiveDisplayDropReason | null)[];
  liveOffsetSource?: (PitchLiveDisplayOffsetSource | null)[];
  expectedChartPitchAtFrame?: (number | null)[];
  liveExpectedRawMidi?: (number | null)[];
  micToChartOffsetAtFrame?: (number | null)[];
  micToChartOffsetSampleCount?: number[];
  micToChartOffsetLocked?: boolean[];
  guideVocalOffsetAtFrame?: (number | null)[];
  guideVocalOffsetSampleCount?: number[];
  guideVocalConfidenceAtFrame?: number[];
  guideVocalQualityAtFrame?: (PitchLiveDisplayCalibrationQuality | null)[];
  userMicOffsetAtFrame?: (number | null)[];
  userMicOffsetSampleCount?: number[];
  userMicOffsetLocked?: boolean[];
  livePointScored?: boolean[];
  similarities: number[];
  times: number[];
}

export interface PitchHistoryTimeEvent {
  isDiscontinuity?: boolean;
}

export type PitchLiveDisplayKind = "voiced" | "silence";
export type PitchLiveDisplayDropReason =
  | "unvoiced"
  | "outlier"
  | "display-outlier"
  | "no-display-pitch"
  | "no-expected-pitch"
  | null;
export type PitchLiveDisplayOffsetSource = "guide-vocal" | "user-mic" | "none";
export type PitchLiveDisplayCalibrationQuality = "none" | "low" | "ok" | "good";

export interface PitchLiveDisplayFrame {
  displayPitch?: number | null;
  centsFromExpected?: number | null;
  registerOffset?: number | null;
  kind?: PitchLiveDisplayKind | null;
  expectedChartPitch?: number | null;
  expectedRawMidi?: number | null;
  dropReason?: PitchLiveDisplayDropReason;
  offsetSource?: PitchLiveDisplayOffsetSource;
  micToChartOffset?: number | null;
  micToChartOffsetSampleCount?: number;
  micToChartOffsetLocked?: boolean;
  guideVocalOffset?: number | null;
  guideVocalOffsetSampleCount?: number;
  guideVocalConfidence?: number;
  guideVocalQuality?: PitchLiveDisplayCalibrationQuality | null;
  userMicOffset?: number | null;
  userMicOffsetSampleCount?: number;
  userMicOffsetLocked?: boolean;
  scored?: boolean;
}

export function freqToSemitone(hz: number): number {
  return 12 * Math.log2(hz / 440) + 69;
}

export function semitoneToFreq(semitone: number): number {
  return 440 * 2 ** ((semitone - 69) / 12);
}

export function pitchSimilarity(refHz: number, userHz: number): number {
  const refSemi = freqToSemitone(refHz);
  const userSemi = freqToSemitone(userHz);
  let diff = Math.abs(refSemi - userSemi) % 12;
  if (diff > 6) diff = 12 - diff;
  return Math.max(0, 1 - diff / SEMITONE_TOLERANCE);
}

function ema(prev: number | null | undefined, current: number | null | undefined): number | null {
  if (current == null) {
    return null;
  }
  if (prev == null) {
    return current;
  }
  return prev * SMOOTHING + current * (1 - SMOOTHING);
}

export function snapToRefOctave(refSemi: number, userSemi: number): number {
  const d = userSemi - refSemi;
  const octaveOffset = Math.round(d / 12) * 12;
  return userSemi - octaveOffset;
}

export class PitchStateBuffer {
  refPitches: (number | null)[] = [];
  userPitches: (number | null)[] = [];
  rawUserPitches: (number | null)[] = [];
  rawMicHz: (number | null)[] = [];
  rawMicMidi: (number | null)[] = [];
  rawMicClarity: (number | null)[] = [];
  rawMicRms: (number | null)[] = [];
  rawMicVoiced: boolean[] = [];
  scoringExpectedHz: (number | null)[] = [];
  scoringMicHz: (number | null)[] = [];
  scoringSimilarities: number[] = [];
  micFrameIds: (number | null)[] = [];
  traceBreaks: boolean[] = [];
  liveDisplayPitch: (number | null)[] = [];
  liveCentsFromExpected: (number | null)[] = [];
  liveRegisterOffset: (number | null)[] = [];
  liveKind: (PitchLiveDisplayKind | null)[] = [];
  liveDropReason: (PitchLiveDisplayDropReason | null)[] = [];
  liveOffsetSource: (PitchLiveDisplayOffsetSource | null)[] = [];
  expectedChartPitchAtFrame: (number | null)[] = [];
  liveExpectedRawMidi: (number | null)[] = [];
  micToChartOffsetAtFrame: (number | null)[] = [];
  micToChartOffsetSampleCount: number[] = [];
  micToChartOffsetLocked: boolean[] = [];
  guideVocalOffsetAtFrame: (number | null)[] = [];
  guideVocalOffsetSampleCount: number[] = [];
  guideVocalConfidenceAtFrame: number[] = [];
  guideVocalQualityAtFrame: (PitchLiveDisplayCalibrationQuality | null)[] = [];
  userMicOffsetAtFrame: (number | null)[] = [];
  userMicOffsetSampleCount: number[] = [];
  userMicOffsetLocked: boolean[] = [];
  livePointScored: boolean[] = [];
  similarities: number[] = [];
  times: number[] = [];
  private smoothedRef: number | null = null;
  private smoothedUser: number | null = null;
  private lastPushTime = 0;
  private pendingTraceBreak = false;

  tryPush(
    refPitch: number | null,
    userPitch: number | null,
    similarity: number,
    time: number,
    rawUserPitch: number | null = userPitch,
    micFrameId: number | null = null,
    rawMic: {
      hz?: number | null;
      midi?: number | null;
      clarity?: number | null;
      rms?: number | null;
      voiced?: boolean;
    } = {},
    liveDisplay: PitchLiveDisplayFrame = {},
  ): void {
    this.smoothedRef = ema(this.smoothedRef, refPitch);
    this.smoothedUser = ema(this.smoothedUser, userPitch);

    if (time - this.lastPushTime < PUSH_INTERVAL_SEC) {
      return;
    }
    this.lastPushTime = time;

    if (this.refPitches.length >= PITCH_BUFFER_SIZE) {
      this.refPitches.shift();
      this.userPitches.shift();
      this.rawUserPitches.shift();
      this.rawMicHz.shift();
      this.rawMicMidi.shift();
      this.rawMicClarity.shift();
      this.rawMicRms.shift();
      this.rawMicVoiced.shift();
      this.scoringExpectedHz.shift();
      this.scoringMicHz.shift();
      this.scoringSimilarities.shift();
      this.micFrameIds.shift();
      this.traceBreaks.shift();
      this.liveDisplayPitch.shift();
      this.liveCentsFromExpected.shift();
      this.liveRegisterOffset.shift();
      this.liveKind.shift();
      this.liveDropReason.shift();
      this.liveOffsetSource.shift();
      this.expectedChartPitchAtFrame.shift();
      this.liveExpectedRawMidi.shift();
      this.micToChartOffsetAtFrame.shift();
      this.micToChartOffsetSampleCount.shift();
      this.micToChartOffsetLocked.shift();
      this.guideVocalOffsetAtFrame.shift();
      this.guideVocalOffsetSampleCount.shift();
      this.guideVocalConfidenceAtFrame.shift();
      this.guideVocalQualityAtFrame.shift();
      this.userMicOffsetAtFrame.shift();
      this.userMicOffsetSampleCount.shift();
      this.userMicOffsetLocked.shift();
      this.livePointScored.shift();
      this.similarities.shift();
      this.times.shift();
    }
    this.refPitches.push(this.smoothedRef);
    this.userPitches.push(this.smoothedUser);
    this.rawUserPitches.push(rawUserPitch);
    this.rawMicHz.push(rawMic.hz ?? null);
    this.rawMicMidi.push(rawMic.midi ?? null);
    this.rawMicClarity.push(rawMic.clarity ?? null);
    this.rawMicRms.push(rawMic.rms ?? null);
    this.rawMicVoiced.push(rawMic.voiced ?? rawMic.hz != null);
    this.scoringExpectedHz.push(refPitch);
    this.scoringMicHz.push(userPitch);
    this.scoringSimilarities.push(similarity);
    this.micFrameIds.push(micFrameId);
    this.traceBreaks.push(this.pendingTraceBreak);
    this.liveDisplayPitch.push(liveDisplay.displayPitch ?? null);
    this.liveCentsFromExpected.push(liveDisplay.centsFromExpected ?? null);
    this.liveRegisterOffset.push(liveDisplay.registerOffset ?? null);
    this.liveKind.push(liveDisplay.kind ?? null);
    this.liveDropReason.push(liveDisplay.dropReason ?? null);
    this.liveOffsetSource.push(liveDisplay.offsetSource ?? null);
    this.expectedChartPitchAtFrame.push(liveDisplay.expectedChartPitch ?? null);
    this.liveExpectedRawMidi.push(liveDisplay.expectedRawMidi ?? null);
    this.micToChartOffsetAtFrame.push(liveDisplay.micToChartOffset ?? null);
    this.micToChartOffsetSampleCount.push(liveDisplay.micToChartOffsetSampleCount ?? 0);
    this.micToChartOffsetLocked.push(liveDisplay.micToChartOffsetLocked ?? false);
    this.guideVocalOffsetAtFrame.push(liveDisplay.guideVocalOffset ?? null);
    this.guideVocalOffsetSampleCount.push(liveDisplay.guideVocalOffsetSampleCount ?? 0);
    this.guideVocalConfidenceAtFrame.push(liveDisplay.guideVocalConfidence ?? 0);
    this.guideVocalQualityAtFrame.push(liveDisplay.guideVocalQuality ?? null);
    this.userMicOffsetAtFrame.push(liveDisplay.userMicOffset ?? null);
    this.userMicOffsetSampleCount.push(liveDisplay.userMicOffsetSampleCount ?? 0);
    this.userMicOffsetLocked.push(liveDisplay.userMicOffsetLocked ?? false);
    this.livePointScored.push(liveDisplay.scored ?? false);
    this.pendingTraceBreak = false;
    this.similarities.push(similarity);
    this.times.push(time);
  }

  markTraceBreak(): void {
    this.pendingTraceBreak = true;
    this.smoothedUser = null;
  }

  snapshot(): PitchSeries {
    return {
      refPitches: [...this.refPitches],
      userPitches: [...this.userPitches],
      rawUserPitches: [...this.rawUserPitches],
      rawMicHz: [...this.rawMicHz],
      rawMicMidi: [...this.rawMicMidi],
      rawMicClarity: [...this.rawMicClarity],
      rawMicRms: [...this.rawMicRms],
      rawMicVoiced: [...this.rawMicVoiced],
      scoringExpectedHz: [...this.scoringExpectedHz],
      scoringMicHz: [...this.scoringMicHz],
      scoringSimilarities: [...this.scoringSimilarities],
      micFrameIds: [...this.micFrameIds],
      traceBreaks: [...this.traceBreaks],
      liveDisplayPitch: [...this.liveDisplayPitch],
      liveCentsFromExpected: [...this.liveCentsFromExpected],
      liveRegisterOffset: [...this.liveRegisterOffset],
      liveKind: [...this.liveKind],
      liveDropReason: [...this.liveDropReason],
      liveOffsetSource: [...this.liveOffsetSource],
      expectedChartPitchAtFrame: [...this.expectedChartPitchAtFrame],
      liveExpectedRawMidi: [...this.liveExpectedRawMidi],
      micToChartOffsetAtFrame: [...this.micToChartOffsetAtFrame],
      micToChartOffsetSampleCount: [...this.micToChartOffsetSampleCount],
      micToChartOffsetLocked: [...this.micToChartOffsetLocked],
      guideVocalOffsetAtFrame: [...this.guideVocalOffsetAtFrame],
      guideVocalOffsetSampleCount: [...this.guideVocalOffsetSampleCount],
      guideVocalConfidenceAtFrame: [...this.guideVocalConfidenceAtFrame],
      guideVocalQualityAtFrame: [...this.guideVocalQualityAtFrame],
      userMicOffsetAtFrame: [...this.userMicOffsetAtFrame],
      userMicOffsetSampleCount: [...this.userMicOffsetSampleCount],
      userMicOffsetLocked: [...this.userMicOffsetLocked],
      livePointScored: [...this.livePointScored],
      similarities: [...this.similarities],
      times: [...this.times],
    };
  }

  reset(): void {
    this.refPitches = [];
    this.userPitches = [];
    this.rawUserPitches = [];
    this.rawMicHz = [];
    this.rawMicMidi = [];
    this.rawMicClarity = [];
    this.rawMicRms = [];
    this.rawMicVoiced = [];
    this.scoringExpectedHz = [];
    this.scoringMicHz = [];
    this.scoringSimilarities = [];
    this.micFrameIds = [];
    this.traceBreaks = [];
    this.liveDisplayPitch = [];
    this.liveCentsFromExpected = [];
    this.liveRegisterOffset = [];
    this.liveKind = [];
    this.liveDropReason = [];
    this.liveOffsetSource = [];
    this.expectedChartPitchAtFrame = [];
    this.liveExpectedRawMidi = [];
    this.micToChartOffsetAtFrame = [];
    this.micToChartOffsetSampleCount = [];
    this.micToChartOffsetLocked = [];
    this.guideVocalOffsetAtFrame = [];
    this.guideVocalOffsetSampleCount = [];
    this.guideVocalConfidenceAtFrame = [];
    this.guideVocalQualityAtFrame = [];
    this.userMicOffsetAtFrame = [];
    this.userMicOffsetSampleCount = [];
    this.userMicOffsetLocked = [];
    this.livePointScored = [];
    this.similarities = [];
    this.times = [];
    this.smoothedRef = null;
    this.smoothedUser = null;
    this.lastPushTime = 0;
    this.pendingTraceBreak = false;
  }
}

export function shouldResetPitchHistory(
  previousTime: number,
  currentTime: number,
  event?: PitchHistoryTimeEvent,
  backwardSeekResetSec: number = 0.25,
): boolean {
  if (event?.isDiscontinuity) {
    return true;
  }
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || previousTime <= 0) {
    return false;
  }
  return currentTime + backwardSeekResetSec < previousTime;
}

export class PitchScoring {
  totalSingable: number;
  earned = 0;
  lastTime = 0;

  constructor(totalSingable: number) {
    this.totalSingable = Math.max(0.5, totalSingable);
  }

  accumulate(
    currentTime: number,
    refPitch: number | null,
    userPitch: number | null,
    similarity: number,
  ): void {
    const dt = Math.min(0.1, Math.max(0, currentTime - this.lastTime));
    this.lastTime = currentTime;
    if (refPitch != null && userPitch != null) {
      this.earned += similarity * dt;
    }
  }

  score(): number {
    return Math.round(Math.min(1000, Math.max(0, (this.earned / this.totalSingable) * 1000)));
  }
}

export function computeSingableTime(vocals: AudioBuffer): number {
  const sr = vocals.sampleRate;
  const ch = vocals.numberOfChannels > 0 ? vocals.getChannelData(0) : null;
  if (!ch) return 0;

  const hop = PITCH_WINDOW_SAMPLES / 2;
  const hopSec = hop / sr;
  const detector = createPitchDetector();
  const window = new Float32Array(PITCH_WINDOW_SAMPLES);
  let total = 0;
  let offset = 0;

  while (offset + PITCH_WINDOW_SAMPLES <= ch.length) {
    window.set(ch.subarray(offset, offset + PITCH_WINDOW_SAMPLES));
    if (detectPitchFromSamplesRef(detector, window, sr) != null) {
      total += hopSec;
    }
    offset += hop;
  }

  return total;
}

export function sampleVocalsWindow(
  vocals: AudioBuffer | null,
  timeSec: number,
  out: Float32Array,
  latencySec: number = MIC_LATENCY_COMPENSATION_SEC,
): boolean {
  if (!vocals || out.length !== PITCH_WINDOW_SAMPLES) {
    return false;
  }
  const sr = vocals.sampleRate;
  const safeLatency = Number.isFinite(latencySec) ? Math.max(0, latencySec) : 0;
  const start = Math.floor(Math.max(0, timeSec - safeLatency) * sr);
  const ch = vocals.numberOfChannels > 0 ? vocals.getChannelData(0) : null;
  if (!ch || start + out.length > ch.length) {
    return false;
  }
  out.set(ch.subarray(start, start + out.length));
  return true;
}

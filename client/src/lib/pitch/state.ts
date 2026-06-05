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
  micFrameIds?: (number | null)[];
  similarities: number[];
  times: number[];
}

export interface PitchHistoryTimeEvent {
  isDiscontinuity?: boolean;
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
  micFrameIds: (number | null)[] = [];
  similarities: number[] = [];
  times: number[] = [];
  private smoothedRef: number | null = null;
  private smoothedUser: number | null = null;
  private lastPushTime = 0;

  tryPush(
    refPitch: number | null,
    userPitch: number | null,
    similarity: number,
    time: number,
    rawUserPitch: number | null = userPitch,
    micFrameId: number | null = null,
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
      this.micFrameIds.shift();
      this.similarities.shift();
      this.times.shift();
    }
    this.refPitches.push(this.smoothedRef);
    this.userPitches.push(this.smoothedUser);
    this.rawUserPitches.push(rawUserPitch);
    this.micFrameIds.push(micFrameId);
    this.similarities.push(similarity);
    this.times.push(time);
  }

  snapshot(): PitchSeries {
    return {
      refPitches: [...this.refPitches],
      userPitches: [...this.userPitches],
      rawUserPitches: [...this.rawUserPitches],
      micFrameIds: [...this.micFrameIds],
      similarities: [...this.similarities],
      times: [...this.times],
    };
  }

  reset(): void {
    this.refPitches = [];
    this.userPitches = [];
    this.rawUserPitches = [];
    this.micFrameIds = [];
    this.similarities = [];
    this.times = [];
    this.smoothedRef = null;
    this.smoothedUser = null;
    this.lastPushTime = 0;
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

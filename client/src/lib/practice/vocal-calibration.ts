import type { PitchDetectionFrame } from "@/lib/pitch/detect";
import { freqToSemitone, semitoneToFreq, snapToRefOctave } from "@/lib/pitch/state";
import type { VocalCalibration } from "@/types/VocalCalibration";
import {
  CALIBRATION_SEQUENCE_VERSION,
  expectedMidiAtTime,
  type VoiceRangePreset,
  type WarmupTone,
} from "./vocal-warmups";

export interface CalibrationPitchFrame extends PitchDetectionFrame {
  timeSec: number;
}

export interface VocalCalibrationEstimate {
  calibration: VocalCalibration | null;
  pitchOffsetCents: number | null;
  micLatencyMs: number | null;
  qualityScore: number;
  validFrameCount: number;
  transitionCount: number;
  offsetMadCents: number | null;
  latencyMadMs: number | null;
  reason: string | null;
}

const MIN_VALID_FRAMES = 40;
const MIN_TRANSITIONS = 3;
const MAX_OFFSET_MAD_CENTS = 85;
const MAX_LATENCY_MAD_MS = 260;
const STABLE_EDGE_SEC = 0.32;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values: number[], center: number | null): number | null {
  if (center == null || values.length === 0) return null;
  return median(values.map((value) => Math.abs(value - center)));
}

function calibratableToneAtTime(sequence: WarmupTone[], timeSec: number): WarmupTone | null {
  return (
    sequence.find(
      (tone) =>
        tone.calibrate &&
        tone.kind === "tone" &&
        tone.startMidi != null &&
        timeSec >= tone.startSec + STABLE_EDGE_SEC &&
        timeSec <= tone.endSec - STABLE_EDGE_SEC,
    ) ?? null
  );
}

export function applyPitchOffsetToHz(hz: number, offsetCents: number | null | undefined): number {
  if (!Number.isFinite(hz) || hz <= 0) return hz;
  if (typeof offsetCents !== "number" || !Number.isFinite(offsetCents)) return hz;
  return semitoneToFreq(freqToSemitone(hz) - offsetCents / 100);
}

export function applyPitchOffsetToFrame<T extends PitchDetectionFrame>(
  frame: T | null,
  offsetCents: number | null | undefined,
): T | null {
  if (!frame) return null;
  return { ...frame, hz: applyPitchOffsetToHz(frame.hz, offsetCents) };
}

export function vocalCalibrationMatchesDevice(
  calibration: VocalCalibration | null | undefined,
  deviceName: string | null | undefined,
): calibration is VocalCalibration {
  if (!calibration || !deviceName) return false;
  return calibration.device_name === deviceName;
}

export function micCalibrationDeviceName({
  activeDeviceName,
  selectedDeviceName,
  lastKnownDeviceName,
}: {
  activeDeviceName: string | null | undefined;
  selectedDeviceName: string | null | undefined;
  lastKnownDeviceName: string | null | undefined;
}): string | null {
  return activeDeviceName ?? selectedDeviceName ?? lastKnownDeviceName ?? null;
}

export function effectiveMicLatencyMs({
  profileCalibration,
  activeDeviceName,
  fallbackMs,
}: {
  profileCalibration: VocalCalibration | null | undefined;
  activeDeviceName: string | null | undefined;
  fallbackMs: number;
}): number {
  if (vocalCalibrationMatchesDevice(profileCalibration, activeDeviceName)) {
    return Math.max(0, Math.min(1000, profileCalibration.mic_latency_ms));
  }
  return fallbackMs;
}

function pitchOffsetSamples(sequence: WarmupTone[], frames: CalibrationPitchFrame[]): number[] {
  const offsets: number[] = [];
  for (const frame of frames) {
    const tone = calibratableToneAtTime(sequence, frame.timeSec);
    if (!tone || tone.startMidi == null) continue;
    const detected = snapToRefOctave(tone.startMidi, freqToSemitone(frame.hz));
    offsets.push((detected - tone.startMidi) * 100);
  }
  return offsets;
}

function transitionLatencySamples(
  sequence: WarmupTone[],
  frames: CalibrationPitchFrame[],
  pitchOffsetCents: number,
): number[] {
  const samples: number[] = [];
  const tones = sequence.filter((tone) => tone.calibrate && tone.kind === "tone");

  for (let i = 1; i < tones.length; i++) {
    const prev = tones[i - 1];
    const next = tones[i];
    if (prev.startMidi == null || next.startMidi == null) continue;
    if (Math.abs(next.startMidi - prev.startMidi) < 2) continue;

    const boundary = next.startSec;
    const window = frames.filter(
      (frame) => frame.timeSec >= boundary - 0.35 && frame.timeSec <= boundary + 1.25,
    );
    let consecutive = 0;
    let firstMatchingTime: number | null = null;
    for (const frame of window) {
      const corrected = freqToSemitone(applyPitchOffsetToHz(frame.hz, pitchOffsetCents));
      const snapped = snapToRefOctave(next.startMidi, corrected);
      const oldDiff = Math.abs(snapped - prev.startMidi);
      const newDiff = Math.abs(snapped - next.startMidi);

      if (newDiff + 0.25 < oldDiff) {
        consecutive += 1;
        firstMatchingTime ??= frame.timeSec;
        if (consecutive >= 2) {
          samples.push(Math.max(0, (firstMatchingTime - boundary) * 1000));
          break;
        }
      } else {
        consecutive = 0;
        firstMatchingTime = null;
      }
    }
  }

  return samples;
}

export function estimateVocalCalibration({
  profile,
  deviceName,
  rangePreset,
  sequence,
  frames,
}: {
  profile: string;
  deviceName: string;
  rangePreset: VoiceRangePreset;
  sequence: WarmupTone[];
  frames: CalibrationPitchFrame[];
}): VocalCalibrationEstimate {
  const offsets = pitchOffsetSamples(sequence, frames);
  const pitchOffsetCents = median(offsets);
  const offsetMadCents = mad(offsets, pitchOffsetCents);

  const latencySamples =
    pitchOffsetCents == null ? [] : transitionLatencySamples(sequence, frames, pitchOffsetCents);
  const micLatencyMs = median(latencySamples);
  const latencyMadMs = mad(latencySamples, micLatencyMs);

  let qualityScore = 100;
  if (offsets.length < MIN_VALID_FRAMES) qualityScore -= 45;
  if (latencySamples.length < MIN_TRANSITIONS) qualityScore -= 30;
  if (offsetMadCents != null) qualityScore -= Math.min(35, offsetMadCents / 2.5);
  if (latencyMadMs != null) qualityScore -= Math.min(25, latencyMadMs / 12);
  qualityScore = Math.round(Math.max(0, Math.min(100, qualityScore)));

  let reason: string | null = null;
  if (pitchOffsetCents == null || offsets.length < MIN_VALID_FRAMES) {
    reason = "Not enough stable sung pitch was detected.";
  } else if (micLatencyMs == null || latencySamples.length < MIN_TRANSITIONS) {
    reason = "Not enough note transitions were detected for latency.";
  } else if ((offsetMadCents ?? 0) > MAX_OFFSET_MAD_CENTS) {
    reason = "Detected pitch was too unstable for calibration.";
  } else if ((latencyMadMs ?? 0) > MAX_LATENCY_MAD_MS) {
    reason = "Detected latency varied too much for calibration.";
  }

  const now = Math.floor(Date.now() / 1000);
  const calibration =
    reason == null && pitchOffsetCents != null && micLatencyMs != null
      ? {
          profile,
          device_name: deviceName,
          range_preset: rangePreset,
          pitch_offset_cents: Math.round(pitchOffsetCents),
          mic_latency_ms: Math.round(Math.max(0, Math.min(1000, micLatencyMs))),
          quality_score: qualityScore,
          valid_frame_count: offsets.length,
          transition_count: latencySamples.length,
          offset_mad_cents: Math.round(offsetMadCents ?? 0),
          latency_mad_ms: Math.round(latencyMadMs ?? 0),
          sequence_version: CALIBRATION_SEQUENCE_VERSION,
          created_at: now as unknown as bigint,
          updated_at: now as unknown as bigint,
        }
      : null;

  return {
    calibration,
    pitchOffsetCents,
    micLatencyMs,
    qualityScore,
    validFrameCount: offsets.length,
    transitionCount: latencySamples.length,
    offsetMadCents,
    latencyMadMs,
    reason,
  };
}

export function activeExpectedMidi(sequence: WarmupTone[], timeSec: number): number | null {
  return expectedMidiAtTime(sequence, timeSec);
}

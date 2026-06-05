import { PitchDetector } from "pitchy";

import {
  MAX_PITCH_HZ,
  MIC_PITCH_CLARITY_THRESHOLD,
  MIC_RMS_GATE,
  MIN_PITCH_HZ,
  PITCH_CLARITY_THRESHOLD,
  PITCH_WINDOW_SAMPLES,
  REF_RMS_GATE,
} from "./constants";

export interface PitchDetectionFrame {
  hz: number;
  clarity: number;
  rms: number;
}

export function measureRms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

export function createPitchDetector(): PitchDetector<Float32Array> {
  return PitchDetector.forFloat32Array(PITCH_WINDOW_SAMPLES);
}

export function createMicPitchDetector(): PitchDetector<Float32Array> {
  const d = PitchDetector.forFloat32Array(PITCH_WINDOW_SAMPLES);
  d.clarityThreshold = 0.65;
  return d;
}

export function detectPitchFromSamplesRef(
  detector: PitchDetector<Float32Array>,
  samples: Float32Array,
  sampleRate: number,
): number | null {
  if (samples.length !== PITCH_WINDOW_SAMPLES) {
    throw new Error(`Expected ${PITCH_WINDOW_SAMPLES} samples`);
  }
  if (measureRms(samples) < REF_RMS_GATE) {
    return null;
  }
  const [hz, clarity] = detector.findPitch(samples, sampleRate);
  if (clarity < PITCH_CLARITY_THRESHOLD || hz <= 0) {
    return null;
  }
  if (hz < MIN_PITCH_HZ || hz > MAX_PITCH_HZ) {
    return null;
  }
  return hz;
}

export function detectPitchFromSamplesMic(
  detector: PitchDetector<Float32Array>,
  samples: Float32Array,
  sampleRate: number,
): number | null {
  return detectPitchFrameFromSamplesMic(detector, samples, sampleRate)?.hz ?? null;
}

export function detectPitchFrameFromSamplesMic(
  detector: PitchDetector<Float32Array>,
  samples: Float32Array,
  sampleRate: number,
): PitchDetectionFrame | null {
  if (samples.length !== PITCH_WINDOW_SAMPLES) {
    throw new Error(`Expected ${PITCH_WINDOW_SAMPLES} samples`);
  }
  const rms = measureRms(samples);
  if (rms < MIC_RMS_GATE) {
    return null;
  }
  const [hz, clarity] = detector.findPitch(samples, sampleRate);
  if (hz <= 0 || clarity < MIC_PITCH_CLARITY_THRESHOLD) {
    return null;
  }
  if (hz < MIN_PITCH_HZ || hz > MAX_PITCH_HZ) {
    return null;
  }
  return { hz, clarity, rms };
}

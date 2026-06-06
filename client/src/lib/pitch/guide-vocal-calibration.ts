import { createPitchDetector, detectPitchFromSamplesRef } from "@/lib/pitch/detect";
import { PITCH_WINDOW_SAMPLES } from "@/lib/pitch/constants";
import { freqToSemitone } from "@/lib/pitch/state";
import type { PracticeExpectedNote, PracticePitchCalibration } from "@/lib/practice/practice-pitch";

export const GUIDE_CALIBRATION_MIN_NOTE_SEC = 0.12;
export const GUIDE_CALIBRATION_MIN_GOOD_SAMPLES = 24;
export const GUIDE_CALIBRATION_GOOD_SAMPLES = 40;
export const GUIDE_CALIBRATION_OUTLIER_SEMITONES = 2.5;

export interface GuideVocalOffsetDetection {
  refHz: number | null | undefined;
  chartPitch: number | null | undefined;
}

function emptyCalibration(): PracticePitchCalibration {
  return {
    midiOffset: null,
    sampleCount: 0,
    source: "none",
    confidence: 0,
    quality: "none",
  };
}

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianAbsoluteDeviation(values: number[], center: number): number {
  return median(values.map((value) => Math.abs(value - center))) ?? 0;
}

export function foldOffsetToAnchor(offset: number, anchor: number): number {
  return offset - Math.round((offset - anchor) / 12) * 12;
}

export function foldOffsetsToBestCluster(offsets: number[]): number[] {
  if (offsets.length === 0) return [];

  let bestFolded = offsets.map((offset) => foldOffsetToAnchor(offset, offsets[0]));
  let bestScore = Number.POSITIVE_INFINITY;

  for (const anchor of offsets) {
    const folded = offsets.map((offset) => foldOffsetToAnchor(offset, anchor));
    const center = median(folded);
    if (center == null) continue;

    const score = medianAbsoluteDeviation(folded, center);
    if (score < bestScore) {
      bestScore = score;
      bestFolded = folded;
    }
  }

  return bestFolded;
}

export function computeGuideVocalChartOffsetFromDetections(
  detections: GuideVocalOffsetDetection[],
): PracticePitchCalibration {
  const rawOffsets = detections
    .filter(
      (detection) => isFinitePositive(detection.refHz) && isFiniteNumber(detection.chartPitch),
    )
    .map(
      (detection) => freqToSemitone(detection.refHz as number) - (detection.chartPitch as number),
    );

  if (rawOffsets.length === 0) return emptyCalibration();

  const folded = foldOffsetsToBestCluster(rawOffsets);
  const firstCenter = median(folded);
  if (firstCenter == null) return emptyCalibration();

  const inliers = folded.filter(
    (offset) => Math.abs(offset - firstCenter) <= GUIDE_CALIBRATION_OUTLIER_SEMITONES,
  );
  const midiOffset = median(inliers);
  if (midiOffset == null) return emptyCalibration();

  const spread = medianAbsoluteDeviation(inliers, midiOffset);
  const sampleScore = Math.min(1, inliers.length / GUIDE_CALIBRATION_GOOD_SAMPLES);
  const survivalScore = inliers.length / rawOffsets.length;
  const spreadScore = Math.max(0, 1 - spread / GUIDE_CALIBRATION_OUTLIER_SEMITONES);
  const confidence = Math.max(
    0,
    Math.min(1, sampleScore * 0.55 + survivalScore * 0.2 + spreadScore * 0.25),
  );
  const quality =
    inliers.length < GUIDE_CALIBRATION_MIN_GOOD_SAMPLES
      ? "low"
      : inliers.length >= GUIDE_CALIBRATION_GOOD_SAMPLES && confidence >= 0.75
        ? "good"
        : "ok";

  return {
    midiOffset,
    sampleCount: inliers.length,
    source: "guide-vocal",
    confidence,
    quality,
  };
}

function sampleCenteredWindow(buffer: AudioBuffer, timeSec: number, out: Float32Array): boolean {
  if (buffer.numberOfChannels <= 0) return false;

  const channel = buffer.getChannelData(0);
  const center = Math.round(timeSec * buffer.sampleRate);
  const start = center - Math.floor(out.length / 2);
  const end = start + out.length;
  if (start < 0 || end > channel.length) return false;

  out.set(channel.subarray(start, end));
  return true;
}

export function computeGuideVocalChartOffset(
  vocals: AudioBuffer | null,
  chartNotes: PracticeExpectedNote[],
): PracticePitchCalibration {
  if (!vocals || chartNotes.length === 0) return emptyCalibration();

  const detector = createPitchDetector();
  const window = new Float32Array(PITCH_WINDOW_SAMPLES);
  const detections: GuideVocalOffsetDetection[] = [];

  for (const note of chartNotes) {
    const duration = note.end - note.start;
    if (duration < GUIDE_CALIBRATION_MIN_NOTE_SEC) continue;

    const sampleTime = note.start + duration / 2;
    if (!sampleCenteredWindow(vocals, sampleTime, window)) continue;

    detections.push({
      refHz: detectPitchFromSamplesRef(detector, window, vocals.sampleRate),
      chartPitch: note.pitch,
    });
  }

  return computeGuideVocalChartOffsetFromDetections(detections);
}

export function isUsableGuideVocalCalibration(calibration: PracticePitchCalibration): boolean {
  return (
    calibration.source === "guide-vocal" &&
    calibration.midiOffset != null &&
    (calibration.quality === "ok" || calibration.quality === "good")
  );
}

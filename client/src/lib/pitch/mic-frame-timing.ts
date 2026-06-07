import { PITCH_WINDOW_SAMPLES } from "@/lib/pitch/constants";

export const MAX_MIC_FRAME_AGE_MS = 500;

export type MicFrameDropReason = "no-frame" | "already-processed" | "stale";

export interface MicFrameTimingSource {
  id: number;
  detectedAtMs: number;
}

export interface MicFrameProcessDecision {
  shouldProcess: boolean;
  ageMs: number | null;
  dropReason: MicFrameDropReason | null;
}

export function micFrameAgeMs(nowMs: number, detectedAtMs: number): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(detectedAtMs)) return Number.POSITIVE_INFINITY;
  return Math.max(0, nowMs - detectedAtMs);
}

export function pitchWindowCenterOffsetMs(
  sampleRate: number,
  windowSamples: number = PITCH_WINDOW_SAMPLES,
): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0;
  if (!Number.isFinite(windowSamples) || windowSamples <= 0) return 0;
  return (windowSamples / sampleRate / 2) * 1000;
}

export function micFrameSongTime({
  currentPlaybackTime,
  nowMs,
  detectedAtMs,
  micLatencySec,
  duration,
}: {
  currentPlaybackTime: number;
  nowMs: number;
  detectedAtMs: number;
  micLatencySec: number;
  duration: number;
}): number {
  const frameAgeSec = micFrameAgeMs(nowMs, detectedAtMs) / 1000;
  const raw = currentPlaybackTime - frameAgeSec - Math.max(0, micLatencySec);
  const max = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(0, raw));
}

export function micFrameProcessDecision({
  frame,
  lastProcessedFrameId,
  nowMs,
  maxAgeMs = MAX_MIC_FRAME_AGE_MS,
}: {
  frame: MicFrameTimingSource | null;
  lastProcessedFrameId: number | null;
  nowMs: number;
  maxAgeMs?: number;
}): MicFrameProcessDecision {
  if (!frame) {
    return { shouldProcess: false, ageMs: null, dropReason: "no-frame" };
  }

  const ageMs = micFrameAgeMs(nowMs, frame.detectedAtMs);
  if (ageMs > maxAgeMs) {
    return { shouldProcess: false, ageMs, dropReason: "stale" };
  }
  if (frame.id === lastProcessedFrameId) {
    return { shouldProcess: false, ageMs, dropReason: "already-processed" };
  }

  return { shouldProcess: true, ageMs, dropReason: null };
}

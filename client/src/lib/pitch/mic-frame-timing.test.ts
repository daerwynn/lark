import { describe, expect, it } from "vitest";

import type { TimedPitchDetectionFrame } from "./detect";
import {
  micFrameProcessDecision,
  micFrameSongTime,
  pitchWindowCenterOffsetMs,
} from "./mic-frame-timing";

function frame(id: number, detectedAtMs = 1_000): TimedPitchDetectionFrame {
  return {
    id,
    detectedAtMs,
    hz: 220,
    clarity: 0.95,
    rms: 0.04,
    sampleRate: 48_000,
    analysisWindowMs: 2048 / 48,
  };
}

describe("mic frame timing helpers", () => {
  it("converts timestamped mic frames into song time", () => {
    expect(
      micFrameSongTime({
        currentPlaybackTime: 10,
        nowMs: 1_200,
        detectedAtMs: 1_000,
        micLatencySec: 0.08,
        duration: 180,
      }),
    ).toBeCloseTo(9.72);
  });

  it("uses mic/scoring latency only, not visual trace offset, for song time", () => {
    expect(
      micFrameSongTime({
        currentPlaybackTime: 10,
        nowMs: 1_200,
        detectedAtMs: 1_000,
        micLatencySec: 0.08,
        duration: 180,
      }),
    ).toBeCloseTo(9.72);
  });

  it("computes pitch-window center timestamp correction", () => {
    expect(pitchWindowCenterOffsetMs(48_000, 2048)).toBeCloseTo(21.333, 3);
    expect(pitchWindowCenterOffsetMs(44_100, 2048)).toBeCloseTo(23.22, 2);
  });

  it("clamps frame song time to the song boundaries", () => {
    expect(
      micFrameSongTime({
        currentPlaybackTime: 0.1,
        nowMs: 1_500,
        detectedAtMs: 1_000,
        micLatencySec: 0.2,
        duration: 180,
      }),
    ).toBe(0);
    expect(
      micFrameSongTime({
        currentPlaybackTime: 181,
        nowMs: 1_000,
        detectedAtMs: 1_000,
        micLatencySec: 0,
        duration: 180,
      }),
    ).toBe(180);
  });

  it("processes a new frame id only once", () => {
    expect(
      micFrameProcessDecision({
        frame: frame(4),
        lastProcessedFrameId: 3,
        nowMs: 1_100,
      }).shouldProcess,
    ).toBe(true);

    const repeated = micFrameProcessDecision({
      frame: frame(4),
      lastProcessedFrameId: 4,
      nowMs: 1_100,
    });

    expect(repeated.shouldProcess).toBe(false);
    expect(repeated.dropReason).toBe("already-processed");
  });

  it("rejects stale frames", () => {
    const decision = micFrameProcessDecision({
      frame: frame(5, 1_000),
      lastProcessedFrameId: 4,
      nowMs: 2_000,
      maxAgeMs: 500,
    });

    expect(decision.shouldProcess).toBe(false);
    expect(decision.dropReason).toBe("stale");
  });
});

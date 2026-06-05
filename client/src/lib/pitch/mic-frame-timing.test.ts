import { describe, expect, it } from "vitest";

import type { TimedPitchDetectionFrame } from "./detect";
import { micFrameProcessDecision, micFrameSongTime } from "./mic-frame-timing";

function frame(id: number, detectedAtMs = 1_000): TimedPitchDetectionFrame {
  return {
    id,
    detectedAtMs,
    hz: 220,
    clarity: 0.95,
    rms: 0.04,
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

  it("applies positive live trace offset later in song time", () => {
    expect(
      micFrameSongTime({
        currentPlaybackTime: 10,
        nowMs: 1_200,
        detectedAtMs: 1_000,
        micLatencySec: 0.08,
        liveTraceOffsetSec: 0.15,
        duration: 180,
      }),
    ).toBeCloseTo(9.87);
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

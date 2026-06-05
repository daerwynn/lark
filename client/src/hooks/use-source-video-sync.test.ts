import { describe, expect, it } from "vitest";

import { sourceVideoPlaybackRate } from "./use-source-video-sync";

describe("source video sync helpers", () => {
  it("combines offline tempo ratio with live playback speed", () => {
    expect(sourceVideoPlaybackRate(1.2, 0.75)).toBeCloseTo(0.9);
  });

  it("falls back to normal speed for invalid ratios", () => {
    expect(sourceVideoPlaybackRate(0, Number.NaN)).toBe(1);
  });
});

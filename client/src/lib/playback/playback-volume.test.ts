import { describe, expect, it } from "vitest";

import { clampPlaybackVolume, formatPlaybackVolume, stepPlaybackVolume } from "./playback-volume";

describe("playback volume helpers", () => {
  it("clamps invalid or out-of-range volume values", () => {
    expect(clampPlaybackVolume(-0.5)).toBe(0);
    expect(clampPlaybackVolume(1.5)).toBe(1);
    expect(clampPlaybackVolume(Number.NaN)).toBe(1);
  });

  it("steps volume in fixed increments within boundaries", () => {
    expect(stepPlaybackVolume(0.5, 1)).toBe(0.55);
    expect(stepPlaybackVolume(0.02, -1)).toBe(0);
    expect(stepPlaybackVolume(0.98, 1)).toBe(1);
  });

  it("formats volume as a percentage", () => {
    expect(formatPlaybackVolume(0)).toBe("0%");
    expect(formatPlaybackVolume(0.55)).toBe("55%");
    expect(formatPlaybackVolume(1)).toBe("100%");
  });
});

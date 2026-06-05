import { describe, expect, it } from "vitest";

import {
  clampPlaybackRate,
  formatPlaybackRate,
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  stepPlaybackRate,
} from "./playback-rate";

describe("playback rate helpers", () => {
  it("clamps playback speed to the supported practice range", () => {
    expect(clampPlaybackRate(0.2)).toBe(MIN_PLAYBACK_RATE);
    expect(clampPlaybackRate(1.9)).toBe(MAX_PLAYBACK_RATE);
    expect(clampPlaybackRate(0.83)).toBe(0.83);
  });

  it("forces normal speed when pitch-preserving playback is unavailable", () => {
    expect(clampPlaybackRate(0.75, false)).toBe(1);
    expect(stepPlaybackRate(1, -1, false)).toBe(1);
  });

  it("steps playback speed by five percent", () => {
    expect(stepPlaybackRate(1, -1)).toBe(0.95);
    expect(stepPlaybackRate(1, 1)).toBe(1.05);
  });

  it("formats playback speed with two decimals", () => {
    expect(formatPlaybackRate(0.9)).toBe("0.90x");
  });
});

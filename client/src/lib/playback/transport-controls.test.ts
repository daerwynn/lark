import { describe, expect, it } from "vitest";

import type { PracticeLoopRange } from "@/lib/practice/practice-loop";
import {
  clampPlaybackTime,
  formatPlaybackTime,
  isSeekOutsideLoop,
  skipPlaybackTime,
  stopPlaybackTarget,
} from "./transport-controls";

const loop: PracticeLoopRange = {
  start: 12,
  end: 18,
  source: "manual",
  label: "Manual loop",
};

describe("playback transport helpers", () => {
  it("formats playback time with millisecond precision below an hour", () => {
    expect(formatPlaybackTime(0)).toBe("0:00.000");
    expect(formatPlaybackTime(3.05)).toBe("0:03.050");
    expect(formatPlaybackTime(83.417)).toBe("1:23.417");
  });

  it("formats playback time with hours and millisecond precision", () => {
    expect(formatPlaybackTime(3723.004)).toBe("1:02:03.004");
  });

  it("clamps negative seeks to zero", () => {
    expect(clampPlaybackTime(-12, 60)).toBe(0);
  });

  it("clamps seeks past the end to the duration", () => {
    expect(clampPlaybackTime(90, 60)).toBe(60);
  });

  it("skips backward and forward within playback boundaries", () => {
    expect(skipPlaybackTime(3, -5, 60)).toBe(0);
    expect(skipPlaybackTime(58, 5, 60)).toBe(60);
    expect(skipPlaybackTime(20, -5, 60)).toBe(15);
    expect(skipPlaybackTime(20, 5, 60)).toBe(25);
  });

  it("uses the active loop start as the stop target", () => {
    expect(stopPlaybackTarget(loop, 120)).toBe(12);
    expect(stopPlaybackTarget(null, 120)).toBe(0);
  });

  it("detects seek targets outside an active practice loop", () => {
    expect(isSeekOutsideLoop(11.99, loop)).toBe(true);
    expect(isSeekOutsideLoop(12, loop)).toBe(false);
    expect(isSeekOutsideLoop(18, loop)).toBe(false);
    expect(isSeekOutsideLoop(18.01, loop)).toBe(true);
    expect(isSeekOutsideLoop(50, null)).toBe(false);
  });
});

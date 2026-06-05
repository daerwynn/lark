import { describe, expect, it } from "vitest";

import {
  normalizeMicLatencyMs,
  normalizeLiveTraceOffsetMs,
  normalizePitchFeedbackSettings,
  normalizeUsdxLyricDisplayOffsetMs,
  pitchFeedbackLevelFromCents,
} from "./practice-settings";

describe("practice settings helpers", () => {
  it("normalizes ordered pitch feedback thresholds", () => {
    expect(normalizePitchFeedbackSettings(12.2, 4, 300)).toEqual({
      greenCents: 12,
      yellowCents: 12,
      orangeCents: 200,
    });
  });

  it("maps cents differences to feedback levels", () => {
    const settings = normalizePitchFeedbackSettings(10, 25, 50);

    expect(pitchFeedbackLevelFromCents(8, settings)).toBe("green");
    expect(pitchFeedbackLevelFromCents(-20, settings)).toBe("yellow");
    expect(pitchFeedbackLevelFromCents(45, settings)).toBe("orange");
    expect(pitchFeedbackLevelFromCents(90, settings)).toBeNull();
  });

  it("normalizes microphone latency", () => {
    expect(normalizeMicLatencyMs(-10)).toBe(0);
    expect(normalizeMicLatencyMs(700)).toBe(500);
    expect(normalizeMicLatencyMs(83.7)).toBe(84);
  });

  it("normalizes live trace timing offset", () => {
    expect(normalizeLiveTraceOffsetMs(-5000)).toBe(-1000);
    expect(normalizeLiveTraceOffsetMs(5000)).toBe(1000);
    expect(normalizeLiveTraceOffsetMs(83.7)).toBe(84);
    expect(normalizeLiveTraceOffsetMs(Number.NaN)).toBe(0);
  });

  it("normalizes USDX lyric display offset", () => {
    expect(normalizeUsdxLyricDisplayOffsetMs(-5000)).toBe(-3000);
    expect(normalizeUsdxLyricDisplayOffsetMs(5000)).toBe(3000);
    expect(normalizeUsdxLyricDisplayOffsetMs(83.7)).toBe(84);
    expect(normalizeUsdxLyricDisplayOffsetMs(Number.NaN)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  normalizeMicLatencyMs,
  normalizePitchFeedbackSettings,
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
});

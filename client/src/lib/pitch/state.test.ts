import { describe, expect, it } from "vitest";

import { shouldResetPitchHistory } from "./state";

describe("pitch state helpers", () => {
  it("resets pitch history on explicit playback discontinuities", () => {
    expect(
      shouldResetPitchHistory(12, 12, {
        isDiscontinuity: true,
      }),
    ).toBe(true);
  });

  it("resets pitch history on backward seeks when no event metadata is available", () => {
    expect(shouldResetPitchHistory(12, 11.8)).toBe(false);
    expect(shouldResetPitchHistory(12, 11.7)).toBe(true);
  });

  it("does not reset pitch history on normal forward ticks", () => {
    expect(
      shouldResetPitchHistory(12, 12.04, {
        isDiscontinuity: false,
      }),
    ).toBe(false);
  });
});

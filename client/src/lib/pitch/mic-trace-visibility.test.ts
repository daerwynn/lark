import { describe, expect, it } from "vitest";

import { shouldDisplayMainMicTrace, shouldScoreMainMicTrace } from "./mic-trace-visibility";

describe("mic trace visibility", () => {
  it("shows an unscored main trace when a chart note exists before pitch lock", () => {
    const input = {
      chartNoteAvailable: true,
      comparisonHz: null,
      stabilizedHz: 220,
    };

    expect(shouldDisplayMainMicTrace(input)).toBe(true);
    expect(shouldScoreMainMicTrace(input)).toBe(false);
  });

  it("hides the main trace when there is no expected pitch target", () => {
    const input = {
      chartNoteAvailable: false,
      comparisonHz: null,
      stabilizedHz: 220,
    };

    expect(shouldDisplayMainMicTrace(input)).toBe(false);
    expect(shouldScoreMainMicTrace(input)).toBe(false);
  });

  it("scores only when both stabilized mic and comparison pitch exist", () => {
    const input = {
      chartNoteAvailable: false,
      comparisonHz: 220,
      stabilizedHz: 221,
    };

    expect(shouldDisplayMainMicTrace(input)).toBe(true);
    expect(shouldScoreMainMicTrace(input)).toBe(true);
  });
});

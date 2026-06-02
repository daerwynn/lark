import { describe, expect, it } from "vitest";

import type { PitchSeries } from "@/lib/pitch/state";
import type { Segment } from "@/types/Transcript";
import {
  buildPracticeLaneModel,
  clampPracticeRange,
  computePhraseMatchQuality,
  extractChartNotes,
  findPracticeSegmentIndex,
  MAX_PRACTICE_RANGE,
  MIN_PRACTICE_RANGE,
} from "./practice-pitch";

const segments: Segment[] = [
  {
    text: "first line",
    start: 1,
    end: 3,
    words: [
      { word: "first", start: 1, end: 2, pitch: 10 },
      { word: "line", start: 2, end: 3, pitch: 12 },
    ],
  },
  {
    text: "second line",
    start: 5,
    end: 7,
    words: [{ word: "second", start: 5, end: 7, pitch: 14 }],
  },
];

const series: PitchSeries = {
  times: [1.1, 1.7, 2.5, 4.5, 5.5],
  refPitches: [220, 220, 220, 220, 220],
  userPitches: [220, 233.08, null, 220, 246.94],
  similarities: [1, 0.8, 0, 0.25, 0.5],
};

describe("practice pitch adapter", () => {
  it("selects the active or nearest phrase", () => {
    expect(findPracticeSegmentIndex(segments, 2)).toBe(0);
    expect(findPracticeSegmentIndex(segments, 4.7)).toBe(1);
    expect(findPracticeSegmentIndex(segments, 9)).toBe(1);
    expect(findPracticeSegmentIndex([], 2)).toBe(-1);
  });

  it("extracts chart notes from transcript word pitches", () => {
    expect(extractChartNotes(segments)).toEqual([
      {
        start: 1,
        end: 2,
        pitch: 10,
        label: "first",
        source: "chart",
        estimated: undefined,
      },
      {
        start: 2,
        end: 3,
        pitch: 12,
        label: "line",
        source: "chart",
        estimated: undefined,
      },
      {
        start: 5,
        end: 7,
        pitch: 14,
        label: "second",
        source: "chart",
        estimated: undefined,
      },
    ]);
  });

  it("averages phrase match quality from samples inside the phrase", () => {
    expect(computePhraseMatchQuality(series, segments[0])).toBe(90);
  });

  it("falls back to recent usable samples when the phrase has no samples", () => {
    const emptySegment: Segment = { text: "gap", start: 20, end: 21, words: [] };

    expect(computePhraseMatchQuality(series, emptySegment)).toBe(64);
  });

  it("clamps the vertical practice range", () => {
    expect(clampPracticeRange(3)).toBe(MIN_PRACTICE_RANGE);
    expect(clampPracticeRange(99)).toBe(MAX_PRACTICE_RANGE);
    expect(clampPracticeRange(25.4)).toBe(25);
  });

  it("uses vocals reference data when chart notes are unavailable", () => {
    const noChartSegments: Segment[] = [
      {
        text: "plain line",
        start: 1,
        end: 3,
        words: [{ word: "plain", start: 1, end: 3 }],
      },
    ];

    const model = buildPracticeLaneModel({
      segments: noChartSegments,
      series,
      currentTime: 2,
    });

    expect(model.expectedSource).toBe("reference");
    expect(model.referenceTrace.length).toBeGreaterThan(0);
    expect(model.missingChartData.absoluteNoteHz).toBe(true);
  });
});

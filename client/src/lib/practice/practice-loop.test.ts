import { describe, expect, it } from "vitest";

import type { PitchSeries } from "@/lib/pitch/state";
import type { Segment } from "@/types/Transcript";
import {
  clampLoopTime,
  computeLoopAttemptScore,
  createManualLoopRange,
  createPhraseLoopRange,
  createPracticeLoopRange,
  didCrossLoopEnd,
  loopRetrySeekTime,
  MIN_PRACTICE_LOOP_DURATION,
  normalizePracticeCountIn,
} from "./practice-loop";

const segments: Segment[] = [
  {
    text: "first phrase",
    start: 2,
    end: 5,
    words: [],
  },
  {
    text: "second phrase",
    start: 8,
    end: 10,
    words: [],
  },
];

const series: PitchSeries = {
  times: [1, 2.25, 3, 4.5, 5.5, 8.5],
  refPitches: [220, 220, 220, 220, 220, 220],
  userPitches: [220, 220, null, 233.08, 220, 220],
  similarities: [1, 0.8, 0.2, 0.6, 1, 0.4],
};

describe("practice loop helpers", () => {
  it("creates a phrase loop from the current lyric phrase", () => {
    expect(createPhraseLoopRange(segments, 3, 12)).toEqual({
      start: 2,
      end: 5,
      source: "phrase",
      label: "first phrase",
    });
  });

  it("uses lyric display timing when creating the current phrase loop", () => {
    const closeSegments: Segment[] = [
      { text: "previous", start: 0, end: 10, words: [] },
      { text: "next", start: 10.25, end: 12, words: [] },
    ];

    expect(createPhraseLoopRange(closeSegments, 9.5, 20, 0, 0)).toMatchObject({
      start: 0,
      end: 10,
      label: "previous",
    });
    expect(createPhraseLoopRange(closeSegments, 9.5, 20, 0, 1)).toMatchObject({
      start: 10.25,
      end: 12,
      label: "next",
    });
  });

  it("normalizes reversed manual ranges and clamps to song duration", () => {
    expect(createManualLoopRange(9, 4, 8)).toEqual({
      start: 4,
      end: 8,
      source: "manual",
      label: "Manual loop",
    });
  });

  it("rejects too-short loop ranges", () => {
    expect(
      createPracticeLoopRange(2, 2 + MIN_PRACTICE_LOOP_DURATION - 0.01, "manual", 20, "x"),
    ).toBeNull();
  });

  it("clamps count-in retry targets at zero", () => {
    const range = createPracticeLoopRange(0.5, 4, "manual", 20, "x");

    if (!range) throw new Error("expected loop range");
    expect(loopRetrySeekTime(range, 2)).toBe(0);
    expect(normalizePracticeCountIn(1.6)).toBe(2);
    expect(clampLoopTime(99, 12)).toBe(12);
  });

  it("detects forward playback crossing the loop end", () => {
    const range = createPracticeLoopRange(2, 5, "manual", 20, "x");

    if (!range) throw new Error("expected loop range");
    expect(didCrossLoopEnd(4.9, 5.01, range)).toBe(true);
    expect(didCrossLoopEnd(5.2, 4.9, range)).toBe(false);
    expect(didCrossLoopEnd(5.1, 5.2, range)).toBe(false);
  });

  it("scores only usable pitch samples inside the loop window", () => {
    const range = createPracticeLoopRange(2, 5, "manual", 20, "x");

    if (!range) throw new Error("expected loop range");
    expect(computeLoopAttemptScore(series, range)).toBe(70);
  });
});

import { describe, expect, it } from "vitest";

import type { Segment } from "@/types/Transcript";
import {
  findPlaybackSegmentIndex,
  getPlaybackPhrasePair,
  isPlaybackSegmentVisible,
} from "./lyric-phrases";

const segments: Segment[] = [
  {
    text: "first phrase",
    start: 1,
    end: 3,
    words: [],
  },
  {
    text: "second phrase",
    start: 5,
    end: 7,
    words: [],
  },
  {
    text: "third phrase",
    start: 9,
    end: 11,
    words: [],
  },
];

describe("lyric phrase selection", () => {
  it("selects the active phrase and the following phrase during playback", () => {
    expect(getPlaybackPhrasePair(segments, 2)).toMatchObject({
      activeIndex: 0,
      nextIndex: 1,
      active: segments[0],
      next: segments[1],
    });
  });

  it("uses lead-in timing before the next phrase starts", () => {
    expect(findPlaybackSegmentIndex(segments, 4.86, 0)).toBe(1);
  });

  it("recomputes from time when a seek jumps backward from a later hint", () => {
    expect(getPlaybackPhrasePair(segments, 1.5, 2)).toMatchObject({
      activeIndex: 0,
      nextIndex: 1,
    });
  });

  it("does not duplicate the active phrase as the next phrase at the end", () => {
    expect(getPlaybackPhrasePair(segments, 10)).toMatchObject({
      activeIndex: 2,
      nextIndex: -1,
      active: segments[2],
      next: null,
    });
  });

  it("reports active phrase visibility using display lead and linger", () => {
    expect(isPlaybackSegmentVisible(segments[0], 0.86)).toBe(true);
    expect(isPlaybackSegmentVisible(segments[0], 3.5)).toBe(true);
    expect(isPlaybackSegmentVisible(segments[0], 3.51)).toBe(false);
  });

  it("handles empty transcripts", () => {
    expect(getPlaybackPhrasePair([], 2)).toEqual({
      activeIndex: -1,
      nextIndex: -1,
      active: null,
      next: null,
    });
  });
});

import { describe, expect, it } from "vitest";

import type { PracticePitchFeedbackSettings } from "@/lib/practice/practice-settings";
import { semitoneToFreq } from "./state";
import {
  buildLiveVoiceTracePoint,
  computeRollingBaselineOctaveOffset,
  normalizeMicPitchForExpected,
  shouldConnectLiveVoiceTracePoints,
  styleLiveVoiceTracePoint,
} from "./live-voice-trace";

const A4 = 69;
const settings: PracticePitchFeedbackSettings = {
  greenCents: 10,
  yellowCents: 25,
  orangeCents: 50,
};

describe("live voice trace helpers", () => {
  it("normalizes expected A4 and raw A3 onto A4 with lower octave metadata", () => {
    expect(normalizeMicPitchForExpected(57, A4)).toEqual({
      displayMidi: 69,
      centsFromExpected: 0,
      absoluteOctaveOffsetFromExpected: -1,
      baselineOctaveOffset: null,
      baselineRelativeOctaveOffset: null,
    });
  });

  it("preserves sharpness when normalizing expected A4 and raw Bb3", () => {
    const normalized = normalizeMicPitchForExpected(58, A4);

    expect(normalized.displayMidi).toBe(70);
    expect(normalized.absoluteOctaveOffsetFromExpected).toBe(-1);
    expect(normalized.centsFromExpected).toBe(100);
  });

  it("preserves flatness when normalizing expected A4 and raw G#3", () => {
    const normalized = normalizeMicPitchForExpected(56, A4);

    expect(normalized.displayMidi).toBe(68);
    expect(normalized.absoluteOctaveOffsetFromExpected).toBe(-1);
    expect(normalized.centsFromExpected).toBe(-100);
  });

  it("marks raw A4 as one octave above a lower baseline", () => {
    const normalized = normalizeMicPitchForExpected(69, A4, -1);

    expect(normalized.displayMidi).toBe(69);
    expect(normalized.absoluteOctaveOffsetFromExpected).toBe(0);
    expect(normalized.baselineRelativeOctaveOffset).toBe(1);
  });

  it("marks raw A2 as one octave below a lower baseline", () => {
    const normalized = normalizeMicPitchForExpected(45, A4, -1);

    expect(normalized.displayMidi).toBe(69);
    expect(normalized.absoluteOctaveOffsetFromExpected).toBe(-2);
    expect(normalized.baselineRelativeOctaveOffset).toBe(-1);
  });

  it("returns no visible point for quiet or missing pitch", () => {
    expect(
      buildLiveVoiceTracePoint({
        time: 1,
        rawHz: null,
        expectedMidi: A4,
        traceBreak: true,
      }),
    ).toBeNull();
  });

  it("keeps color calculation separate from displayed pitch", () => {
    const point = buildLiveVoiceTracePoint({
      time: 1,
      rawHz: semitoneToFreq(57),
      expectedMidi: A4,
      baselineOctaveOffset: -1,
    });

    if (!point) throw new Error("expected point");
    const before = point.displayMidi;
    const style = styleLiveVoiceTracePoint(point, settings);

    expect(style.accuracy).toBe("green");
    expect(style.register).toBe("baseline");
    expect(point.displayMidi).toBe(before);
  });

  it("allows scoring pitch to differ without changing trace position", () => {
    const point = buildLiveVoiceTracePoint({
      time: 1,
      rawHz: semitoneToFreq(57),
      expectedMidi: A4,
      baselineOctaveOffset: -1,
    });
    const scoringMidi = 68.2;

    if (!point) throw new Error("expected point");
    expect(scoringMidi).not.toBe(point.displayMidi);
    expect(point.displayMidi).toBeCloseTo(69);
  });

  it("uses recent accurate points to compute the baseline octave", () => {
    const points = [-1, -1, 0]
      .map((offset, index) =>
        buildLiveVoiceTracePoint({
          time: index,
          rawHz: semitoneToFreq(A4 + offset * 12),
          expectedMidi: A4,
        }),
      )
      .filter((point): point is NonNullable<typeof point> => point != null);

    expect(computeRollingBaselineOctaveOffset(points)).toBe(-1);
  });

  it("breaks trace connections across silence markers", () => {
    const first = buildLiveVoiceTracePoint({
      time: 1,
      rawHz: semitoneToFreq(57),
      expectedMidi: A4,
    });
    const second = buildLiveVoiceTracePoint({
      time: 1.05,
      rawHz: semitoneToFreq(57),
      expectedMidi: A4,
      traceBreak: true,
    });

    if (!first || !second) throw new Error("expected points");
    expect(shouldConnectLiveVoiceTracePoints(first, second)).toBe(false);
  });
});

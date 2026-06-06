import { describe, expect, it } from "vitest";

import type { PracticePitchFeedbackSettings } from "@/lib/practice/practice-settings";
import { semitoneToFreq } from "./state";
import {
  buildLiveVoiceSilencePoint,
  buildRawLiveVoiceTracePoint,
  buildLiveVoiceTracePoint,
  computeRollingBaselineOctaveOffset,
  liveVoiceAccuracyFromCents,
  LiveVoiceDisplayStabilizer,
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
  it("builds raw live points without expected pitch metadata or scoring cents", () => {
    const point = buildRawLiveVoiceTracePoint({
      time: 1,
      rawHz: semitoneToFreq(57),
      displayMidi: 69,
      clarity: 0.9,
      rms: 0.04,
    });

    if (!point) throw new Error("expected point");
    expect(point.rawMidi).toBeCloseTo(57);
    expect(point.displayMidi).toBe(69);
    expect(point.expectedMidi).toBeNull();
    expect(point.centsFromExpected).toBeNull();
  });

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
    expect(style.register).toBe("lower");
    expect(point.displayMidi).toBe(before);
  });

  it("classifies feedback colors using green yellow orange and red thresholds", () => {
    expect(liveVoiceAccuracyFromCents(8, settings)).toBe("green");
    expect(liveVoiceAccuracyFromCents(20, settings)).toBe("yellow");
    expect(liveVoiceAccuracyFromCents(40, settings)).toBe("orange");
    expect(liveVoiceAccuracyFromCents(80, settings)).toBe("red");
    expect(liveVoiceAccuracyFromCents(null, settings)).toBe("none");
  });

  it("classifies register from octave offset against the expected pitch", () => {
    const baseline = buildRawLiveVoiceTracePoint({
      time: 1,
      rawHz: semitoneToFreq(A4),
      expectedMidi: A4,
    });
    const higher = buildRawLiveVoiceTracePoint({
      time: 2,
      rawHz: semitoneToFreq(A4 + 12),
      expectedMidi: A4,
    });
    const lower = buildRawLiveVoiceTracePoint({
      time: 3,
      rawHz: semitoneToFreq(A4 - 12),
      expectedMidi: A4,
    });
    const extreme = buildRawLiveVoiceTracePoint({
      time: 4,
      rawHz: semitoneToFreq(A4 + 24),
      expectedMidi: A4,
    });

    if (!baseline || !higher || !lower || !extreme) throw new Error("expected points");
    expect(styleLiveVoiceTracePoint(baseline, settings).register).toBe("baseline");
    expect(styleLiveVoiceTracePoint(higher, settings).register).toBe("higher");
    expect(styleLiveVoiceTracePoint(lower, settings).register).toBe("lower");
    expect(styleLiveVoiceTracePoint(extreme, settings).register).toBe("extreme");
  });

  it("styles silence as a secondary neutral trace segment", () => {
    const point = buildLiveVoiceSilencePoint({
      time: 1,
      displayMidi: A4,
      rms: 0.001,
    });

    if (!point) throw new Error("expected point");
    const style = styleLiveVoiceTracePoint(point, settings);
    expect(point.kind).toBe("silence");
    expect(point.voiced).toBe(false);
    expect(style.accuracy).toBe("none");
    expect(style.stroke).toContain("rgba(78, 82, 88");
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

  it("display stabilizer holds through one missing frame", () => {
    const stabilizer = new LiveVoiceDisplayStabilizer();
    const first = buildLiveVoiceTracePoint({
      time: 1,
      rawHz: semitoneToFreq(A4),
      expectedMidi: A4,
    });

    if (!first) throw new Error("expected point");
    expect(stabilizer.stabilize(first)?.displayMidi).toBeCloseTo(A4);
    expect(stabilizer.noteMissing(1.03)).toEqual({ traceBreak: false, held: true });
    const second = buildLiveVoiceTracePoint({
      time: 1.06,
      rawHz: semitoneToFreq(A4),
      expectedMidi: A4,
    });

    if (!second) throw new Error("expected point");
    const accepted = stabilizer.stabilize(second);
    expect(accepted?.traceBreak).toBe(false);
    expect(accepted?.displayMidi).toBeCloseTo(A4);
  });

  it("display stabilizer breaks after sustained missing pitch", () => {
    const stabilizer = new LiveVoiceDisplayStabilizer();
    const first = buildLiveVoiceTracePoint({
      time: 1,
      rawHz: semitoneToFreq(A4),
      expectedMidi: A4,
    });

    if (!first) throw new Error("expected point");
    expect(stabilizer.stabilize(first)).not.toBeNull();
    expect(stabilizer.noteMissing(1.03).traceBreak).toBe(false);
    expect(stabilizer.noteMissing(1.31).traceBreak).toBe(true);
  });

  it("display stabilizer rejects one-frame large jumps", () => {
    const stabilizer = new LiveVoiceDisplayStabilizer();
    const first = buildLiveVoiceTracePoint({
      time: 1,
      rawHz: semitoneToFreq(A4),
      expectedMidi: A4,
    });
    const spike = buildLiveVoiceTracePoint({
      time: 1.03,
      rawHz: semitoneToFreq(75),
      expectedMidi: A4,
    });
    const recovered = buildLiveVoiceTracePoint({
      time: 1.06,
      rawHz: semitoneToFreq(A4),
      expectedMidi: A4,
    });

    if (!first || !spike || !recovered) throw new Error("expected points");
    expect(stabilizer.stabilize(first)).not.toBeNull();
    expect(stabilizer.stabilize(spike)).toBeNull();
    expect(stabilizer.stabilize(recovered)?.displayMidi).toBeCloseTo(A4);
  });

  it("display stabilizer accepts confirmed large jumps", () => {
    const stabilizer = new LiveVoiceDisplayStabilizer();
    const first = buildLiveVoiceTracePoint({
      time: 1,
      rawHz: semitoneToFreq(A4),
      expectedMidi: A4,
    });
    const jumpA = buildLiveVoiceTracePoint({
      time: 1.03,
      rawHz: semitoneToFreq(75),
      expectedMidi: A4,
    });
    const jumpB = buildLiveVoiceTracePoint({
      time: 1.06,
      rawHz: semitoneToFreq(75),
      expectedMidi: A4,
    });

    if (!first || !jumpA || !jumpB) throw new Error("expected points");
    expect(stabilizer.stabilize(first)).not.toBeNull();
    expect(stabilizer.stabilize(jumpA)).toBeNull();
    expect(stabilizer.stabilize(jumpB)?.displayMidi).toBeGreaterThan(A4 + 4);
  });
});

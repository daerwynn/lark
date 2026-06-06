import { describe, expect, it } from "vitest";

import { PitchStateBuffer, shouldResetPitchHistory } from "./state";

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

  it("marks the next pushed pitch point as a trace break", () => {
    const buffer = new PitchStateBuffer();

    buffer.tryPush(null, 220, 0, 0.1);
    buffer.markTraceBreak();
    buffer.tryPush(null, 221, 0, 0.2);

    expect(buffer.snapshot().traceBreaks).toEqual([false, true]);
  });

  it("stores raw mic fields separately from scoring pitch", () => {
    const buffer = new PitchStateBuffer();

    buffer.tryPush(
      440,
      441,
      0.9,
      0.1,
      220,
      3,
      {
        hz: 220,
        midi: 57,
        clarity: 0.92,
        rms: 0.04,
        voiced: true,
      },
      {
        displayPitch: 5,
        centsFromExpected: 50,
        registerOffset: 1,
        kind: "voiced",
        expectedChartPitch: 4.5,
        expectedRawMidi: 64.5,
        micToChartOffset: 60,
        micToChartOffsetSampleCount: 8,
        micToChartOffsetLocked: true,
        scored: true,
      },
    );

    expect(buffer.snapshot()).toMatchObject({
      refPitches: [440],
      userPitches: [441],
      rawUserPitches: [220],
      rawMicHz: [220],
      rawMicMidi: [57],
      rawMicClarity: [0.92],
      rawMicRms: [0.04],
      rawMicVoiced: [true],
      scoringExpectedHz: [440],
      scoringMicHz: [441],
      scoringSimilarities: [0.9],
      micFrameIds: [3],
      liveDisplayPitch: [5],
      liveCentsFromExpected: [50],
      liveRegisterOffset: [1],
      liveKind: ["voiced"],
      expectedChartPitchAtFrame: [4.5],
      liveExpectedRawMidi: [64.5],
      micToChartOffsetAtFrame: [60],
      micToChartOffsetSampleCount: [8],
      micToChartOffsetLocked: [true],
      livePointScored: [true],
    });
  });
});

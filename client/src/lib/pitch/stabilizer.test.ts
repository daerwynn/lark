import { describe, expect, it } from "vitest";

import type { PitchDetectionFrame } from "./detect";
import { semitoneToFreq } from "./state";
import {
  DISPLAY_CONFIRMED_JUMP_FRAMES,
  DISPLAY_JUMP_THRESHOLD_ST,
  DISPLAY_MEDIAN_WINDOW,
  LivePitchStabilizer,
  correctPitchOctave,
} from "./stabilizer";

function frame(hz: number, clarity = 0.95, rms = 0.04): PitchDetectionFrame {
  return { hz, clarity, rms };
}

describe("live pitch stabilizer", () => {
  it("snaps octave-doubled input toward the expected reference", () => {
    expect(correctPitchOctave(880, 440)).toBeCloseTo(440, 4);
  });

  it("rejects an isolated large jump without a chart or reference target", () => {
    const stabilizer = new LivePitchStabilizer();

    expect(stabilizer.stabilize(frame(220))).toBeCloseTo(220, 4);
    expect(stabilizer.stabilize(frame(880))).toBeNull();
  });

  it("accepts a repeated large jump after confirmation", () => {
    const stabilizer = new LivePitchStabilizer();

    expect(stabilizer.stabilize(frame(220))).toBeCloseTo(220, 4);
    expect(stabilizer.stabilize(frame(880))).toBeNull();
    expect(stabilizer.stabilize(frame(880))).toBeCloseTo(880, 4);
  });

  it("uses an external target to correct octave spikes immediately", () => {
    const stabilizer = new LivePitchStabilizer();

    expect(stabilizer.stabilize(frame(880), { expectedHz: 440 })).toBeCloseTo(440, 4);
  });

  it("does not reset stable history on one missing frame", () => {
    const stabilizer = new LivePitchStabilizer();

    expect(stabilizer.stabilize(frame(220))).toBeCloseTo(220, 4);
    expect(stabilizer.stabilize(null)).toBeNull();
    expect(stabilizer.stabilize(frame(880))).toBeNull();
  });

  it("resets stable history after sustained missing frames", () => {
    const stabilizer = new LivePitchStabilizer({ missingFrameResetCount: 2 });

    expect(stabilizer.stabilize(frame(220))).toBeCloseTo(220, 4);
    expect(stabilizer.stabilize(null)).toBeNull();
    expect(stabilizer.stabilize(null)).toBeNull();
    expect(stabilizer.stabilize(frame(880))).toBeNull();
    expect(stabilizer.stabilize(frame(880))).toBeCloseTo(880, 4);
  });

  it("rejects an isolated non-octave jump even with an external target", () => {
    const stabilizer = new LivePitchStabilizer();
    const target = 440;
    const nonOctaveSpike = semitoneToFreq(69 + 6);

    expect(stabilizer.stabilize(frame(target), { expectedHz: target })).toBeCloseTo(target, 4);
    expect(stabilizer.stabilize(frame(nonOctaveSpike), { expectedHz: target })).toBeNull();
  });

  it("requires consistent frames after silence before reacquiring", () => {
    const stabilizer = new LivePitchStabilizer({ missingFrameResetCount: 1 });

    expect(stabilizer.stabilize(frame(220))).toBeCloseTo(220, 4);
    expect(stabilizer.stabilize(null)).toBeNull();
    expect(stabilizer.status().reacquiring).toBe(true);
    expect(stabilizer.stabilize(frame(330))).toBeNull();
    expect(stabilizer.status().voiced).toBe(false);
    expect(stabilizer.stabilize(frame(330))).toBeCloseTo(330, 4);
    expect(stabilizer.status().voiced).toBe(true);
  });

  it("uses stricter voicing gates while reacquiring", () => {
    const stabilizer = new LivePitchStabilizer({ missingFrameResetCount: 1 });

    expect(stabilizer.stabilize(frame(220))).toBeCloseTo(220, 4);
    expect(stabilizer.stabilize(null)).toBeNull();
    expect(stabilizer.stabilize(frame(330, 0.95, 0.003))).toBeNull();
    expect(stabilizer.stabilize(frame(330))).toBeNull();
    expect(stabilizer.stabilize(frame(330))).toBeCloseTo(330, 4);
  });

  it("lets display tracking follow a short chart-guided pitch change", () => {
    const display = new LivePitchStabilizer({
      medianWindow: DISPLAY_MEDIAN_WINDOW,
      jumpThresholdSemitones: DISPLAY_JUMP_THRESHOLD_ST,
      confirmedJumpFrames: DISPLAY_CONFIRMED_JUMP_FRAMES,
      reacquireFrames: 1,
    });
    const a4 = semitoneToFreq(69);
    const e5 = semitoneToFreq(76);

    expect(display.stabilize(frame(a4), { expectedHz: a4 })).toBeCloseTo(a4, 4);
    expect(
      display.stabilize(frame(e5), {
        expectedHz: e5,
        allowExpectedJump: true,
      }),
    ).toBeCloseTo(e5, 4);
    expect(display.status().expectedJumpAccepted).toBe(true);
  });

  it("keeps scoring smoothing stricter than the display path", () => {
    const scoring = new LivePitchStabilizer();
    const a4 = semitoneToFreq(69);
    const e5 = semitoneToFreq(76);

    expect(scoring.stabilize(frame(a4), { expectedHz: a4 })).toBeCloseTo(a4, 4);
    expect(scoring.stabilize(frame(e5), { expectedHz: e5 })).toBeNull();
    expect(scoring.status().expectedJumpAccepted).toBe(false);
  });

  it("still rejects a one-frame impossible spike away from the expected pitch", () => {
    const display = new LivePitchStabilizer({
      medianWindow: DISPLAY_MEDIAN_WINDOW,
      jumpThresholdSemitones: DISPLAY_JUMP_THRESHOLD_ST,
      confirmedJumpFrames: DISPLAY_CONFIRMED_JUMP_FRAMES,
      reacquireFrames: 1,
    });
    const a4 = semitoneToFreq(69);
    const expectedB4 = semitoneToFreq(71);
    const impossibleSpike = semitoneToFreq(76);

    expect(display.stabilize(frame(a4), { expectedHz: a4 })).toBeCloseTo(a4, 4);
    expect(
      display.stabilize(frame(impossibleSpike), {
        expectedHz: expectedB4,
        allowExpectedJump: true,
      }),
    ).toBeNull();
  });
});

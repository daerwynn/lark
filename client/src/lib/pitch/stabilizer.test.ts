import { describe, expect, it } from "vitest";

import type { PitchDetectionFrame } from "./detect";
import { semitoneToFreq } from "./state";
import { LivePitchStabilizer, correctPitchOctave } from "./stabilizer";

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
    expect(stabilizer.stabilize(frame(880))).toBeCloseTo(880, 4);
  });

  it("rejects an isolated non-octave jump even with an external target", () => {
    const stabilizer = new LivePitchStabilizer();
    const target = 440;
    const nonOctaveSpike = semitoneToFreq(69 + 6);

    expect(stabilizer.stabilize(frame(target), { expectedHz: target })).toBeCloseTo(target, 4);
    expect(stabilizer.stabilize(frame(nonOctaveSpike), { expectedHz: target })).toBeNull();
  });
});

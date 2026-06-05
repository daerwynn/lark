import { describe, expect, it } from "vitest";

import { semitoneToFreq } from "@/lib/pitch/state";
import {
  applyPitchOffsetToFrame,
  applyPitchOffsetToHz,
  effectiveMicLatencyMs,
  estimateVocalCalibration,
  vocalCalibrationMatchesDevice,
  type CalibrationPitchFrame,
} from "./vocal-calibration";
import { buildCalibrationSequence, expectedMidiAtTime } from "./vocal-warmups";

function syntheticFrames(offsetCents: number, latencySec: number): CalibrationPitchFrame[] {
  const sequence = buildCalibrationSequence("medium");
  const duration = sequence[sequence.length - 1].endSec;
  const frames: CalibrationPitchFrame[] = [];

  for (let timeSec = 0; timeSec <= duration; timeSec += 0.1) {
    const expected = expectedMidiAtTime(sequence, Math.max(0, timeSec - latencySec));
    if (expected == null) continue;
    frames.push({
      timeSec,
      hz: semitoneToFreq(expected + offsetCents / 100),
      clarity: 0.96,
      rms: 0.05,
    });
  }

  return frames;
}

describe("vocal calibration helpers", () => {
  it("applies pitch offset to detected frames", () => {
    const sharp = semitoneToFreq(60.25);

    expect(applyPitchOffsetToHz(sharp, 25)).toBeCloseTo(semitoneToFreq(60), 4);
    expect(applyPitchOffsetToFrame({ hz: sharp, clarity: 1, rms: 0.1 }, 25)?.hz).toBeCloseTo(
      semitoneToFreq(60),
      4,
    );
  });

  it("estimates sung pitch offset and practical latency", () => {
    const sequence = buildCalibrationSequence("medium");
    const estimate = estimateVocalCalibration({
      profile: "Ada",
      deviceName: "Mic",
      rangePreset: "medium",
      sequence,
      frames: syntheticFrames(22, 0.18),
    });

    expect(estimate.reason).toBeNull();
    expect(estimate.calibration?.pitch_offset_cents).toBeCloseTo(22, 0);
    expect(estimate.calibration?.mic_latency_ms).toBeGreaterThanOrEqual(150);
    expect(estimate.calibration?.mic_latency_ms).toBeLessThanOrEqual(250);
    expect(estimate.validFrameCount).toBeGreaterThan(40);
    expect(estimate.transitionCount).toBeGreaterThanOrEqual(3);
  });

  it("rejects silence or insufficient detected pitch", () => {
    const estimate = estimateVocalCalibration({
      profile: "Ada",
      deviceName: "Mic",
      rangePreset: "medium",
      sequence: buildCalibrationSequence("medium"),
      frames: [],
    });

    expect(estimate.calibration).toBeNull();
    expect(estimate.reason).toBe("Not enough stable sung pitch was detected.");
  });

  it("uses profile latency only for the matching microphone", () => {
    const calibration = estimateVocalCalibration({
      profile: "Ada",
      deviceName: "Mic",
      rangePreset: "medium",
      sequence: buildCalibrationSequence("medium"),
      frames: syntheticFrames(0, 0.12),
    }).calibration;

    expect(vocalCalibrationMatchesDevice(calibration, "Mic")).toBe(true);
    expect(
      effectiveMicLatencyMs({
        profileCalibration: calibration,
        activeDeviceName: "Mic",
        fallbackMs: 80,
      }),
    ).toBe(calibration?.mic_latency_ms);
    expect(
      effectiveMicLatencyMs({
        profileCalibration: calibration,
        activeDeviceName: "Other Mic",
        fallbackMs: 80,
      }),
    ).toBe(80);
  });
});

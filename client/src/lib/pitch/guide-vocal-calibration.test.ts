import { describe, expect, it } from "vitest";

import { semitoneToFreq } from "./state";
import {
  computeGuideVocalChartOffsetFromDetections,
  foldOffsetsToBestCluster,
  isUsableGuideVocalCalibration,
  isUsableGuideVocalTiming,
  summarizeGuideVocalTimingSamples,
} from "./guide-vocal-calibration";

describe("guide vocal chart calibration", () => {
  it("computes chart offset from known guide vocal detections", () => {
    const calibration = computeGuideVocalChartOffsetFromDetections(
      Array.from({ length: 30 }, (_, index) => ({
        chartPitch: index % 12,
        refHz: semitoneToFreq((index % 12) + 60),
      })),
    );

    expect(calibration.midiOffset).toBeCloseTo(60);
    expect(calibration.sampleCount).toBe(30);
    expect(calibration.source).toBe("guide-vocal");
    expect(calibration.quality).toBe("ok");
    expect(isUsableGuideVocalCalibration(calibration)).toBe(true);
  });

  it("folds octave-equivalent offsets into one cluster", () => {
    const folded = foldOffsetsToBestCluster([60, 72, 48, 60.25]);

    expect(folded.map(Math.round)).toEqual([60, 60, 60, 60]);
  });

  it("rejects outlier guide vocal offsets", () => {
    const calibration = computeGuideVocalChartOffsetFromDetections([
      ...Array.from({ length: 28 }, (_, index) => ({
        chartPitch: index % 12,
        refHz: semitoneToFreq((index % 12) + 60),
      })),
      { chartPitch: 5, refHz: semitoneToFreq(83) },
      { chartPitch: 6, refHz: semitoneToFreq(84) },
    ]);

    expect(calibration.midiOffset).toBeCloseTo(60);
    expect(calibration.sampleCount).toBe(28);
    expect(calibration.quality).toBe("ok");
  });

  it("does not mark low-sample guide calibration as usable", () => {
    const calibration = computeGuideVocalChartOffsetFromDetections(
      Array.from({ length: 8 }, (_, index) => ({
        chartPitch: index,
        refHz: semitoneToFreq(index + 60),
      })),
    );

    expect(calibration.midiOffset).toBeCloseTo(60);
    expect(calibration.sampleCount).toBe(8);
    expect(calibration.quality).toBe("low");
    expect(isUsableGuideVocalCalibration(calibration)).toBe(false);
  });

  it("accepts stable guide vocal timing diagnostics", () => {
    const diagnostics = summarizeGuideVocalTimingSamples(
      Array.from({ length: 24 }, (_, noteIndex) => ({
        noteIndex,
        noteCount: 24,
        offsetSec: noteIndex < 12 ? 0.03 : 0.04,
      })),
    );

    expect(diagnostics.sampleCount).toBe(24);
    expect(diagnostics.medianOffsetSec).toBeCloseTo(0.035);
    expect(diagnostics.driftSec).toBeCloseTo(0.01);
    expect(diagnostics.quality).toBe("good");
    expect(diagnostics.warning).toBeNull();
    expect(isUsableGuideVocalTiming(diagnostics)).toBe(true);
  });

  it("rejects drifting guide vocal timing diagnostics", () => {
    const diagnostics = summarizeGuideVocalTimingSamples(
      Array.from({ length: 24 }, (_, noteIndex) => ({
        noteIndex,
        noteCount: 24,
        offsetSec: noteIndex < 8 ? -0.16 : noteIndex > 15 ? 0.16 : 0,
      })),
    );

    expect(diagnostics.quality).toBe("poor");
    expect(diagnostics.warning).toContain("USDX/audio timing mismatch");
    expect(isUsableGuideVocalTiming(diagnostics)).toBe(false);
  });
});

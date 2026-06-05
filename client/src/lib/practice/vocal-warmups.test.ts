import { describe, expect, it } from "vitest";

import {
  CALIBRATION_NOTE_DURATION_SEC,
  CALIBRATION_PASS_TRANSPOSITIONS,
  CALIBRATION_SCALE_OFFSETS,
  buildCalibrationSequence,
  buildVocalWarmupSequence,
  midiToNoteName,
  sequenceDuration,
  VOCAL_WARMUPS,
  VOICE_RANGE_PRESETS,
  type VoiceRangePreset,
} from "./vocal-warmups";

describe("vocal warmup sequences", () => {
  it("provides ten guided warmups", () => {
    expect(VOCAL_WARMUPS).toHaveLength(10);
  });

  it("formats midi note names", () => {
    expect(midiToNoteName(60)).toBe("C4");
    expect(midiToNoteName(43)).toBe("G2");
  });

  it.each(["low", "medium", "high"] as VoiceRangePreset[])(
    "builds the exact calibration scale inside the %s range",
    (preset) => {
      const range = VOICE_RANGE_PRESETS[preset];
      const sequence = buildCalibrationSequence(preset);

      expect(sequence).toHaveLength(
        CALIBRATION_SCALE_OFFSETS.length * CALIBRATION_PASS_TRANSPOSITIONS.length,
      );
      expect(sequenceDuration(sequence)).toBe(54);
      for (const tone of sequence) {
        expect(tone.kind).toBe("tone");
        expect(tone.calibrate).toBe(true);
        expect(tone.endSec - tone.startSec).toBe(CALIBRATION_NOTE_DURATION_SEC);
        if (tone.startMidi == null) continue;
        expect(tone.startMidi).toBeGreaterThanOrEqual(range.minMidi);
        expect(tone.startMidi).toBeLessThanOrEqual(range.maxMidi);
        if (tone.endMidi != null) {
          expect(tone.endMidi).toBeGreaterThanOrEqual(range.minMidi);
          expect(tone.endMidi).toBeLessThanOrEqual(range.maxMidi);
        }
      }

      for (let pass = 0; pass < CALIBRATION_PASS_TRANSPOSITIONS.length; pass++) {
        const start = pass * CALIBRATION_SCALE_OFFSETS.length;
        const expectedFirstPitch = range.baseMidi + CALIBRATION_PASS_TRANSPOSITIONS[pass];

        expect(sequence[start].startMidi).toBe(expectedFirstPitch);
        expect(sequence[start + CALIBRATION_SCALE_OFFSETS.length - 1].startMidi).toBe(
          expectedFirstPitch,
        );
      }
    },
  );

  it("builds warmup exercises that span more than one pitch", () => {
    for (const exercise of VOCAL_WARMUPS) {
      const sequence = buildVocalWarmupSequence(exercise, "medium");
      const unique = new Set(sequence.map((tone) => tone.startMidi).filter(Boolean));

      expect(sequence.length).toBeGreaterThan(0);
      expect(unique.size).toBeGreaterThan(1);
    }
  });
});

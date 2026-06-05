import { describe, expect, it } from "vitest";

import {
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
    "keeps calibration tones inside the %s range",
    (preset) => {
      const range = VOICE_RANGE_PRESETS[preset];
      const sequence = buildCalibrationSequence(preset);

      expect(sequenceDuration(sequence)).toBeGreaterThan(55);
      expect(sequenceDuration(sequence)).toBeLessThan(70);
      for (const tone of sequence) {
        if (tone.startMidi == null) continue;
        expect(tone.startMidi).toBeGreaterThanOrEqual(range.minMidi);
        expect(tone.startMidi).toBeLessThanOrEqual(range.maxMidi);
        if (tone.endMidi != null) {
          expect(tone.endMidi).toBeGreaterThanOrEqual(range.minMidi);
          expect(tone.endMidi).toBeLessThanOrEqual(range.maxMidi);
        }
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

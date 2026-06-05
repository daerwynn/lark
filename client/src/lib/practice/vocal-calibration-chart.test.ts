import { describe, expect, it } from "vitest";

import { semitoneToFreq } from "@/lib/pitch/state";

import {
  calibrationPitchSeriesFromFrames,
  calibrationSegmentsFromSequence,
  CALIBRATION_PHRASE_TEXT,
} from "./vocal-calibration-chart";
import {
  CALIBRATION_NOTE_DURATION_SEC,
  CALIBRATION_PASS_TRANSPOSITIONS,
  CALIBRATION_SCALE_OFFSETS,
  buildCalibrationSequence,
} from "./vocal-warmups";

describe("vocal calibration practice adapter", () => {
  it("converts calibration tones into three practice phrases", () => {
    const sequence = buildCalibrationSequence("medium");
    const segments = calibrationSegmentsFromSequence(sequence);

    expect(segments).toHaveLength(CALIBRATION_PASS_TRANSPOSITIONS.length);
    for (const segment of segments) {
      expect(segment.text).toBe(CALIBRATION_PHRASE_TEXT);
      expect(segment.words).toHaveLength(CALIBRATION_SCALE_OFFSETS.length);
    }
  });

  it("preserves two-second word timing and pitch", () => {
    const sequence = buildCalibrationSequence("medium");
    const segments = calibrationSegmentsFromSequence(sequence);

    segments.forEach((segment, phraseIndex) => {
      segment.words.forEach((word, wordIndex) => {
        const tone = sequence[phraseIndex * CALIBRATION_SCALE_OFFSETS.length + wordIndex];

        expect(word.start).toBe(tone.startSec);
        expect(word.end).toBe(tone.endSec);
        expect(word.end - word.start).toBe(CALIBRATION_NOTE_DURATION_SEC);
        expect(word.pitch).toBe(tone.startMidi);
      });
    });
  });

  it("converts captured calibration frames into practice pitch series", () => {
    const sequence = buildCalibrationSequence("medium");
    const tone = sequence[0];
    const detectedHz = semitoneToFreq((tone.startMidi ?? 0) + 0.25);
    const series = calibrationPitchSeriesFromFrames(sequence, [
      { timeSec: tone.startSec + 0.5, hz: detectedHz, clarity: 0.95, rms: 0.08 },
    ]);

    expect(series.times).toEqual([tone.startSec + 0.5]);
    expect(series.refPitches[0]).toBeCloseTo(semitoneToFreq(tone.startMidi ?? 0), 4);
    expect(series.userPitches[0]).toBe(detectedHz);
    expect(series.similarities[0]).toBeGreaterThan(0);
    expect(series.similarities[0]).toBeLessThan(1);
  });
});

import { pitchSimilarity, type PitchSeries } from "@/lib/pitch/state";
import type { Segment, Word } from "@/types/Transcript";

import {
  CALIBRATION_SCALE_OFFSETS,
  expectedMidiAtTime,
  midiToFrequency,
  type WarmupTone,
} from "./vocal-warmups";
import type { CalibrationPitchFrame } from "./vocal-calibration";

export const CALIBRATION_PHRASE_TEXT = "DO RE ME FA SOL FA ME RE DO";

function isCalibrationTone(tone: WarmupTone): tone is WarmupTone & { startMidi: number } {
  return tone.calibrate === true && tone.kind === "tone" && tone.startMidi != null;
}

export function calibrationSegmentsFromSequence(sequence: WarmupTone[]): Segment[] {
  const tones = sequence.filter(isCalibrationTone);
  const phraseSize = CALIBRATION_SCALE_OFFSETS.length;
  const segments: Segment[] = [];

  for (let start = 0; start < tones.length; start += phraseSize) {
    const phraseTones = tones.slice(start, start + phraseSize);
    if (phraseTones.length === 0) continue;

    const words: Word[] = phraseTones.map((tone) => ({
      word: tone.syllable,
      start: tone.startSec,
      end: tone.endSec,
      pitch: tone.startMidi,
    }));

    segments.push({
      text: words.map((word) => word.word).join(" "),
      start: phraseTones[0].startSec,
      end: phraseTones[phraseTones.length - 1].endSec,
      words,
    });
  }

  return segments;
}

export function calibrationPitchSeriesFromFrames(
  sequence: WarmupTone[],
  frames: CalibrationPitchFrame[],
): PitchSeries {
  const refPitches: (number | null)[] = [];
  const userPitches: (number | null)[] = [];
  const similarities: number[] = [];
  const times: number[] = [];

  for (const frame of frames) {
    const expectedMidi = expectedMidiAtTime(sequence, frame.timeSec);
    const refHz = expectedMidi == null ? null : midiToFrequency(expectedMidi);
    const userHz = Number.isFinite(frame.hz) && frame.hz > 0 ? frame.hz : null;

    refPitches.push(refHz);
    userPitches.push(userHz);
    similarities.push(refHz != null && userHz != null ? pitchSimilarity(refHz, userHz) : 0);
    times.push(frame.timeSec);
  }

  return { refPitches, userPitches, similarities, times };
}

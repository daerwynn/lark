import { freqToSemitone, pitchSimilarity, type PitchSeries } from "@/lib/pitch/state";
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
  const rawUserPitches: (number | null)[] = [];
  const rawMicHz: (number | null)[] = [];
  const rawMicMidi: (number | null)[] = [];
  const rawMicClarity: (number | null)[] = [];
  const rawMicRms: (number | null)[] = [];
  const rawMicVoiced: boolean[] = [];
  const traceBreaks: boolean[] = [];
  const micFrameIds: (number | null)[] = [];
  const liveDisplayPitch: (number | null)[] = [];
  const liveCentsFromExpected: (number | null)[] = [];
  const liveRegisterOffset: (number | null)[] = [];
  const liveKind: ("voiced" | "silence" | null)[] = [];
  const liveDropReason: ("unvoiced" | null)[] = [];
  const liveOffsetSource: ("guide-vocal" | "none" | null)[] = [];
  const expectedChartPitchAtFrame: (number | null)[] = [];
  const liveExpectedRawMidi: (number | null)[] = [];
  const micToChartOffsetAtFrame: (number | null)[] = [];
  const micToChartOffsetSampleCount: number[] = [];
  const micToChartOffsetLocked: boolean[] = [];
  const guideVocalOffsetAtFrame: (number | null)[] = [];
  const guideVocalOffsetSampleCount: number[] = [];
  const guideVocalConfidenceAtFrame: number[] = [];
  const guideVocalQualityAtFrame: ("none" | "ok" | null)[] = [];
  const userMicOffsetAtFrame: (number | null)[] = [];
  const userMicOffsetSampleCount: number[] = [];
  const userMicOffsetLocked: boolean[] = [];
  const livePointScored: boolean[] = [];
  const similarities: number[] = [];
  const times: number[] = [];

  for (const frame of frames) {
    const expectedMidi = expectedMidiAtTime(sequence, frame.timeSec);
    const refHz = expectedMidi == null ? null : midiToFrequency(expectedMidi);
    const userHz = Number.isFinite(frame.hz) && frame.hz > 0 ? frame.hz : null;
    const userMidi = userHz != null ? freqToSemitone(userHz) : null;
    const centsFromExpected =
      expectedMidi != null && userMidi != null ? Math.round((userMidi - expectedMidi) * 100) : null;

    refPitches.push(refHz);
    userPitches.push(userHz);
    rawUserPitches.push(userHz);
    rawMicHz.push(userHz);
    rawMicMidi.push(userMidi);
    rawMicClarity.push(frame.clarity);
    rawMicRms.push(frame.rms);
    rawMicVoiced.push(userHz != null);
    traceBreaks.push(false);
    micFrameIds.push(null);
    liveDisplayPitch.push(userMidi);
    liveCentsFromExpected.push(centsFromExpected);
    liveRegisterOffset.push(
      expectedMidi != null && userMidi != null ? Math.round((userMidi - expectedMidi) / 12) : null,
    );
    liveKind.push(userHz == null ? "silence" : "voiced");
    liveDropReason.push(userHz == null ? "unvoiced" : null);
    liveOffsetSource.push(expectedMidi != null ? "guide-vocal" : "none");
    expectedChartPitchAtFrame.push(expectedMidi);
    liveExpectedRawMidi.push(expectedMidi);
    micToChartOffsetAtFrame.push(0);
    micToChartOffsetSampleCount.push(0);
    micToChartOffsetLocked.push(expectedMidi != null);
    guideVocalOffsetAtFrame.push(expectedMidi != null ? 0 : null);
    guideVocalOffsetSampleCount.push(expectedMidi != null ? 1 : 0);
    guideVocalConfidenceAtFrame.push(expectedMidi != null ? 1 : 0);
    guideVocalQualityAtFrame.push(expectedMidi != null ? "ok" : "none");
    userMicOffsetAtFrame.push(null);
    userMicOffsetSampleCount.push(0);
    userMicOffsetLocked.push(false);
    livePointScored.push(refHz != null && userHz != null);
    similarities.push(refHz != null && userHz != null ? pitchSimilarity(refHz, userHz) : 0);
    times.push(frame.timeSec);
  }

  return {
    refPitches,
    userPitches,
    rawUserPitches,
    rawMicHz,
    rawMicMidi,
    rawMicClarity,
    rawMicRms,
    rawMicVoiced,
    traceBreaks,
    micFrameIds,
    liveDisplayPitch,
    liveCentsFromExpected,
    liveRegisterOffset,
    liveKind,
    liveDropReason,
    liveOffsetSource,
    expectedChartPitchAtFrame,
    liveExpectedRawMidi,
    micToChartOffsetAtFrame,
    micToChartOffsetSampleCount,
    micToChartOffsetLocked,
    guideVocalOffsetAtFrame,
    guideVocalOffsetSampleCount,
    guideVocalConfidenceAtFrame,
    guideVocalQualityAtFrame,
    userMicOffsetAtFrame,
    userMicOffsetSampleCount,
    userMicOffsetLocked,
    livePointScored,
    similarities,
    times,
  };
}

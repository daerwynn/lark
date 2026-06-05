import { semitoneToFreq } from "@/lib/pitch/state";

export type VoiceRangePreset = "low" | "medium" | "high";
export type WarmupToneKind = "tone" | "glide" | "rest";

export interface VoiceRangeConfig {
  id: VoiceRangePreset;
  label: string;
  baseMidi: number;
  minMidi: number;
  maxMidi: number;
}

export interface WarmupTone {
  startSec: number;
  endSec: number;
  startMidi: number | null;
  endMidi?: number | null;
  syllable: string;
  label: string;
  kind: WarmupToneKind;
  calibrate?: boolean;
}

export interface WarmupExercise {
  id: string;
  title: string;
  syllable: string;
  description: string;
  offsets: number[];
  stepSec: number;
  transposeSteps: number[];
  largerRange?: boolean;
}

export const CALIBRATION_SEQUENCE_VERSION = 1;
export const CALIBRATION_NOTE_DURATION_SEC = 2;
export const CALIBRATION_SCALE_OFFSETS = [0, 2, 4, 5, 7, 5, 4, 2, 0] as const;
export const CALIBRATION_PASS_TRANSPOSITIONS = [0, 1, 2] as const;
export const CALIBRATION_SOLFEGE = ["DO", "RE", "ME", "FA", "SOL", "FA", "ME", "RE", "DO"] as const;

export const VOICE_RANGE_PRESETS: Record<VoiceRangePreset, VoiceRangeConfig> = {
  low: { id: "low", label: "Low", baseMidi: 43, minMidi: 43, maxMidi: 62 },
  medium: { id: "medium", label: "Medium", baseMidi: 48, minMidi: 48, maxMidi: 67 },
  high: { id: "high", label: "High", baseMidi: 55, minMidi: 55, maxMidi: 74 },
};

export const VOCAL_WARMUPS: WarmupExercise[] = [
  {
    id: "hum-siren",
    title: "Gentle hum siren",
    syllable: "mmm",
    description: "Easy slide up and down through the middle of the voice.",
    offsets: [0, 7, 0],
    stepSec: 2.4,
    transposeSteps: [-5, -2, 0, 2, 5],
    largerRange: true,
  },
  {
    id: "lip-trill-five",
    title: "Lip trill 5-note scale",
    syllable: "brr",
    description: "Classic breath-balanced 1-2-3-4-5-4-3-2-1 pattern.",
    offsets: [0, 2, 4, 5, 7, 5, 4, 2, 0],
    stepSec: 0.55,
    transposeSteps: [-5, -3, -1, 1, 3, 5],
  },
  {
    id: "oo-siren",
    title: "Oo siren",
    syllable: "oo",
    description: "Smooth vowel slide for easy registration.",
    offsets: [0, 5, 12, 5, 0],
    stepSec: 1.4,
    transposeSteps: [-7, -4, -2, 0, 2, 4],
    largerRange: true,
  },
  {
    id: "mee-five",
    title: "5-note scale on mee",
    syllable: "mee",
    description: "Bright, familiar five-note scale.",
    offsets: [0, 2, 4, 5, 7, 5, 4, 2, 0],
    stepSec: 0.5,
    transposeSteps: [-4, -2, 0, 2, 4],
  },
  {
    id: "ng-ah-descend",
    title: "Descending ng-ah",
    syllable: "ng-ah",
    description: "Gentle descending release from resonance to vowel.",
    offsets: [7, 5, 4, 2, 0],
    stepSec: 0.7,
    transposeSteps: [-2, 0, 2, 4, 6, 8],
  },
  {
    id: "noo-arpeggio",
    title: "Noo arpeggio",
    syllable: "noo",
    description: "1-3-5-8-5-3-1 pattern across a wider span.",
    offsets: [0, 4, 7, 12, 7, 4, 0],
    stepSec: 0.65,
    transposeSteps: [-7, -4, -2, 0, 2, 4],
    largerRange: true,
  },
  {
    id: "woo-octave-slide",
    title: "Woo octave slide",
    syllable: "woo",
    description: "Light octave slide without pushing.",
    offsets: [0, 12, 0],
    stepSec: 2.2,
    transposeSteps: [-7, -5, -3, -1, 1, 3],
    largerRange: true,
  },
  {
    id: "gee-staccato",
    title: "Light gee staccato",
    syllable: "gee",
    description: "Short 1-3-5-3-1 notes for clean onset.",
    offsets: [0, 4, 7, 4, 0],
    stepSec: 0.45,
    transposeSteps: [-4, -2, 0, 2, 4, 6],
  },
  {
    id: "vowel-chain",
    title: "Vowel chain",
    syllable: "mee-meh-mah-moh-moo",
    description: "Five comfortable vowel shapes on one note at a time.",
    offsets: [0, 0, 0, 0, 0],
    stepSec: 0.55,
    transposeSteps: [-5, -3, -1, 1, 3, 5, 7],
  },
  {
    id: "range-builder-trill",
    title: "Range builder lip trills",
    syllable: "brr",
    description: "Easy arpeggios that step through a larger range.",
    offsets: [0, 4, 7, 12, 7, 4, 0],
    stepSec: 0.6,
    transposeSteps: [-9, -6, -3, 0, 3, 6],
    largerRange: true,
  },
];

function clampMidi(midi: number, range: VoiceRangeConfig): number {
  return Math.min(range.maxMidi, Math.max(range.minMidi, midi));
}

function pushTone(
  tones: WarmupTone[],
  cursor: number,
  duration: number,
  midi: number | null,
  syllable: string,
  label: string,
  kind: WarmupToneKind = "tone",
  calibrate = false,
  endMidi: number | null = midi,
): number {
  tones.push({
    startSec: cursor,
    endSec: cursor + duration,
    startMidi: midi,
    endMidi,
    syllable,
    label,
    kind,
    calibrate,
  });
  return cursor + duration;
}

export function midiToNoteName(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  return `${names[((rounded % 12) + 12) % 12]}${octave}`;
}

export function midiToFrequency(midi: number): number {
  return semitoneToFreq(midi);
}

export function toneExpectedMidiAtTime(tone: WarmupTone, timeSec: number): number | null {
  if (tone.startMidi == null || tone.kind === "rest") return null;
  if (tone.kind !== "glide" || tone.endMidi == null || tone.endMidi === tone.startMidi) {
    return tone.startMidi;
  }
  const span = Math.max(0.001, tone.endSec - tone.startSec);
  const t = Math.min(1, Math.max(0, (timeSec - tone.startSec) / span));
  return tone.startMidi + (tone.endMidi - tone.startMidi) * t;
}

export function expectedMidiAtTime(sequence: WarmupTone[], timeSec: number): number | null {
  const tone = sequence.find((item) => timeSec >= item.startSec && timeSec <= item.endSec);
  return tone ? toneExpectedMidiAtTime(tone, timeSec) : null;
}

export function sequenceDuration(sequence: WarmupTone[]): number {
  return sequence.reduce((max, tone) => Math.max(max, tone.endSec), 0);
}

export function buildVocalWarmupSequence(
  exercise: WarmupExercise,
  rangePreset: VoiceRangePreset,
): WarmupTone[] {
  const range = VOICE_RANGE_PRESETS[rangePreset];
  const tones: WarmupTone[] = [];
  let cursor = 0;

  for (const transpose of exercise.transposeSteps) {
    for (const offset of exercise.offsets) {
      const midi = clampMidi(range.baseMidi + transpose + offset, range);
      cursor = pushTone(
        tones,
        cursor,
        exercise.stepSec,
        midi,
        exercise.syllable,
        `${exercise.syllable} ${midiToNoteName(midi)}`,
      );
    }
    cursor = pushTone(tones, cursor, 0.45, null, "", "Breathe", "rest");
  }

  return tones;
}

export function buildCalibrationSequence(rangePreset: VoiceRangePreset): WarmupTone[] {
  const range = VOICE_RANGE_PRESETS[rangePreset];
  const tones: WarmupTone[] = [];
  let cursor = 0;

  for (const transpose of CALIBRATION_PASS_TRANSPOSITIONS) {
    for (let i = 0; i < CALIBRATION_SCALE_OFFSETS.length; i++) {
      const offset = CALIBRATION_SCALE_OFFSETS[i];
      const solfege = CALIBRATION_SOLFEGE[i];
      const midi = clampMidi(range.baseMidi + transpose + offset, range);
      cursor = pushTone(
        tones,
        cursor,
        CALIBRATION_NOTE_DURATION_SEC,
        midi,
        solfege,
        `${solfege} ${midiToNoteName(midi)}`,
        "tone",
        true,
      );
    }
  }

  return tones;
}

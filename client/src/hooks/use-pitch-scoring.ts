import type { TimeSubscriber } from "@/hooks/use-audio-player";
import { PITCH_WINDOW_SAMPLES } from "@/lib/pitch/constants";
import {
  createPitchDetector,
  detectPitchFromSamplesRef,
  type PitchDetectionFrame,
} from "@/lib/pitch/detect";
import { LivePitchStabilizer } from "@/lib/pitch/stabilizer";
import { applyPitchOffsetToFrame } from "@/lib/practice/vocal-calibration";
import {
  computeSingableTime,
  freqToSemitone,
  PitchScoring,
  PitchSeries,
  PitchStateBuffer,
  pitchSimilarity,
  sampleVocalsWindow,
  semitoneToFreq,
  shouldResetPitchHistory,
} from "@/lib/pitch/state";
import { expectedNoteAtTime, extractChartNotes } from "@/lib/practice/practice-pitch";
import type { Segment } from "@/types/Transcript";
import { useEffect, useMemo, useRef, useState } from "react";

const BACKWARD_SEEK_RESET_SEC = 0.25;
const CHART_CALIBRATION_SAMPLES = 80;
const CHART_EXPECTED_TOLERANCE_SEC = 0.12;

export interface PitchScoringSource {
  isReady: boolean;
  duration: number;
  micLatencySec: number;
  getVocalsBuffer: () => AudioBuffer | null;
  subscribe: (fn: TimeSubscriber) => () => void;
  segments?: Segment[];
  micPitchOffsetCents?: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function usePitchScoring(
  {
    isReady,
    duration,
    micLatencySec,
    getVocalsBuffer,
    subscribe,
    segments = [],
    micPitchOffsetCents = null,
  }: PitchScoringSource,
  micPitchFrame: PitchDetectionFrame | null,
) {
  const refDetector = useRef(createPitchDetector());
  const scratchRef = useRef(new Float32Array(PITCH_WINDOW_SAMPLES));
  const bufferRef = useRef(new PitchStateBuffer());
  const stabilizerRef = useRef(new LivePitchStabilizer());
  const scoringRef = useRef(new PitchScoring(1));
  const micPitchFrameRef = useRef(micPitchFrame);
  const chartCalibrationOffsetsRef = useRef<number[]>([]);
  const singableRef = useRef<number | null>(null);
  const lastRunTimeRef = useRef(0);
  const chartNotes = useMemo(() => extractChartNotes(segments), [segments]);
  const chartNotesRef = useRef(chartNotes);
  const [series, setSeries] = useState<PitchSeries>({
    refPitches: [],
    userPitches: [],
    similarities: [],
    times: [],
  });
  const [score, setScore] = useState(0);

  micPitchFrameRef.current = micPitchFrame;
  chartNotesRef.current = chartNotes;

  useEffect(() => {
    if (!isReady || duration <= 0) {
      return;
    }
    bufferRef.current.reset();
    stabilizerRef.current.reset();
    chartCalibrationOffsetsRef.current = [];
    lastRunTimeRef.current = 0;

    const vocals = getVocalsBuffer();
    const singable = vocals ? computeSingableTime(vocals) : duration;
    singableRef.current = singable;
    scoringRef.current = new PitchScoring(singable);

    setSeries(bufferRef.current.snapshot());
    setScore(0);
  }, [isReady, duration, getVocalsBuffer, chartNotes, micLatencySec, micPitchOffsetCents]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const run: TimeSubscriber = (t, event) => {
      if (shouldResetPitchHistory(lastRunTimeRef.current, t, event, BACKWARD_SEEK_RESET_SEC)) {
        bufferRef.current.reset();
        stabilizerRef.current.reset();
        setSeries(bufferRef.current.snapshot());
      }
      lastRunTimeRef.current = t;

      if (t <= 0) {
        return;
      }

      const micSongTime = Math.max(0, t - micLatencySec);
      if (micSongTime <= 0) {
        return;
      }

      const vocals = getVocalsBuffer();
      const rawMic = applyPitchOffsetToFrame(micPitchFrameRef.current, micPitchOffsetCents);
      const notes = chartNotesRef.current;
      const chartNote = expectedNoteAtTime(notes, micSongTime, CHART_EXPECTED_TOLERANCE_SEC);
      let refHz: number | null = null;

      if (vocals && sampleVocalsWindow(vocals, micSongTime, scratchRef.current, 0)) {
        refHz = detectPitchFromSamplesRef(
          refDetector.current,
          scratchRef.current,
          vocals.sampleRate,
        );
      }

      if (chartNote && refHz != null) {
        const offsets = chartCalibrationOffsetsRef.current;
        offsets.push(freqToSemitone(refHz) - chartNote.pitch);
        while (offsets.length > CHART_CALIBRATION_SAMPLES) {
          offsets.shift();
        }
      }

      const chartOffset = median(chartCalibrationOffsetsRef.current);
      const chartExpectedHz =
        chartNote && chartOffset != null ? semitoneToFreq(chartNote.pitch + chartOffset) : null;
      const stabilizedMic = stabilizerRef.current.stabilize(rawMic, {
        expectedHz: chartExpectedHz,
        referenceHz: refHz,
      });
      const comparisonHz = refHz ?? chartExpectedHz;
      const sim =
        comparisonHz != null && stabilizedMic != null
          ? pitchSimilarity(comparisonHz, stabilizedMic)
          : 0;

      bufferRef.current.tryPush(comparisonHz, stabilizedMic, sim, micSongTime);
      scoringRef.current.accumulate(micSongTime, comparisonHz, stabilizedMic, sim);
      setSeries(bufferRef.current.snapshot());
      setScore(scoringRef.current.score());
    };

    return subscribe(run);
  }, [isReady, subscribe, getVocalsBuffer, micLatencySec, micPitchOffsetCents]);

  return { series, score };
}

import type { TimeSubscriber } from "@/hooks/use-audio-player";
import { PITCH_WINDOW_SAMPLES } from "@/lib/pitch/constants";
import {
  createPitchDetector,
  detectPitchFromSamplesRef,
  type PitchDetectionFrame,
  type TimedPitchAnalysisFrame,
} from "@/lib/pitch/detect";
import {
  micFrameProcessDecision,
  micFrameSongTime,
  type MicFrameDropReason,
} from "@/lib/pitch/mic-frame-timing";
import { shouldScoreMainMicTrace } from "@/lib/pitch/mic-trace-visibility";
import { LiveDisplayMapper } from "@/lib/pitch/live-display";
import { LivePitchStabilizer } from "@/lib/pitch/stabilizer";
import { applyPitchOffsetToFrame } from "@/lib/practice/vocal-calibration";
import {
  computeGuideVocalChartOffset,
  isUsableGuideVocalCalibration,
} from "@/lib/pitch/guide-vocal-calibration";
import type { PitchLiveDisplayFrame } from "@/lib/pitch/state";
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
import {
  expectedNoteAtTime,
  extractChartNotes,
  type PracticePitchCalibration,
} from "@/lib/practice/practice-pitch";
import type { Segment } from "@/types/Transcript";
import { useEffect, useMemo, useRef, useState } from "react";

const BACKWARD_SEEK_RESET_SEC = 0.25;
const CHART_EXPECTED_TOLERANCE_SEC = 0.12;

export type PitchScoringDropReason =
  | MicFrameDropReason
  | "outlier"
  | "unvoiced"
  | "reacquiring"
  | "no-expected-pitch"
  | null;

export interface PitchScoringDebug {
  rawHz: number | null;
  stabilizedHz: number | null;
  rawMidi: number | null;
  stabilizedMidi: number | null;
  clarity: number | null;
  rms: number | null;
  frameAgeMs: number | null;
  frameId: number | null;
  playbackTime: number | null;
  frameSongTime: number | null;
  voiced: boolean;
  reacquiring: boolean;
  comparisonAvailable: boolean;
  displayed: boolean;
  scored: boolean;
  traceBreakInserted: boolean;
  dropReason: PitchScoringDropReason;
  liveDisplayPitch: number | null;
  expectedChartPitch: number | null;
  liveCentsFromExpected: number | null;
  liveRegisterOffset: number | null;
  liveDropReason: PitchLiveDisplayFrame["dropReason"];
  activeOffsetSource: NonNullable<PitchLiveDisplayFrame["offsetSource"]> | null;
  micToChartOffset: number | null;
  micToChartOffsetSampleCount: number;
  micToChartOffsetLocked: boolean;
  guideVocalOffset: number | null;
  guideVocalSampleCount: number;
  guideVocalConfidence: number;
  guideVocalQuality: PitchLiveDisplayFrame["guideVocalQuality"];
  userMicOffset: number | null;
  userMicSampleCount: number;
  userMicLocked: boolean;
  liveKind: "voiced" | "silence" | null;
}

export interface PitchScoringSource {
  isReady: boolean;
  duration: number;
  micLatencySec: number;
  liveTraceOffsetSec?: number;
  getVocalsBuffer: () => AudioBuffer | null;
  subscribe: (fn: TimeSubscriber) => () => void;
  segments?: Segment[];
  micPitchOffsetCents?: number | null;
}

const EMPTY_DEBUG: PitchScoringDebug = {
  rawHz: null,
  stabilizedHz: null,
  rawMidi: null,
  stabilizedMidi: null,
  clarity: null,
  rms: null,
  frameAgeMs: null,
  frameId: null,
  playbackTime: null,
  frameSongTime: null,
  voiced: false,
  reacquiring: false,
  comparisonAvailable: false,
  displayed: false,
  scored: false,
  traceBreakInserted: false,
  dropReason: "no-frame",
  liveDisplayPitch: null,
  expectedChartPitch: null,
  liveCentsFromExpected: null,
  liveRegisterOffset: null,
  liveDropReason: null,
  activeOffsetSource: null,
  micToChartOffset: null,
  micToChartOffsetSampleCount: 0,
  micToChartOffsetLocked: false,
  guideVocalOffset: null,
  guideVocalSampleCount: 0,
  guideVocalConfidence: 0,
  guideVocalQuality: null,
  userMicOffset: null,
  userMicSampleCount: 0,
  userMicLocked: false,
  liveKind: null,
};

function hzToMidi(hz: number | null | undefined): number | null {
  return typeof hz === "number" && Number.isFinite(hz) && hz > 0 ? freqToSemitone(hz) : null;
}

function detectionFrameFromAnalysis(frame: TimedPitchAnalysisFrame): PitchDetectionFrame | null {
  if (!frame.voiced || frame.hz == null || frame.clarity == null) {
    return null;
  }
  return { hz: frame.hz, clarity: frame.clarity, rms: frame.rms };
}

function emptyGuideCalibration(): PracticePitchCalibration {
  return {
    midiOffset: null,
    sampleCount: 0,
    source: "none",
    confidence: 0,
    quality: "none",
  };
}

function guideOffsetArgs(calibration: PracticePitchCalibration): {
  guideOffset: number | null;
  guideSampleCount: number;
  guideConfidence: number;
  guideQuality: PitchLiveDisplayFrame["guideVocalQuality"];
} {
  const usable = isUsableGuideVocalCalibration(calibration);

  return {
    guideOffset: usable ? calibration.midiOffset : null,
    guideSampleCount: usable ? calibration.sampleCount : 0,
    guideConfidence: usable ? calibration.confidence : 0,
    guideQuality: usable ? calibration.quality : calibration.quality,
  };
}

function debugFromLiveDisplay(display: PitchLiveDisplayFrame) {
  return {
    liveDisplayPitch: display.displayPitch ?? null,
    expectedChartPitch: display.expectedChartPitch ?? null,
    liveCentsFromExpected: display.centsFromExpected ?? null,
    liveRegisterOffset: display.registerOffset ?? null,
    liveDropReason: display.dropReason ?? null,
    activeOffsetSource: display.offsetSource ?? null,
    micToChartOffset: display.micToChartOffset ?? null,
    micToChartOffsetSampleCount: display.micToChartOffsetSampleCount ?? 0,
    micToChartOffsetLocked: display.micToChartOffsetLocked ?? false,
    guideVocalOffset: display.guideVocalOffset ?? null,
    guideVocalSampleCount: display.guideVocalOffsetSampleCount ?? 0,
    guideVocalConfidence: display.guideVocalConfidence ?? 0,
    guideVocalQuality: display.guideVocalQuality ?? null,
    userMicOffset: display.userMicOffset ?? null,
    userMicSampleCount: display.userMicOffsetSampleCount ?? 0,
    userMicLocked: display.userMicOffsetLocked ?? false,
    liveKind: display.kind ?? null,
  };
}

export function usePitchScoring(
  {
    isReady,
    duration,
    micLatencySec,
    liveTraceOffsetSec = 0,
    getVocalsBuffer,
    subscribe,
    segments = [],
    micPitchOffsetCents = null,
  }: PitchScoringSource,
  micPitchFrame: TimedPitchAnalysisFrame | null,
) {
  const refDetector = useRef(createPitchDetector());
  const scratchRef = useRef(new Float32Array(PITCH_WINDOW_SAMPLES));
  const bufferRef = useRef(new PitchStateBuffer());
  const stabilizerRef = useRef(new LivePitchStabilizer());
  const liveDisplayRef = useRef(new LiveDisplayMapper());
  const scoringRef = useRef(new PitchScoring(1));
  const micPitchFrameRef = useRef(micPitchFrame);
  const lastProcessedFrameIdRef = useRef<number | null>(null);
  const guideCalibrationRef = useRef<PracticePitchCalibration>(emptyGuideCalibration());
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
  const [debug, setDebug] = useState<PitchScoringDebug>(EMPTY_DEBUG);

  micPitchFrameRef.current = micPitchFrame;
  chartNotesRef.current = chartNotes;

  useEffect(() => {
    if (!isReady || duration <= 0) {
      return;
    }
    bufferRef.current.reset();
    stabilizerRef.current.reset();
    liveDisplayRef.current.reset();
    lastProcessedFrameIdRef.current = null;
    lastRunTimeRef.current = 0;

    const vocals = getVocalsBuffer();
    guideCalibrationRef.current = computeGuideVocalChartOffset(vocals, chartNotes);
    const singable = vocals ? computeSingableTime(vocals) : duration;
    singableRef.current = singable;
    scoringRef.current = new PitchScoring(singable);

    setSeries(bufferRef.current.snapshot());
    setScore(0);
    setDebug(EMPTY_DEBUG);
  }, [
    isReady,
    duration,
    getVocalsBuffer,
    chartNotes,
    micLatencySec,
    liveTraceOffsetSec,
    micPitchOffsetCents,
  ]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const run: TimeSubscriber = (t, event) => {
      if (shouldResetPitchHistory(lastRunTimeRef.current, t, event, BACKWARD_SEEK_RESET_SEC)) {
        bufferRef.current.reset();
        stabilizerRef.current.reset();
        liveDisplayRef.current.reset();
        lastProcessedFrameIdRef.current = null;
        setSeries(bufferRef.current.snapshot());
        setDebug(EMPTY_DEBUG);
      }
      lastRunTimeRef.current = t;

      if (t <= 0) {
        return;
      }

      const nowMs = performance.now();
      const frame = micPitchFrameRef.current;
      const decision = micFrameProcessDecision({
        frame,
        lastProcessedFrameId: lastProcessedFrameIdRef.current,
        nowMs,
      });

      if (!decision.shouldProcess) {
        stabilizerRef.current.stabilize(null);
        const liveStatus = liveDisplayRef.current.status();
        setDebug({
          ...EMPTY_DEBUG,
          rawHz: frame?.hz ?? null,
          rawMidi: hzToMidi(frame?.hz),
          clarity: frame?.clarity ?? null,
          rms: frame?.rms ?? null,
          frameAgeMs: decision.ageMs,
          frameId: frame?.id ?? null,
          playbackTime: t,
          frameSongTime: null,
          voiced: stabilizerRef.current.status().voiced,
          reacquiring: stabilizerRef.current.status().reacquiring,
          traceBreakInserted: decision.dropReason !== "already-processed",
          dropReason: decision.dropReason,
          micToChartOffset: liveStatus.micToChartOffset ?? null,
          micToChartOffsetSampleCount: liveStatus.micToChartOffsetSampleCount ?? 0,
          micToChartOffsetLocked: liveStatus.micToChartOffsetLocked ?? false,
          activeOffsetSource: liveStatus.offsetSource ?? null,
          userMicOffset: liveStatus.userMicOffset ?? null,
          userMicSampleCount: liveStatus.userMicOffsetSampleCount ?? 0,
          userMicLocked: liveStatus.userMicOffsetLocked ?? false,
          guideVocalOffset: guideCalibrationRef.current.midiOffset,
          guideVocalSampleCount: guideCalibrationRef.current.sampleCount,
          guideVocalConfidence: guideCalibrationRef.current.confidence,
          guideVocalQuality: guideCalibrationRef.current.quality,
        });
        if (decision.dropReason !== "already-processed") {
          bufferRef.current.markTraceBreak();
        }
        return;
      }

      if (!frame) {
        return;
      }

      const micSongTime = micFrameSongTime({
        currentPlaybackTime: t,
        nowMs,
        detectedAtMs: frame.detectedAtMs,
        micLatencySec,
        liveTraceOffsetSec,
        duration,
      });
      lastProcessedFrameIdRef.current = frame.id;

      const rawDetectorFrame = detectionFrameFromAnalysis(frame);
      const rawMic = rawDetectorFrame
        ? applyPitchOffsetToFrame(rawDetectorFrame, micPitchOffsetCents)
        : null;
      const calibratedMicHz = frame.voiced ? (rawMic?.hz ?? frame.hz) : null;
      const calibratedMicMidi = hzToMidi(calibratedMicHz);
      const detectedMicHz = frame.voiced ? frame.hz : null;
      const detectedMicMidi = hzToMidi(detectedMicHz);
      const rawMicHz = detectedMicHz;
      const rawMicMidi = detectedMicMidi;
      const notes = chartNotesRef.current;
      const chartNote = expectedNoteAtTime(notes, micSongTime, CHART_EXPECTED_TOLERANCE_SEC);
      const guideCalibration = guideCalibrationRef.current;
      const guideArgs = guideOffsetArgs(guideCalibration);
      const fallbackStatus = liveDisplayRef.current.status();
      const activeDisplayOffset =
        guideArgs.guideOffset ??
        (fallbackStatus.userMicOffsetLocked ? (fallbackStatus.userMicOffset ?? null) : null);

      if (!frame.voiced || !rawDetectorFrame) {
        stabilizerRef.current.stabilize(null);
        const liveDisplay = liveDisplayRef.current.mapSilence({
          chartPitch: chartNote?.pitch ?? null,
          ...guideArgs,
        });
        bufferRef.current.tryPush(
          null,
          null,
          0,
          micSongTime,
          null,
          frame.id,
          {
            hz: null,
            midi: null,
            clarity: frame.clarity,
            rms: frame.rms,
            voiced: false,
          },
          liveDisplay,
        );
        setSeries(bufferRef.current.snapshot());
        setDebug({
          rawHz: rawMicHz,
          stabilizedHz: null,
          rawMidi: rawMicMidi,
          stabilizedMidi: null,
          clarity: frame.clarity,
          rms: frame.rms,
          frameAgeMs: decision.ageMs,
          frameId: frame.id,
          playbackTime: t,
          frameSongTime: micSongTime,
          voiced: false,
          reacquiring: stabilizerRef.current.status().reacquiring,
          comparisonAvailable: false,
          displayed: liveDisplay.displayPitch != null,
          scored: false,
          traceBreakInserted: false,
          dropReason: "unvoiced",
          ...debugFromLiveDisplay(liveDisplay),
        });
        return;
      }

      const vocals = getVocalsBuffer();
      let refHz: number | null = null;

      if (vocals && sampleVocalsWindow(vocals, micSongTime, scratchRef.current, 0)) {
        refHz = detectPitchFromSamplesRef(
          refDetector.current,
          scratchRef.current,
          vocals.sampleRate,
        );
      }

      const chartExpectedHz =
        chartNote && activeDisplayOffset != null
          ? semitoneToFreq(chartNote.pitch + activeDisplayOffset)
          : null;
      const comparisonHz = refHz ?? chartExpectedHz;
      const hasExpectedPitch = comparisonHz != null || chartNote != null;

      if (!hasExpectedPitch) {
        stabilizerRef.current.stabilize(null);
        const liveDisplay = liveDisplayRef.current.mapVoiced({
          displayMidi: calibratedMicMidi,
          registerMidi: rawMicMidi,
          chartPitch: null,
          ...guideArgs,
          clarity: frame.clarity,
          rms: frame.rms,
          scored: false,
        });
        bufferRef.current.tryPush(
          null,
          null,
          0,
          micSongTime,
          rawMic?.hz ?? null,
          frame.id,
          {
            hz: rawMicHz,
            midi: rawMicMidi,
            clarity: frame.clarity,
            rms: frame.rms,
            voiced: true,
          },
          liveDisplay,
        );
        setSeries(bufferRef.current.snapshot());
        setDebug({
          rawHz: rawMicHz,
          stabilizedHz: null,
          rawMidi: rawMicMidi,
          stabilizedMidi: null,
          clarity: frame.clarity,
          rms: frame.rms,
          frameAgeMs: decision.ageMs,
          frameId: frame.id,
          playbackTime: t,
          frameSongTime: micSongTime,
          voiced: stabilizerRef.current.status().voiced,
          reacquiring: stabilizerRef.current.status().reacquiring,
          comparisonAvailable: false,
          displayed: liveDisplay.displayPitch != null,
          scored: false,
          traceBreakInserted: false,
          dropReason: "no-expected-pitch",
          ...debugFromLiveDisplay(liveDisplay),
        });
        return;
      }

      const stabilizedMic = stabilizerRef.current.stabilize(rawMic, {
        expectedHz: chartExpectedHz,
        referenceHz: refHz,
      });
      const stabilizerStatus = stabilizerRef.current.status();
      const sim =
        comparisonHz != null && stabilizedMic != null
          ? pitchSimilarity(comparisonHz, stabilizedMic)
          : 0;
      const scored = shouldScoreMainMicTrace({
        chartNoteAvailable: chartNote != null,
        comparisonHz,
        stabilizedHz: stabilizedMic,
      });
      const dropReason: PitchScoringDropReason =
        stabilizedMic == null
          ? stabilizerStatus.reacquiring
            ? "reacquiring"
            : !stabilizerStatus.voiced
              ? "unvoiced"
              : "outlier"
          : null;
      const stabilizedMidi = hzToMidi(stabilizedMic);
      const liveDisplay =
        stabilizedMidi == null
          ? liveDisplayRef.current.mapSilence({
              chartPitch: chartNote?.pitch ?? null,
              ...guideArgs,
              dropReason: dropReason === "outlier" ? "outlier" : "unvoiced",
            })
          : liveDisplayRef.current.mapVoiced({
              displayMidi: stabilizedMidi,
              registerMidi: rawMicMidi ?? stabilizedMidi,
              chartPitch: chartNote?.pitch ?? null,
              ...guideArgs,
              clarity: frame.clarity,
              rms: frame.rms,
              scored,
            });
      const displayed = liveDisplay.displayPitch != null && liveDisplay.kind === "voiced";

      if (!displayed) {
        bufferRef.current.markTraceBreak();
      }

      bufferRef.current.tryPush(
        comparisonHz,
        stabilizedMic,
        sim,
        micSongTime,
        rawMic?.hz ?? null,
        frame.id,
        {
          hz: rawMicHz,
          midi: rawMicMidi,
          clarity: frame.clarity,
          rms: frame.rms,
          voiced: true,
        },
        liveDisplay,
      );
      scoringRef.current.accumulate(micSongTime, comparisonHz, stabilizedMic, sim);
      setSeries(bufferRef.current.snapshot());
      setScore(scoringRef.current.score());
      setDebug({
        rawHz: rawMicHz,
        stabilizedHz: stabilizedMic,
        rawMidi: rawMicMidi,
        stabilizedMidi,
        clarity: frame.clarity,
        rms: frame.rms,
        frameAgeMs: decision.ageMs,
        frameId: frame.id,
        playbackTime: t,
        frameSongTime: micSongTime,
        voiced: stabilizerStatus.voiced,
        reacquiring: stabilizerStatus.reacquiring,
        comparisonAvailable: comparisonHz != null,
        displayed,
        scored,
        traceBreakInserted: !displayed,
        dropReason,
        ...debugFromLiveDisplay(liveDisplay),
      });
    };

    return subscribe(run);
  }, [isReady, subscribe, getVocalsBuffer, micLatencySec, liveTraceOffsetSec, micPitchOffsetCents]);

  return { series, score, debug };
}

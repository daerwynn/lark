import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDialog } from "@/hooks/use-dialog";
import { useMicCapture } from "@/hooks/use-mic-pitch";
import { useMicSamples } from "@/hooks/use-mic-samples";
import { createMicPitchDetector, detectPitchFrameFromSamplesMic } from "@/lib/pitch/detect";
import type { PitchSeries } from "@/lib/pitch/state";
import { SampleRing } from "@/lib/mic/sample-ring";
import { PITCH_WINDOW_SAMPLES } from "@/lib/pitch/constants";
import {
  calibrationPitchSeriesFromFrames,
  calibrationSegmentsFromSequence,
} from "@/lib/practice/vocal-calibration-chart";
import {
  activeExpectedMidi,
  estimateVocalCalibration,
  type CalibrationPitchFrame,
  type VocalCalibrationEstimate,
} from "@/lib/practice/vocal-calibration";
import {
  buildPracticeLaneModel,
  DEFAULT_PRACTICE_RANGE,
  isPracticeSegmentDisplayVisible,
  MAX_PRACTICE_RANGE,
  MIN_PRACTICE_RANGE,
  practicePitchToY,
  practiceTimeToX,
  PRACTICE_LANE_PADDING_Y,
  PRACTICE_WINDOW_AFTER,
  PRACTICE_WINDOW_BEFORE,
  shouldConnectTracePoints,
  type PracticeLaneModel,
  type PracticeTracePoint,
} from "@/lib/practice/practice-pitch";
import {
  buildCalibrationSequence,
  CALIBRATION_PASS_TRANSPOSITIONS,
  CALIBRATION_SCALE_OFFSETS,
  midiToNoteName,
  sequenceDuration,
  VOICE_RANGE_PRESETS,
  type VoiceRangePreset,
} from "@/lib/practice/vocal-warmups";
import { useVocalCalibrationMutation } from "@/mutations/use-profile-mutations";
import { useConfig } from "@/queries/use-config";
import { useProfiles } from "@/queries/use-profiles";
import { CheckCircle2Icon, MicVocalIcon, MinusIcon, PlusIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { startToneSequence, type ToneSequenceController } from "./vocal-tone-player";

const RANGE_OPTIONS: VoiceRangePreset[] = ["low", "medium", "high"];
const RING_CAPACITY = PITCH_WINDOW_SAMPLES * 2;
const GRID_LINES = 7;
const NOTE_COLOR = "rgba(91, 214, 255, 0.82)";
const NOTE_EDGE = "rgba(255, 255, 255, 0.74)";
const USER_GOOD = "rgba(78, 255, 126, 0.96)";
const USER_OK = "rgba(255, 218, 82, 0.96)";
const USER_LOW = "rgba(255, 88, 88, 0.96)";

const EMPTY_SERIES: PitchSeries = {
  refPitches: [],
  userPitches: [],
  rawUserPitches: [],
  rawMicHz: [],
  rawMicMidi: [],
  rawMicClarity: [],
  rawMicRms: [],
  rawMicVoiced: [],
  traceBreaks: [],
  micFrameIds: [],
  similarities: [],
  times: [],
};

interface Size {
  width: number;
  height: number;
}

function formatMs(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}ms` : "--";
}

function formatCents(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} cents` : "--";
}

function formatTime(value: number): string {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

function setupCanvas(canvas: HTMLCanvasElement, size: Size): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx || size.width <= 0 || size.height <= 0) return null;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(size.width * dpr);
  canvas.height = Math.floor(size.height * dpr);
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);
  return ctx;
}

function timeToX(time: number, currentTime: number, width: number): number {
  return practiceTimeToX({ time, currentTime, width });
}

function pitchToY(pitch: number, model: PracticeLaneModel, height: number): number {
  return practicePitchToY(pitch, model.vertical, height);
}

function lineColor(similarity: number): string {
  if (similarity >= 0.76) return USER_GOOD;
  if (similarity >= 0.42) return USER_OK;
  return USER_LOW;
}

function drawGrid(ctx: CanvasRenderingContext2D, size: Size, model: PracticeLaneModel): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.13)";
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.font = "18px sans-serif";
  ctx.textBaseline = "middle";

  for (let i = 0; i < GRID_LINES; i++) {
    const t = i / (GRID_LINES - 1);
    const pitch = model.vertical.max - model.vertical.range * t;
    const y = PRACTICE_LANE_PADDING_Y + t * Math.max(1, size.height - PRACTICE_LANE_PADDING_Y * 2);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size.width, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(pitch)), 10, y);
  }

  const nowX =
    (PRACTICE_WINDOW_BEFORE / (PRACTICE_WINDOW_BEFORE + PRACTICE_WINDOW_AFTER)) * size.width;
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(nowX, 0);
  ctx.lineTo(nowX, size.height);
  ctx.stroke();
  ctx.restore();
}

function drawChartNotes(
  ctx: CanvasRenderingContext2D,
  size: Size,
  model: PracticeLaneModel,
  currentTime: number,
): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.font = "22px sans-serif";
  ctx.textBaseline = "middle";

  for (const note of model.expectedNotes) {
    const x1 = timeToX(note.start, currentTime, size.width);
    const x2 = timeToX(note.end, currentTime, size.width);
    if (x2 < 0 || x1 > size.width) continue;

    const x = Math.max(22, x1);
    const width = Math.max(28, Math.min(size.width - 22, x2) - x);
    const y = pitchToY(note.pitch, model, size.height);
    const h = Math.max(18, Math.min(34, size.height * 0.075));

    ctx.fillStyle = NOTE_COLOR;
    ctx.strokeStyle = NOTE_EDGE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y - h / 2, width, h, 6);
    ctx.fill();
    ctx.stroke();

    if (width > 54 && note.label) {
      ctx.fillStyle = "rgba(5, 12, 18, 0.88)";
      ctx.fillText(note.label, x + 10, y);
    }
  }

  ctx.restore();
}

function drawTrace(
  ctx: CanvasRenderingContext2D,
  size: Size,
  model: PracticeLaneModel,
  currentTime: number,
  points: PracticeTracePoint[],
): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 12;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const point = points[i];
    if (!shouldConnectTracePoints(prev, point)) continue;

    const x1 = timeToX(prev.time, currentTime, size.width);
    const x2 = timeToX(point.time, currentTime, size.width);
    if ((x1 < 0 && x2 < 0) || (x1 > size.width && x2 > size.width)) continue;

    ctx.strokeStyle = lineColor(point.similarity);
    ctx.beginPath();
    ctx.moveTo(x1, pitchToY(prev.pitch, model, size.height));
    ctx.lineTo(x2, pitchToY(point.pitch, model, size.height));
    ctx.stroke();
  }

  ctx.restore();
}

function drawLatestMarker(
  ctx: CanvasRenderingContext2D,
  size: Size,
  model: PracticeLaneModel,
  currentTime: number,
): void {
  const point = model.latestUserPitch;
  if (!point) return;

  const x = timeToX(point.time, currentTime, size.width);
  if (x < 0 || x > size.width) return;

  const y = pitchToY(point.pitch, model, size.height);
  ctx.save();
  ctx.fillStyle = lineColor(point.similarity);
  ctx.strokeStyle = "rgba(255,255,255,0.96)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLane(
  canvas: HTMLCanvasElement,
  size: Size,
  model: PracticeLaneModel,
  currentTime: number,
): void {
  const ctx = setupCanvas(canvas, size);
  if (!ctx) return;

  ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
  ctx.fillRect(0, 0, size.width, size.height);
  drawGrid(ctx, size, model);
  drawChartNotes(ctx, size, model, currentTime);
  drawTrace(ctx, size, model, currentTime, model.userTrace);
  drawLatestMarker(ctx, size, model, currentTime);
}

export function VocalCalibrationDialog() {
  const { mode, close, setMode } = useDialog();
  const open = mode === "vocal-calibration";
  const { data: config } = useConfig();
  const { data: profiles } = useProfiles();
  const { mutate } = useVocalCalibrationMutation();
  const activeProfile = profiles?.active ?? null;
  const existingCalibration = activeProfile
    ? (profiles?.vocal_calibrations[activeProfile] ?? null)
    : null;

  const [rangePreset, setRangePreset] = useState<VoiceRangePreset>("medium");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [latestHz, setLatestHz] = useState<number | null>(null);
  const [estimate, setEstimate] = useState<VocalCalibrationEstimate | null>(null);
  const [series, setSeries] = useState<PitchSeries>(EMPTY_SERIES);
  const [laneRange, setLaneRange] = useState(DEFAULT_PRACTICE_RANGE);
  const sequence = useMemo(() => buildCalibrationSequence(rangePreset), [rangePreset]);
  const segments = useMemo(() => calibrationSegmentsFromSequence(sequence), [sequence]);
  const durationSec = useMemo(() => sequenceDuration(sequence), [sequence]);
  const ringRef = useRef(new SampleRing(RING_CAPACITY));
  const detectorRef = useRef(createMicPitchDetector());
  const windowRef = useRef(new Float32Array(PITCH_WINDOW_SAMPLES));
  const startMsRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const framesRef = useRef<CalibrationPitchFrame[]>([]);
  const controllerRef = useRef<ToneSequenceController | null>(null);
  const lane = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const {
    active: micActive,
    error: micError,
    deviceName,
  } = useMicCapture(config?.preferred_mic ?? null, open, { emit_audio: false });

  const finishCalibration = useCallback(
    (cancelled: boolean) => {
      controllerRef.current?.stop();
      controllerRef.current = null;
      runningRef.current = false;
      setRunning(false);
      setSeries(calibrationPitchSeriesFromFrames(sequence, framesRef.current));

      if (cancelled || !activeProfile) {
        return;
      }

      const nextEstimate = estimateVocalCalibration({
        profile: activeProfile,
        deviceName: deviceName ?? config?.preferred_mic ?? "Default",
        rangePreset,
        sequence,
        frames: framesRef.current,
      });
      setEstimate(nextEstimate);
    },
    [activeProfile, config?.preferred_mic, deviceName, rangePreset, sequence],
  );

  useMicSamples((frame) => {
    if (!runningRef.current || startMsRef.current == null) return;

    ringRef.current.push(frame.samples);
    if (!ringRef.current.readMostRecent(windowRef.current)) return;

    const pitchFrame = detectPitchFrameFromSamplesMic(
      detectorRef.current,
      windowRef.current,
      frame.sample_rate,
    );
    if (!pitchFrame) return;

    const timeSec = Math.max(0, (performance.now() - startMsRef.current) / 1000);
    framesRef.current.push({ ...pitchFrame, timeSec });
    setLatestHz(pitchFrame.hz);
    if (framesRef.current.length % 5 === 0) {
      setFrameCount(framesRef.current.length);
      setSeries(calibrationPitchSeriesFromFrames(sequence, framesRef.current));
    }
  }, open);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (startMsRef.current == null) return;
      setElapsed(
        Math.min(durationSec, Math.max(0, (performance.now() - startMsRef.current) / 1000)),
      );
    }, 60);
    return () => window.clearInterval(id);
  }, [durationSec, running]);

  useEffect(() => {
    if (!open) {
      finishCalibration(true);
      setElapsed(0);
      setEstimate(null);
      setFrameCount(0);
      setLatestHz(null);
      setSeries(EMPTY_SERIES);
    }
  }, [finishCalibration, open]);

  const currentTime = Math.min(durationSec, elapsed);
  const model = useMemo(
    () =>
      buildPracticeLaneModel({
        segments,
        series,
        currentTime,
        semitoneRange: laneRange,
      }),
    [currentTime, laneRange, segments, series],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawLane(canvas, lane.size, model, currentTime);
  }, [currentTime, lane.size, model]);

  const handleStart = () => {
    if (!activeProfile) {
      setMode("select-profile");
      return;
    }
    if (!micActive) {
      toast.error(micError ? `Microphone: ${micError}` : "Microphone is not ready yet.");
      return;
    }

    controllerRef.current?.stop();
    detectorRef.current = createMicPitchDetector();
    ringRef.current.reset();
    framesRef.current = [];
    setEstimate(null);
    setFrameCount(0);
    setLatestHz(null);
    setElapsed(0);
    setSeries(EMPTY_SERIES);
    const controller = startToneSequence(sequence, () => finishCalibration(false));
    controllerRef.current = controller;
    startMsRef.current = controller.startMs;
    runningRef.current = true;
    setRunning(true);
  };

  const handleRangeChange = (value: string) => {
    setRangePreset(value as VoiceRangePreset);
    setElapsed(0);
    setEstimate(null);
    setFrameCount(0);
    setLatestHz(null);
    framesRef.current = [];
    setSeries(EMPTY_SERIES);
  };

  const handleSave = () => {
    if (!activeProfile || !estimate?.calibration) return;
    mutate(
      { type: "save", profile: activeProfile, calibration: estimate.calibration },
      {
        onSuccess: () => {
          toast.success("Voice calibration saved.");
          close();
        },
      },
    );
  };

  const handleClear = () => {
    if (!activeProfile) return;
    mutate(
      { type: "clear", profile: activeProfile },
      {
        onSuccess: () => {
          toast.success("Voice calibration cleared.");
          setEstimate(null);
        },
      },
    );
  };

  const currentMidi = activeExpectedMidi(sequence, currentTime);
  const currentToneIndex = sequence.findIndex(
    (tone) => currentTime >= tone.startSec && currentTime < tone.endSec,
  );
  const safeToneIndex = currentToneIndex >= 0 ? currentToneIndex : Math.max(0, sequence.length - 1);
  const currentPassIndex = Math.min(
    CALIBRATION_PASS_TRANSPOSITIONS.length,
    Math.floor(safeToneIndex / CALIBRATION_SCALE_OFFSETS.length) + 1,
  );
  const currentNoteInPass =
    currentToneIndex >= 0 ? (currentToneIndex % CALIBRATION_SCALE_OFFSETS.length) + 1 : 1;
  const totalNoteIndex = currentToneIndex >= 0 ? currentToneIndex + 1 : 1;
  const currentTone = sequence.find(
    (tone) => currentTime >= tone.startSec && currentTime < tone.endSec,
  );
  const progress = Math.min(100, (currentTime / durationSec) * 100);
  const currentPhraseVisible =
    model.currentSegment != null &&
    isPracticeSegmentDisplayVisible(model.currentSegment, currentTime);
  const phrase =
    currentPhraseVisible && model.currentSegment ? model.currentSegment.text : "Ready for DO";
  const nextPhrase =
    model.currentSegmentIndex >= 0 &&
    currentPhraseVisible &&
    model.currentSegmentIndex + 1 < segments.length
      ? segments[model.currentSegmentIndex + 1].text
      : "";
  const match = model.matchQuality == null ? "--" : `${model.matchQuality}%`;
  const status = running ? "Calibrating" : estimate ? "Complete" : "Ready";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <DialogContent className="h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none overflow-hidden bg-black p-0 text-white sm:max-w-none">
        <div className="flex h-full min-h-0 flex-col bg-black px-8 pt-8 pb-7">
          <DialogHeader className="sr-only">
            <DialogTitle>Voice Calibration</DialogTitle>
            <DialogDescription>
              Sing the displayed solfege tones to calibrate pitch and microphone latency.
            </DialogDescription>
          </DialogHeader>

          <div className="flex shrink-0 flex-wrap items-start justify-between gap-5 pr-12">
            <div>
              <p className="text-sm tracking-[0.18em] text-white/55 uppercase">Voice Calibration</p>
              <div className="mt-1 flex items-baseline gap-4">
                <p className="text-6xl font-semibold tabular-nums">{match}</p>
                <p className="text-2xl text-white/70">match</p>
                <Badge variant={running ? "default" : "outline"}>{status}</Badge>
              </div>
            </div>

            <div className="flex max-w-[68%] flex-wrap items-start justify-end gap-3">
              <div className="rounded-sm border border-white/15 bg-white/10 px-4 py-2">
                <p className="text-xs tracking-[0.16em] text-white/55 uppercase">Profile</p>
                <p className="max-w-44 truncate text-xl font-semibold">
                  {activeProfile ?? "Select profile"}
                </p>
              </div>
              <div className="rounded-sm border border-white/15 bg-white/10 px-4 py-2">
                <p className="text-xs tracking-[0.16em] text-white/55 uppercase">Mic</p>
                <p className="max-w-56 truncate text-xl font-semibold">
                  {micActive
                    ? (deviceName ?? "Default")
                    : micError
                      ? `Error: ${micError}`
                      : "Opening"}
                </p>
              </div>
              <Select value={rangePreset} disabled={running} onValueChange={handleRangeChange}>
                <SelectTrigger className="h-14 w-36 border-white/20 bg-white/10 text-lg text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {VOICE_RANGE_PRESETS[preset].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 rounded-sm border border-white/15 bg-white/10 p-2">
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-sm border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40"
                  disabled={laneRange <= MIN_PRACTICE_RANGE}
                  aria-label="Decrease pitch range"
                  onClick={() => setLaneRange((prev) => Math.max(MIN_PRACTICE_RANGE, prev - 6))}
                >
                  <MinusIcon className="size-6" />
                </button>
                <p className="w-24 text-center text-xl font-medium tabular-nums">{laneRange} st</p>
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-sm border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40"
                  disabled={laneRange >= MAX_PRACTICE_RANGE}
                  aria-label="Increase pitch range"
                  onClick={() => setLaneRange((prev) => Math.min(MAX_PRACTICE_RANGE, prev + 6))}
                >
                  <PlusIcon className="size-6" />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 h-2 shrink-0 overflow-hidden rounded-full bg-white/12">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-4 grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-sm border border-white/15 bg-white/10 px-4 py-2">
              <p className="text-xs tracking-[0.16em] text-white/55 uppercase">Pass</p>
              <p className="text-2xl font-semibold tabular-nums">
                {currentPassIndex} / {CALIBRATION_PASS_TRANSPOSITIONS.length}
              </p>
            </div>
            <div className="rounded-sm border border-white/15 bg-white/10 px-4 py-2">
              <p className="text-xs tracking-[0.16em] text-white/55 uppercase">Note</p>
              <p className="text-2xl font-semibold tabular-nums">
                {currentNoteInPass} / {CALIBRATION_SCALE_OFFSETS.length}
              </p>
            </div>
            <div className="rounded-sm border border-white/15 bg-white/10 px-4 py-2">
              <p className="text-xs tracking-[0.16em] text-white/55 uppercase">Total</p>
              <p className="text-2xl font-semibold tabular-nums">
                {totalNoteIndex} / {sequence.length}
              </p>
            </div>
            <div className="rounded-sm border border-white/15 bg-white/10 px-4 py-2">
              <p className="text-xs tracking-[0.16em] text-white/55 uppercase">Hold</p>
              <p className="text-2xl font-semibold tabular-nums">2.0s</p>
            </div>
          </div>

          <div
            ref={lane.ref}
            className="mt-6 min-h-0 flex-1 overflow-hidden rounded-sm border border-white/18 bg-black/50 shadow-2xl shadow-black/40"
          >
            <canvas ref={canvasRef} className="block" />
          </div>

          <div className="mt-5 shrink-0">
            <p className="text-center text-7xl leading-none font-semibold text-white drop-shadow">
              {currentTone?.syllable ?? "DO"}
              {currentMidi != null ? (
                <span className="ml-5 text-4xl text-white/70">{midiToNoteName(currentMidi)}</span>
              ) : null}
            </p>
            <p className="mt-3 line-clamp-2 text-center text-5xl leading-tight font-semibold text-white drop-shadow">
              {phrase}
            </p>
            {nextPhrase && (
              <p className="mt-2 line-clamp-2 text-center text-3xl leading-tight font-semibold text-gray-400/80 drop-shadow">
                {nextPhrase}
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-center gap-5 text-lg text-white/65">
              <span>
                {formatTime(currentTime)} / {formatTime(durationSec)}
              </span>
              <span>Frames: {frameCount}</span>
              <span>Latest: {latestHz == null ? "--" : `${Math.round(latestHz)}Hz`}</span>
              <span>Pitch offset: {formatCents(estimate?.pitchOffsetCents)}</span>
              <span>Latency: {formatMs(estimate?.micLatencyMs)}</span>
              <span>Quality: {estimate ? `${Math.round(estimate.qualityScore)}%` : "--"}</span>
            </div>
            {estimate?.reason && (
              <p className="mt-3 text-center text-lg text-yellow-200">{estimate.reason}</p>
            )}
          </div>

          <div className="mt-5 flex shrink-0 items-center justify-between gap-4">
            <Button
              variant="outline"
              className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={handleClear}
              disabled={!existingCalibration || running}
            >
              Clear Saved
            </Button>
            <div className="flex gap-3">
              {running ? (
                <Button
                  variant="outline"
                  className="min-h-12 border-white/25 bg-white/10 px-5 text-lg text-white hover:bg-white/20 hover:text-white"
                  onClick={() => finishCalibration(true)}
                >
                  <SquareIcon /> Stop
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="min-h-12 border-white/25 bg-white/10 px-5 text-lg text-white hover:bg-white/20 hover:text-white"
                  onClick={handleStart}
                >
                  <MicVocalIcon /> Start Calibration
                </Button>
              )}
              <Button
                className="min-h-12 px-5 text-lg"
                onClick={handleSave}
                disabled={!estimate?.calibration || running}
              >
                <CheckCircle2Icon /> Save Calibration
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

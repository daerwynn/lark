import { usePlaybackTransportActions, usePlaybackTransportState } from "@/contexts/playback";
import type { PracticeLoopControls } from "@/hooks/playback";
import type { PitchScoringDebug } from "@/hooks/use-pitch-scoring";
import { shortcutHint, type PlaybackShortcutBindings } from "@/lib/playback/keybindings";
import { formatPlaybackTime } from "@/lib/playback/transport-controls";
import {
  liveVoiceTraceStroke,
  RAW_LIVE_VOICE_MAX_CONNECTION_GAP_SEC,
  shouldConnectLiveVoiceTracePoints,
  styleLiveVoiceTracePoint,
  type LiveVoiceTracePoint,
} from "@/lib/pitch/live-voice-trace";
import type { PitchSeries } from "@/lib/pitch/state";
import type { PracticeCountInSec, PracticeLoopRange } from "@/lib/practice/practice-loop";
import {
  pitchFeedbackLevelFromCents,
  type PitchFeedbackLevel,
  type PracticeSettings,
} from "@/lib/practice/practice-settings";
import {
  buildPracticeLaneModel,
  DEFAULT_PRACTICE_RANGE,
  filterPitchSeriesSince,
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
import type { Segment } from "@/types/Transcript";
import {
  FlagIcon,
  MinusIcon,
  PlusIcon,
  RepeatIcon,
  RotateCcwIcon,
  TimerIcon,
  XIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

interface PracticeOverlayProps {
  segments: Segment[];
  series: PitchSeries;
  micDebug: PitchScoringDebug;
  micCaptureActive: boolean;
  micPitchActive: boolean;
  loop: PracticeLoopControls;
  settings: PracticeSettings;
  keybindings: PlaybackShortcutBindings;
  lyricDisplayOffsetSec?: number;
  lyricLeadSec?: number;
}

interface Size {
  width: number;
  height: number;
}

const GRID_LINES = 7;
const LANE_PADDING_X = 20;
const NOTE_COLOR = "rgba(91, 214, 255, 0.78)";
const NOTE_EDGE = "rgba(255, 255, 255, 0.7)";
const REF_COLOR = "rgba(91, 214, 255, 0.72)";
const CHART_RELATIVE_TRACE_COLOR = "rgba(255, 188, 83, 0.72)";
const USER_GOOD = "rgba(78, 255, 126, 0.95)";
const USER_OK = "rgba(255, 218, 82, 0.95)";
const USER_LOW = "rgba(255, 88, 88, 0.95)";
const LOOP_BAND = "rgba(255, 255, 255, 0.08)";
const LOOP_EDGE = "rgba(255, 255, 255, 0.72)";
const FEEDBACK_GLOW: Record<PitchFeedbackLevel, string> = {
  orange: "rgba(255, 145, 58, 0.9)",
  yellow: "rgba(255, 230, 84, 0.95)",
  green: "rgba(75, 255, 126, 0.95)",
};

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

function loopSource(range: PracticeLoopRange): string {
  return range.source === "phrase" ? "Phrase" : "Manual";
}

function loopSummary(loop: PracticeLoopControls): string {
  if (loop.activeLoop) {
    return `${loopSource(loop.activeLoop)}: ${formatPlaybackTime(
      loop.activeLoop.start,
    )} to ${formatPlaybackTime(loop.activeLoop.end)}`;
  }

  if (loop.manualStart != null || loop.manualEnd != null) {
    const start = loop.manualStart == null ? "--" : formatPlaybackTime(loop.manualStart);
    const end = loop.manualEnd == null ? "--" : formatPlaybackTime(loop.manualEnd);
    return `Marks: ${start} to ${end}`;
  }

  return "Loop: none";
}

function drawGrid(ctx: CanvasRenderingContext2D, size: Size, model: PracticeLaneModel): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.13)";
  ctx.fillStyle = "rgba(255,255,255,0.36)";
  ctx.font = "16px sans-serif";
  ctx.textBaseline = "middle";

  for (let i = 0; i < GRID_LINES; i++) {
    const t = i / (GRID_LINES - 1);
    const pitch = model.vertical.max - model.vertical.range * t;
    const y = PRACTICE_LANE_PADDING_Y + t * Math.max(1, size.height - PRACTICE_LANE_PADDING_Y * 2);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size.width, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(pitch)), 8, y);
  }

  const nowX =
    (PRACTICE_WINDOW_BEFORE / (PRACTICE_WINDOW_BEFORE + PRACTICE_WINDOW_AFTER)) * size.width;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(nowX, 0);
  ctx.lineTo(nowX, size.height);
  ctx.stroke();
  ctx.restore();
}

function drawLoopRange(
  ctx: CanvasRenderingContext2D,
  size: Size,
  currentTime: number,
  range: PracticeLoopRange | null,
): void {
  if (!range) return;

  const x1 = timeToX(range.start, currentTime, size.width);
  const x2 = timeToX(range.end, currentTime, size.width);
  const left = Math.max(0, Math.min(x1, x2));
  const right = Math.min(size.width, Math.max(x1, x2));

  if (right <= 0 || left >= size.width) return;

  ctx.save();
  ctx.fillStyle = LOOP_BAND;
  ctx.fillRect(left, 0, Math.max(1, right - left), size.height);

  ctx.strokeStyle = LOOP_EDGE;
  ctx.lineWidth = 3;
  for (const x of [x1, x2]) {
    if (x < 0 || x > size.width) continue;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size.height);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.74)";
  ctx.font = "16px sans-serif";
  ctx.fillText("LOOP", left + 12, 24);
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
  ctx.font = "18px sans-serif";
  ctx.textBaseline = "middle";

  for (const note of model.expectedNotes) {
    const x1 = timeToX(note.start, currentTime, size.width);
    const x2 = timeToX(note.end, currentTime, size.width);
    if (x2 < 0 || x1 > size.width) continue;

    const x = Math.max(LANE_PADDING_X, x1);
    const width = Math.max(18, Math.min(size.width - LANE_PADDING_X, x2) - x);
    const y = pitchToY(note.pitch, model, size.height);
    const h = Math.max(12, Math.min(24, size.height * 0.055));

    ctx.fillStyle = note.estimated ? "rgba(255, 199, 92, 0.68)" : NOTE_COLOR;
    ctx.strokeStyle = NOTE_EDGE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y - h / 2, width, h, 5);
    ctx.fill();
    ctx.stroke();

    if (width > 72 && note.label) {
      ctx.fillStyle = "rgba(5, 12, 18, 0.86)";
      ctx.fillText(note.label, x + 8, y);
    }
  }

  ctx.restore();
}

function drawPitchFeedbackGlow(
  ctx: CanvasRenderingContext2D,
  size: Size,
  model: PracticeLaneModel,
  currentTime: number,
  level: PitchFeedbackLevel | null,
): void {
  const note = model.currentExpectedNote;
  if (!note || !level) return;

  const color = FEEDBACK_GLOW[level];
  const y = pitchToY(note.pitch, model, size.height);
  const noteStartX = timeToX(note.start, currentTime, size.width);
  const noteEndX = timeToX(note.end, currentTime, size.width);
  const nowX =
    (PRACTICE_WINDOW_BEFORE / (PRACTICE_WINDOW_BEFORE + PRACTICE_WINDOW_AFTER)) * size.width;
  const hasDuration = note.end - note.start > 0.05;
  const left = hasDuration ? Math.max(0, Math.min(noteStartX, noteEndX)) : Math.max(0, nowX - 80);
  const right = hasDuration
    ? Math.min(size.width, Math.max(noteStartX, noteEndX))
    : Math.min(size.width, nowX + 80);

  if (right <= 0 || left >= size.width) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 32;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = 30;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(Math.max(left + 1, right), y);
  ctx.stroke();
  ctx.restore();
}

function drawTrace(
  ctx: CanvasRenderingContext2D,
  size: Size,
  model: PracticeLaneModel,
  currentTime: number,
  points: PracticeTracePoint[],
  options: { lineWidth: number; color?: string; bySimilarity?: boolean },
): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = options.lineWidth;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const point = points[i];
    if (!shouldConnectTracePoints(prev, point)) continue;

    const x1 = timeToX(prev.time, currentTime, size.width);
    const x2 = timeToX(point.time, currentTime, size.width);
    if ((x1 < 0 && x2 < 0) || (x1 > size.width && x2 > size.width)) continue;

    ctx.strokeStyle = options.bySimilarity
      ? lineColor(point.similarity)
      : (options.color ?? REF_COLOR);
    ctx.beginPath();
    ctx.moveTo(x1, pitchToY(prev.pitch, model, size.height));
    ctx.lineTo(x2, pitchToY(point.pitch, model, size.height));
    ctx.stroke();
  }

  ctx.restore();
}

function drawLiveVoiceTrace(
  ctx: CanvasRenderingContext2D,
  size: Size,
  model: PracticeLaneModel,
  currentTime: number,
  points: LiveVoiceTracePoint[],
  settings: PracticeSettings,
  options: {
    lineWidth?: number;
    color?: string;
    maxGapSec?: number;
    useScoredStyle?: boolean;
  } = {},
): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = options.lineWidth ?? 10;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const point = points[i];
    if (!shouldConnectLiveVoiceTracePoints(prev, point, options.maxGapSec)) continue;

    const x1 = timeToX(prev.time, currentTime, size.width);
    const x2 = timeToX(point.time, currentTime, size.width);
    if ((x1 < 0 && x2 < 0) || (x1 > size.width && x2 > size.width)) continue;

    ctx.lineWidth =
      point.kind === "silence" || prev.kind === "silence"
        ? Math.max(3, (options.lineWidth ?? 10) * 0.55)
        : (options.lineWidth ?? 10);
    ctx.strokeStyle = liveVoiceTraceStroke(point, settings.pitchFeedback, {
      color: options.color,
      useScoredStyle: options.useScoredStyle,
    });
    ctx.beginPath();
    ctx.moveTo(x1, pitchToY(prev.pitch, model, size.height));
    ctx.lineTo(x2, pitchToY(point.pitch, model, size.height));
    ctx.stroke();
  }

  ctx.restore();
}

function drawLatestLiveVoiceMarker(
  ctx: CanvasRenderingContext2D,
  size: Size,
  model: PracticeLaneModel,
  currentTime: number,
  settings: PracticeSettings,
): void {
  const point = model.latestLiveVoicePoint;
  if (!point) return;

  const x = timeToX(point.time, currentTime, size.width);
  if (x < 0 || x > size.width) return;

  const y = pitchToY(point.pitch, model, size.height);
  const style = styleLiveVoiceTracePoint(point, settings.pitchFeedback);
  ctx.save();
  ctx.fillStyle = style.marker;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLane(
  canvas: HTMLCanvasElement,
  size: Size,
  model: PracticeLaneModel,
  currentTime: number,
  loopRange: PracticeLoopRange | null,
  feedbackLevel: PitchFeedbackLevel | null,
  showDebugTrace: boolean,
  settings: PracticeSettings,
): void {
  const ctx = setupCanvas(canvas, size);
  if (!ctx) return;

  ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
  ctx.fillRect(0, 0, size.width, size.height);
  drawGrid(ctx, size, model);
  drawLoopRange(ctx, size, currentTime, loopRange);
  drawPitchFeedbackGlow(ctx, size, model, currentTime, feedbackLevel);

  if (model.expectedSource === "chart") {
    drawChartNotes(ctx, size, model, currentTime);
  } else {
    drawTrace(ctx, size, model, currentTime, model.referenceTrace, {
      lineWidth: 9,
      color: REF_COLOR,
    });
  }

  drawLiveVoiceTrace(ctx, size, model, currentTime, model.rawLiveVoiceTrace, settings, {
    lineWidth: 10,
    maxGapSec: RAW_LIVE_VOICE_MAX_CONNECTION_GAP_SEC,
    useScoredStyle: true,
  });

  if (showDebugTrace) {
    drawLiveVoiceTrace(ctx, size, model, currentTime, model.chartRelativeVoiceTrace, settings, {
      lineWidth: 3,
      color: CHART_RELATIVE_TRACE_COLOR,
    });
  }

  drawLatestLiveVoiceMarker(ctx, size, model, currentTime, settings);
}

function SourceLabel({ source }: { source: PracticeLaneModel["expectedSource"] }) {
  const label =
    source === "chart"
      ? "Expected: chart notes"
      : source === "reference"
        ? "Expected: vocal reference"
        : "Expected: waiting";

  return <span>{label}</span>;
}

function practiceDebugEnabled(): boolean {
  if (!import.meta.env.DEV) return false;

  try {
    return (
      window.localStorage.getItem("nightingale.practice.debug") === "1" ||
      window.location.search.includes("practiceDebug=1")
    );
  } catch {
    return false;
  }
}

function countLiveVoicePointsInWindow(
  points: LiveVoiceTracePoint[],
  currentTime: number,
  kind?: LiveVoiceTracePoint["kind"],
): number {
  const start = currentTime - PRACTICE_WINDOW_BEFORE;
  const end = currentTime + PRACTICE_WINDOW_AFTER;
  return points.filter(
    (point) => point.time >= start && point.time <= end && (kind == null || point.kind === kind),
  ).length;
}

function latestVoicedLiveVoicePoint(points: LiveVoiceTracePoint[]): LiveVoiceTracePoint | null {
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index];
    if (point.kind === "voiced") {
      return point;
    }
  }
  return null;
}

function segmentTimingSignature(segments: Segment[]): string {
  return segments
    .map((segment) => {
      const firstBeat = segment.words.find((word) => Number.isFinite(word.beat))?.beat ?? "";
      return `${segment.start}:${segment.end}:${segment.words.length}:${firstBeat}`;
    })
    .join("|");
}

function PracticeButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex min-h-11 items-center gap-2 rounded-sm border border-white/20 bg-white/10 px-3 text-base font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CountInButton({
  value,
  current,
  onClick,
}: {
  value: PracticeCountInSec;
  current: PracticeCountInSec;
  onClick: (value: PracticeCountInSec) => void;
}) {
  const active = value === current;

  return (
    <button
      type="button"
      className={`min-h-10 min-w-12 rounded-sm border px-3 text-base font-semibold tabular-nums transition-colors ${
        active
          ? "border-white/70 bg-white text-black"
          : "border-white/20 bg-white/10 text-white hover:bg-white/20"
      }`}
      aria-pressed={active}
      onClick={() => onClick(value)}
    >
      {value}s
    </button>
  );
}

function PracticeOverlayImpl({
  segments,
  series,
  micDebug,
  micCaptureActive,
  micPitchActive,
  loop,
  settings,
  keybindings,
  lyricDisplayOffsetSec = 0,
  lyricLeadSec,
}: PracticeOverlayProps) {
  const { isPlaying } = usePlaybackTransportState();
  const { getCurrentTime, subscribe } = usePlaybackTransportActions();
  const [currentTime, setCurrentTime] = useState(() => getCurrentTime());
  const [range, setRange] = useState(DEFAULT_PRACTICE_RANGE);
  const [seriesResetTime, setSeriesResetTime] = useState(0);
  const lane = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segmentSignatureRef = useRef<string | null>(null);
  const debugEnabled = useMemo(() => practiceDebugEnabled(), []);

  useEffect(() => {
    setCurrentTime(getCurrentTime());
    return subscribe(setCurrentTime);
  }, [getCurrentTime, subscribe]);

  useEffect(() => {
    const signature = segmentTimingSignature(segments);
    if (segmentSignatureRef.current != null && segmentSignatureRef.current !== signature) {
      setSeriesResetTime(getCurrentTime());
    }
    segmentSignatureRef.current = signature;
  }, [getCurrentTime, segments]);

  const visibleSeries = useMemo(
    () => filterPitchSeriesSince(series, seriesResetTime),
    [series, seriesResetTime],
  );

  const model = useMemo(
    () =>
      buildPracticeLaneModel({
        segments,
        series: visibleSeries,
        currentTime,
        semitoneRange: range,
        lyricDisplayOffsetSec,
        lyricLeadSec,
      }),
    [segments, visibleSeries, currentTime, range, lyricDisplayOffsetSec, lyricLeadSec],
  );
  const feedbackLevel = pitchFeedbackLevelFromCents(
    model.latestLiveCentsDifference,
    settings.pitchFeedback,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawLane(
      canvas,
      lane.size,
      model,
      currentTime,
      loop.activeLoop,
      feedbackLevel,
      debugEnabled,
      settings,
    );
  }, [lane.size, model, currentTime, loop.activeLoop, feedbackLevel, debugEnabled, settings]);

  const currentPhraseVisible =
    model.currentSegment != null &&
    isPracticeSegmentDisplayVisible(
      model.currentSegment,
      currentTime,
      lyricDisplayOffsetSec,
      lyricLeadSec,
    );
  const phrase =
    currentPhraseVisible && model.currentSegment
      ? model.currentSegment.text.trim()
      : "Waiting for the next phrase";
  const nextPhrase =
    model.currentSegmentIndex >= 0
      ? currentPhraseVisible
        ? model.currentSegmentIndex + 1 < segments.length
          ? segments[model.currentSegmentIndex + 1].text.trim()
          : ""
        : (model.currentSegment?.text.trim() ?? "")
      : "";
  const match = model.matchQuality == null ? "--" : `${model.matchQuality}%`;
  const status = isPlaying ? "Live" : "Paused";
  const attempt = loop.lastAttemptScore == null ? "--" : `${loop.lastAttemptScore}%`;
  const canClear = loop.activeLoop != null || loop.manualStart != null || loop.manualEnd != null;
  const latestLiveAge =
    model.latestLiveVoicePoint == null
      ? Number.POSITIVE_INFINITY
      : currentTime - model.latestLiveVoicePoint.time;
  const micStatus = !micCaptureActive
    ? "Mic: off"
    : !micPitchActive
      ? "Mic: listening"
      : latestLiveAge <= 0.35 && model.latestLiveVoicePoint?.kind === "voiced"
        ? "Mic: pitch detected"
        : "Mic: no pitch";
  const visibleLiveTracePoints = countLiveVoicePointsInWindow(model.rawLiveVoiceTrace, currentTime);
  const silenceTracePointsInWindow = countLiveVoicePointsInWindow(
    model.rawLiveVoiceTrace,
    currentTime,
    "silence",
  );
  const scoredTracePointsInWindow = countLiveVoicePointsInWindow(
    model.chartRelativeVoiceTrace,
    currentTime,
  );
  const latestVoicedPoint = latestVoicedLiveVoicePoint(model.rawLiveVoiceTrace);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col bg-black/62 px-8 pt-24 pb-40 text-white">
      <div className="flex shrink-0 items-start justify-between gap-5">
        <div>
          <p className="text-sm tracking-[0.18em] text-white/55 uppercase">Practice Mode</p>
          <div className="mt-1 flex items-baseline gap-4">
            <p className="text-6xl font-semibold tabular-nums">{match}</p>
            <p className="text-2xl text-white/70">match</p>
            <p className="rounded-sm border border-white/25 px-2 py-1 text-base text-white/70">
              {status}
            </p>
          </div>
        </div>

        <div className="pointer-events-auto flex max-w-[68%] flex-col items-end gap-3">
          <div className="flex flex-wrap justify-end gap-3">
            <div className="rounded-sm border border-white/15 bg-black/45 px-4 py-2 text-right">
              <p className="text-sm tracking-[0.16em] text-white/55 uppercase">Last Loop</p>
              <p className="text-4xl leading-none font-semibold tabular-nums">{attempt}</p>
            </div>

            <div className="flex items-center gap-2 rounded-sm border border-white/15 bg-black/45 p-2">
              <button
                type="button"
                className="flex size-11 items-center justify-center rounded-sm border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40"
                disabled={range <= MIN_PRACTICE_RANGE}
                aria-label="Decrease pitch range"
                onClick={() => setRange((prev) => Math.max(MIN_PRACTICE_RANGE, prev - 6))}
              >
                <MinusIcon className="size-6" />
              </button>
              <p className="w-24 text-center text-xl font-medium tabular-nums">{range} st</p>
              <button
                type="button"
                className="flex size-11 items-center justify-center rounded-sm border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40"
                disabled={range >= MAX_PRACTICE_RANGE}
                aria-label="Increase pitch range"
                onClick={() => setRange((prev) => Math.min(MAX_PRACTICE_RANGE, prev + 6))}
              >
                <PlusIcon className="size-6" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <PracticeButton onClick={loop.handleLoopCurrentPhrase}>
              <RepeatIcon className="size-5" />
              Phrase
            </PracticeButton>
            <PracticeButton onClick={loop.handleSetLoopStart}>
              <FlagIcon className="size-5" />
              Start {shortcutHint(keybindings, "loopStart")}
            </PracticeButton>
            <PracticeButton onClick={loop.handleSetLoopEnd}>
              <FlagIcon className="size-5" />
              End {shortcutHint(keybindings, "loopEnd")}
            </PracticeButton>
            <PracticeButton onClick={loop.handleRetryLoop} disabled={!loop.activeLoop}>
              <RotateCcwIcon className="size-5" />
              Retry {shortcutHint(keybindings, "loopRetry")}
            </PracticeButton>
            <PracticeButton onClick={loop.handleClearLoop} disabled={!canClear}>
              <XIcon className="size-5" />
              Clear {shortcutHint(keybindings, "loopClear")}
            </PracticeButton>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 text-white/80">
            <div className="flex min-h-10 items-center gap-2 rounded-sm border border-white/15 bg-black/45 px-3 text-base">
              <TimerIcon className="size-5" />
              Count-in
            </div>
            <CountInButton value={0} current={loop.countInSec} onClick={loop.handleSetCountInSec} />
            <CountInButton value={1} current={loop.countInSec} onClick={loop.handleSetCountInSec} />
            <CountInButton value={2} current={loop.countInSec} onClick={loop.handleSetCountInSec} />
            <p className="min-h-10 rounded-sm border border-white/15 bg-black/45 px-3 pt-2 text-base text-white/70">
              {loopSummary(loop)}
            </p>
          </div>
        </div>
      </div>

      <div
        ref={lane.ref}
        className="mt-6 min-h-0 flex-1 overflow-hidden rounded-sm border border-white/18 bg-black/50 shadow-2xl shadow-black/40"
      >
        <canvas ref={canvasRef} className="block" />
      </div>

      <div className="mt-5 shrink-0">
        <p className="line-clamp-2 text-center text-5xl leading-tight font-semibold text-white drop-shadow">
          {phrase}
        </p>
        {nextPhrase && (
          <p className="mt-2 line-clamp-2 text-center text-3xl leading-tight font-semibold text-gray-400/80 drop-shadow">
            {nextPhrase}
          </p>
        )}
        <div className="mt-3 flex justify-center gap-6 text-lg text-white/60">
          <SourceLabel source={model.expectedSource} />
          <span>{micStatus}</span>
          {model.expectedSource === "chart" && model.pitchCalibration.midiOffset != null && (
            <span>Pitch lock: guide vocal</span>
          )}
          {model.expectedSource === "chart" && model.pitchCalibration.midiOffset == null && (
            <span>Chart pitch is relative until guide-vocal pitch lock is available</span>
          )}
        </div>
      </div>

      {debugEnabled && (
        <div className="pointer-events-auto absolute bottom-28 left-8 z-20 max-w-xl rounded-sm border border-white/18 bg-black/82 p-3 font-mono text-xs leading-relaxed text-white/75">
          <div>time {formatPlaybackTime(currentTime)}</div>
          <div>
            scale {model.vertical.source} min {model.vertical.min.toFixed(2)} max{" "}
            {model.vertical.max.toFixed(2)} center {model.vertical.center.toFixed(2)} range{" "}
            {model.vertical.range.toFixed(2)} manual={String(model.vertical.manualRange)}
          </div>
          <div>
            raw trace total {model.rawLiveVoiceTrace.length} visible {visibleLiveTracePoints}{" "}
            silence {silenceTracePointsInWindow} scored visible {scoredTracePointsInWindow}
          </div>
          <div>
            raw live{" "}
            {model.latestLiveVoicePoint
              ? formatPlaybackTime(model.latestLiveVoicePoint.time)
              : "--"}{" "}
            /{" "}
            {model.latestLiveVoicePoint
              ? `${model.latestLiveVoicePoint.rawHz == null ? "--" : `${Math.round(model.latestLiveVoicePoint.rawHz)}Hz`} / ${
                  model.latestLiveVoicePoint.rawMidi == null
                    ? "--"
                    : model.latestLiveVoicePoint.rawMidi.toFixed(2)
                } raw / ${model.latestLiveVoicePoint.displayMidi.toFixed(2)} display st / ${
                  model.latestLiveVoicePoint.kind
                }`
              : "--"}
          </div>
          <div>
            latest voiced raw{" "}
            {latestVoicedPoint?.rawMidi == null ? "--" : latestVoicedPoint.rawMidi.toFixed(2)}{" "}
            display {latestVoicedPoint == null ? "--" : latestVoicedPoint.displayMidi.toFixed(2)}{" "}
            chart{" "}
            {latestVoicedPoint?.expectedChartPitch == null
              ? "--"
              : latestVoicedPoint.expectedChartPitch.toFixed(2)}{" "}
            expected raw{" "}
            {latestVoicedPoint?.expectedMidi == null
              ? "--"
              : latestVoicedPoint.expectedMidi.toFixed(2)}{" "}
            cents{" "}
            {latestVoicedPoint?.centsFromExpected == null
              ? "--"
              : latestVoicedPoint.centsFromExpected}{" "}
            octave {latestVoicedPoint?.absoluteOctaveOffsetFromExpected ?? "--"}
          </div>
          <div>
            live offset{" "}
            {latestVoicedPoint?.micToChartOffset == null
              ? "--"
              : latestVoicedPoint.micToChartOffset.toFixed(2)}{" "}
            samples {latestVoicedPoint?.micToChartOffsetSampleCount ?? "--"} locked=
            {String(latestVoicedPoint?.micToChartOffsetLocked ?? false)} scored=
            {String(latestVoicedPoint?.scored ?? false)}
          </div>
          <div>
            note{" "}
            {model.currentExpectedNote
              ? `${formatPlaybackTime(model.currentExpectedNote.start)}-${formatPlaybackTime(
                  model.currentExpectedNote.end,
                )} / ${model.currentExpectedNote.pitch.toFixed(2)} st`
              : "--"}
          </div>
          <div>
            expected exists={String(model.currentExpectedNote != null)} scored comparison=
            {String(micDebug.comparisonAvailable)}
          </div>
          <div>
            raw cents{" "}
            {model.latestLiveCentsDifference == null ? "--" : model.latestLiveCentsDifference}
          </div>
          <div>
            scored display{" "}
            {model.latestChartRelativeVoicePoint
              ? `${model.latestChartRelativeVoicePoint.displayMidi.toFixed(2)} st`
              : "--"}{" "}
            expected{" "}
            {model.latestChartRelativeVoicePoint?.expectedMidi == null
              ? "--"
              : `${model.latestChartRelativeVoicePoint.expectedMidi.toFixed(2)} st`}
          </div>
          <div>
            scored octave abs{" "}
            {model.latestChartRelativeVoicePoint?.absoluteOctaveOffsetFromExpected ?? "--"} baseline{" "}
            {model.latestChartRelativeVoicePoint?.baselineOctaveOffset ?? "--"} relative{" "}
            {model.latestChartRelativeVoicePoint?.baselineRelativeOctaveOffset ?? "--"}
          </div>
          <div>
            pitch offset{" "}
            {model.pitchCalibration.midiOffset == null
              ? "--"
              : model.pitchCalibration.midiOffset.toFixed(2)}{" "}
            ({model.pitchCalibration.sampleCount})
          </div>
          <div>
            mic latency {settings.micLatencyMs}ms live offset {settings.liveTraceOffsetMs}ms
          </div>
          <div>
            mic active capture={String(micCaptureActive)} pitch={String(micPitchActive)}
          </div>
          <div>
            live stored display{" "}
            {micDebug.liveDisplayPitch == null ? "--" : micDebug.liveDisplayPitch.toFixed(2)} chart{" "}
            {micDebug.expectedChartPitch == null ? "--" : micDebug.expectedChartPitch.toFixed(2)}{" "}
            cents {micDebug.liveCentsFromExpected ?? "--"} register{" "}
            {micDebug.liveRegisterOffset ?? "--"} kind {micDebug.liveKind ?? "--"}
          </div>
          <div>
            live stored offset{" "}
            {micDebug.micToChartOffset == null ? "--" : micDebug.micToChartOffset.toFixed(2)}{" "}
            samples {micDebug.micToChartOffsetSampleCount} locked=
            {String(micDebug.micToChartOffsetLocked)}
          </div>
          <div>
            frame id {micDebug.frameId ?? "--"} age{" "}
            {micDebug.frameAgeMs == null ? "--" : `${Math.round(micDebug.frameAgeMs)}ms`}
          </div>
          <div>
            frame song time{" "}
            {micDebug.frameSongTime == null ? "--" : formatPlaybackTime(micDebug.frameSongTime)}
          </div>
          <div>
            raw{" "}
            {micDebug.rawHz == null
              ? "--"
              : `${Math.round(micDebug.rawHz)}Hz / ${micDebug.rawMidi?.toFixed(2) ?? "--"} st`}
          </div>
          <div>
            stable{" "}
            {micDebug.stabilizedHz == null
              ? "--"
              : `${Math.round(micDebug.stabilizedHz)}Hz / ${
                  micDebug.stabilizedMidi?.toFixed(2) ?? "--"
                } st`}
          </div>
          <div>
            clarity {micDebug.clarity == null ? "--" : micDebug.clarity.toFixed(2)} rms{" "}
            {micDebug.rms == null ? "--" : micDebug.rms.toFixed(4)}
          </div>
          <div>
            displayed={String(micDebug.displayed)} scored={String(micDebug.scored)} drop=
            {micDebug.dropReason ?? "--"}
          </div>
          <div>
            raw/scored differs=
            {String(
              model.latestLiveVoicePoint != null &&
                model.latestChartRelativeVoicePoint != null &&
                Math.abs(
                  model.latestLiveVoicePoint.displayMidi -
                    model.latestChartRelativeVoicePoint.displayMidi,
                ) > 0.01,
            )}
          </div>
          <div>
            voiced={String(micDebug.voiced)} reacquiring={String(micDebug.reacquiring)} comparison=
            {String(micDebug.comparisonAvailable)} break={String(micDebug.traceBreakInserted)}
          </div>
          <div>
            phrase {model.currentSegmentIndex}{" "}
            {model.currentSegment
              ? `${formatPlaybackTime(model.currentSegment.start)}-${formatPlaybackTime(
                  model.currentSegment.end,
                )}`
              : "--"}
          </div>
        </div>
      )}
    </div>
  );
}

export const PracticeOverlay = memo(PracticeOverlayImpl);

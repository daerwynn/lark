import {
  loadUsdxTimingInfo,
  previewUsdxCalibration,
  resetUsdxTimingOverride,
  saveUsdxTimingOverride,
} from "@/bridge/playback";
import {
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
} from "@/contexts/playback";
import { formatPlaybackTime } from "@/lib/playback/transport-controls";
import type { Segment } from "@/types/Transcript";
import type { UsdxCalibrationAnchor } from "@/types/UsdxCalibrationAnchor";
import type { UsdxCalibrationPreview } from "@/types/UsdxCalibrationPreview";
import type { UsdxTimingInfo } from "@/types/UsdxTimingInfo";
import { ChevronLeftIcon, ChevronRightIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

interface UsdxTimingPanelProps {
  fileHash: string;
  open: boolean;
  onClose: () => void;
  onSeekRelative?: (deltaSeconds: number) => void;
}

type AnchorSlot = "early" | "late";

const OFFSET_STEPS = [-1000, -100, -10, 10, 100, 1000];
const BPM_STEPS = [-1, -0.1, 0.1, 1];
const FINE_SEEK_STEPS = [-1, -0.1, 0.1, 1];

function formatPanelTime(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return formatPlaybackTime(value);
}

function formatSignedSeconds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(3)}s`;
}

function formatMs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${Math.round(value)}ms`;
}

function formatBpm(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return value.toFixed(3);
}

function formatFineSeekStep(value: number): string {
  const sign = value > 0 ? "+" : "-";
  return `${sign}${Math.abs(value) < 1 ? "100ms" : "1s"}`;
}

function activeSegmentIndex(segments: Segment[], time: number): number {
  if (segments.length === 0) return -1;
  const active = segments.findIndex((segment) => time >= segment.start && time <= segment.end);
  if (active >= 0) return active;
  const upcoming = segments.findIndex((segment) => time < segment.start);
  return upcoming >= 0 ? upcoming : segments.length - 1;
}

function firstUsdxBeat(segment: Segment | null): number | null {
  if (!segment) return null;
  const word = segment.words.find((candidate) => Number.isFinite(candidate.beat));
  return word?.beat ?? null;
}

function parseFinite(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timingInputFromInfo(info: UsdxTimingInfo | null) {
  if (!info) return { offsetMs: "0", bpm: "" };
  return {
    offsetMs: String(Math.round(info.offset_ms)),
    bpm: String(Number(info.effective_bpm.toFixed(3))),
  };
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-sm border border-white/12 bg-white/6 px-3 py-2">
      <p className="text-xs tracking-[0.14em] text-white/45 uppercase">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function StepButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="min-h-10 rounded-sm border border-white/18 bg-white/10 px-3 text-base font-semibold text-white transition-colors hover:bg-white/18"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="min-h-11 rounded-sm border border-white/22 bg-white px-4 text-base font-semibold text-black transition-colors hover:bg-white/86 disabled:pointer-events-none disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function UsdxTimingPanel({ fileHash, open, onClose, onSeekRelative }: UsdxTimingPanelProps) {
  const { segments } = usePlaybackTranscriptState();
  const { reloadTranscript } = usePlaybackTranscriptActions();
  const { getCurrentTime, subscribe } = usePlaybackTransportActions();
  const [info, setInfo] = useState<UsdxTimingInfo | null>(null);
  const [offsetMs, setOffsetMs] = useState("0");
  const [bpm, setBpm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => getCurrentTime());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [earlyAnchor, setEarlyAnchor] = useState<UsdxCalibrationAnchor | null>(null);
  const [lateAnchor, setLateAnchor] = useState<UsdxCalibrationAnchor | null>(null);
  const [preview, setPreview] = useState<UsdxCalibrationPreview | null>(null);

  useEffect(() => {
    if (!open) return;
    setCurrentTime(getCurrentTime());
    return subscribe(setCurrentTime);
  }, [getCurrentTime, open, subscribe]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(Math.max(0, activeSegmentIndex(segments, getCurrentTime())));
  }, [getCurrentTime, open, segments]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMessage(null);
    loadUsdxTimingInfo(fileHash)
      .then((next) => {
        if (cancelled) return;
        const inputs = timingInputFromInfo(next);
        setInfo(next);
        setOffsetMs(inputs.offsetMs);
        setBpm(inputs.bpm);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [fileHash, open]);

  const selectedSegment = segments[selectedIndex] ?? null;
  const selectedBeat = firstUsdxBeat(selectedSegment);
  const canUseAnchors = earlyAnchor != null && lateAnchor != null;
  const effectiveGap = useMemo(() => {
    if (!info) return null;
    const offset = parseFinite(offsetMs);
    return offset == null ? null : info.parsed_gap_ms + offset;
  }, [info, offsetMs]);
  const effectiveBpm = parseFinite(bpm);
  const canApplyManual = effectiveGap != null && effectiveBpm != null && effectiveBpm > 0;

  const setInfoAndInputs = useCallback((next: UsdxTimingInfo) => {
    const inputs = timingInputFromInfo(next);
    setInfo(next);
    setOffsetMs(inputs.offsetMs);
    setBpm(inputs.bpm);
  }, []);

  const adjustOffset = useCallback((delta: number) => {
    setOffsetMs((prev) => String(Math.round((parseFinite(prev) ?? 0) + delta)));
    setPreview(null);
  }, []);

  const adjustBpm = useCallback(
    (delta: number) => {
      setBpm((prev) => {
        const current = parseFinite(prev) ?? info?.effective_bpm ?? 0;
        return String(Number(Math.max(0.001, current + delta).toFixed(3)));
      });
      setPreview(null);
    },
    [info?.effective_bpm],
  );

  const applyOverride = useCallback(
    async (overrideGapMs: number, overrideBpm: number) => {
      setBusy(true);
      setMessage(null);
      try {
        const next = await saveUsdxTimingOverride(fileHash, {
          gap_ms: overrideGapMs,
          bpm: overrideBpm,
        });
        setInfoAndInputs(next);
        await reloadTranscript();
        setPreview(null);
        setMessage("Applied USDX timing override.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [fileHash, reloadTranscript, setInfoAndInputs],
  );

  const handleApplyManual = useCallback(() => {
    if (effectiveGap == null || effectiveBpm == null) return;
    void applyOverride(effectiveGap, effectiveBpm);
  }, [applyOverride, effectiveBpm, effectiveGap]);

  const handleReset = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await resetUsdxTimingOverride(fileHash);
      setInfoAndInputs(next);
      await reloadTranscript();
      setEarlyAnchor(null);
      setLateAnchor(null);
      setPreview(null);
      setMessage("Reset to original TXT timing.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [fileHash, reloadTranscript, setInfoAndInputs]);

  const handleSelectActive = useCallback(() => {
    setSelectedIndex(Math.max(0, activeSegmentIndex(segments, getCurrentTime())));
  }, [getCurrentTime, segments]);

  const moveSelected = useCallback(
    (delta: number) => {
      setSelectedIndex((prev) => Math.max(0, Math.min(segments.length - 1, prev + delta)));
    },
    [segments.length],
  );

  const markAnchor = useCallback(
    (slot: AnchorSlot) => {
      if (selectedBeat == null) {
        setMessage("Selected lyric has no USDX beat metadata.");
        return;
      }
      const anchor = {
        beat: selectedBeat,
        audio_time_secs: getCurrentTime(),
      };
      if (slot === "early") {
        setEarlyAnchor(anchor);
      } else {
        setLateAnchor(anchor);
      }
      setPreview(null);
      setMessage(`${slot === "early" ? "Early" : "Late"} anchor marked.`);
    },
    [getCurrentTime, selectedBeat],
  );

  const handlePreview = useCallback(async () => {
    if (!earlyAnchor || !lateAnchor) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await previewUsdxCalibration(fileHash, earlyAnchor, lateAnchor);
      setPreview(next);
      setMessage("Preview ready. Apply it to update playback timing.");
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [earlyAnchor, fileHash, lateAnchor]);

  const handleApplyPreview = useCallback(() => {
    if (!preview) return;
    void applyOverride(preview.timing_override.gap_ms, preview.timing_override.bpm);
  }, [applyOverride, preview]);

  if (!open) return null;

  return (
    <div className="pointer-events-auto absolute inset-y-20 right-5 z-40 flex w-[min(38rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-sm border border-white/18 bg-black/90 text-white shadow-2xl shadow-black/60">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/12 px-5 py-4">
        <div>
          <p className="text-sm tracking-[0.18em] text-white/50 uppercase">UltraStar Timing</p>
          <h2 className="mt-1 text-3xl font-semibold">Chart Calibration</h2>
        </div>
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-sm border border-white/18 bg-white/10 transition-colors hover:bg-white/18"
          aria-label="Close USDX timing panel"
          onClick={onClose}
        >
          <XIcon className="size-6" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {info && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="TXT" value={info.txt_file_name} />
            <Field label="Audio" value={info.audio_file_name} />
            <Field label="Parsed BPM" value={formatBpm(info.parsed_bpm)} />
            <Field label="Parsed GAP" value={formatMs(info.parsed_gap_ms)} />
            <Field label="Audio Duration" value={formatPanelTime(info.audio_duration_secs)} />
            <Field label="First Note" value={formatPanelTime(info.first_note_time_secs)} />
            <Field label="Last Note End" value={formatPanelTime(info.last_note_end_secs)} />
            <Field label="Mismatch" value={formatSignedSeconds(info.chart_audio_mismatch_secs)} />
          </div>
        )}

        <div className="rounded-sm border border-white/12 bg-white/6 px-4 py-3 text-base leading-relaxed text-white/76">
          Offset/GAP moves the entire chart earlier or later. BPM/time-scale stretches or compresses
          the chart. Use offset when the whole song is equally early or late; use BPM/time-scale
          when the chart drifts over time.
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl font-semibold">Offset / GAP</h3>
            <p className="text-base text-white/55">Effective GAP {formatMs(effectiveGap)}</p>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {OFFSET_STEPS.map((step) => (
              <StepButton
                key={step}
                label={`${step > 0 ? "+" : ""}${step}`}
                onClick={() => adjustOffset(step)}
              />
            ))}
          </div>
          <label className="block">
            <span className="text-sm tracking-[0.14em] text-white/48 uppercase">Offset ms</span>
            <input
              className="mt-1 h-12 w-full rounded-sm border border-white/18 bg-black/50 px-3 text-xl font-semibold text-white outline-none focus:border-white/60"
              inputMode="numeric"
              value={offsetMs}
              onChange={(event) => {
                setOffsetMs(event.target.value);
                setPreview(null);
              }}
            />
          </label>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl font-semibold">BPM / Time-Scale</h3>
            <p className="text-base text-white/55">Original {formatBpm(info?.parsed_bpm)}</p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {BPM_STEPS.map((step) => (
              <StepButton
                key={step}
                label={`${step > 0 ? "+" : ""}${step}`}
                onClick={() => adjustBpm(step)}
              />
            ))}
          </div>
          <label className="block">
            <span className="text-sm tracking-[0.14em] text-white/48 uppercase">BPM</span>
            <input
              className="mt-1 h-12 w-full rounded-sm border border-white/18 bg-black/50 px-3 text-xl font-semibold text-white outline-none focus:border-white/60"
              inputMode="decimal"
              value={bpm}
              onChange={(event) => {
                setBpm(event.target.value);
                setPreview(null);
              }}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <ActionButton disabled={busy || !canApplyManual} onClick={handleApplyManual}>
              Apply Timing
            </ActionButton>
            <button
              type="button"
              className="flex min-h-11 items-center gap-2 rounded-sm border border-white/18 bg-white/10 px-4 text-base font-semibold text-white transition-colors hover:bg-white/18 disabled:pointer-events-none disabled:opacity-45"
              disabled={busy || !info?.has_override}
              onClick={() => void handleReset()}
            >
              <RotateCcwIcon className="size-5" />
              Reset TXT
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-xl font-semibold">Two-Anchor Calibration</h3>
          <div className="rounded-sm border border-white/12 bg-white/6 p-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="flex size-10 items-center justify-center rounded-sm border border-white/18 bg-white/10 transition-colors hover:bg-white/18 disabled:opacity-40"
                disabled={selectedIndex <= 0}
                aria-label="Previous lyric"
                onClick={() => moveSelected(-1)}
              >
                <ChevronLeftIcon className="size-6" />
              </button>
              <div className="min-w-0 flex-1 text-center">
                <p className="text-sm text-white/50">
                  Lyric {segments.length === 0 ? 0 : selectedIndex + 1} / {segments.length}
                </p>
                <p className="truncate text-2xl font-semibold">
                  {selectedSegment?.text.trim() || "No lyric selected"}
                </p>
                <p className="text-base text-white/55">
                  Beat {selectedBeat == null ? "--" : selectedBeat.toFixed(0)} • Phrase{" "}
                  {formatPanelTime(selectedSegment?.start)} to{" "}
                  {formatPanelTime(selectedSegment?.end)}
                </p>
              </div>
              <button
                type="button"
                className="flex size-10 items-center justify-center rounded-sm border border-white/18 bg-white/10 transition-colors hover:bg-white/18 disabled:opacity-40"
                disabled={selectedIndex >= segments.length - 1}
                aria-label="Next lyric"
                onClick={() => moveSelected(1)}
              >
                <ChevronRightIcon className="size-6" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <StepButton label="Use Active Lyric" onClick={handleSelectActive} />
              <StepButton label="Mark Early Now" onClick={() => markAnchor("early")} />
              <StepButton label="Mark Late Now" onClick={() => markAnchor("late")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Early Anchor"
              value={
                earlyAnchor
                  ? `Beat ${earlyAnchor.beat.toFixed(0)} at ${formatPanelTime(
                      earlyAnchor.audio_time_secs,
                    )}`
                  : "--"
              }
            />
            <Field
              label="Late Anchor"
              value={
                lateAnchor
                  ? `Beat ${lateAnchor.beat.toFixed(0)} at ${formatPanelTime(
                      lateAnchor.audio_time_secs,
                    )}`
                  : "--"
              }
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionButton disabled={busy || !canUseAnchors} onClick={() => void handlePreview()}>
              Preview Anchors
            </ActionButton>
            <ActionButton disabled={busy || !preview} onClick={handleApplyPreview}>
              Apply Preview
            </ActionButton>
          </div>

          {preview && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Preview Offset" value={formatMs(preview.offset_ms)} />
              <Field label="Preview BPM" value={formatBpm(preview.timing_override.bpm)} />
              <Field
                label="Preview First Note"
                value={formatPanelTime(preview.first_note_time_secs)}
              />
              <Field
                label="Preview Mismatch"
                value={formatSignedSeconds(preview.chart_audio_mismatch_secs)}
              />
            </div>
          )}
        </section>

        <div className="rounded-sm border border-white/12 bg-white/6 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-base text-white/65">
              Current audio time:{" "}
              <span className="font-semibold">{formatPanelTime(currentTime)}</span>
            </p>
            {onSeekRelative && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm tracking-[0.14em] text-white/48 uppercase">Fine seek</span>
                {FINE_SEEK_STEPS.map((step) => (
                  <StepButton
                    key={step}
                    label={formatFineSeekStep(step)}
                    onClick={() => onSeekRelative(step)}
                  />
                ))}
              </div>
            )}
          </div>
          {info && (
            <p className="mt-1 break-all text-sm text-white/45">TXT path: {info.txt_path}</p>
          )}
          {message && <p className="mt-2 text-base font-semibold text-white">{message}</p>}
        </div>
      </div>
    </div>
  );
}

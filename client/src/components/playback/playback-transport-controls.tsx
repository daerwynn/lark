import { usePlaybackTransportActions, usePlaybackTransportState } from "@/contexts/playback";
import { shortcutHint, type PlaybackShortcutBindings } from "@/lib/playback/keybindings";
import { formatPlaybackRate, stepPlaybackRate } from "@/lib/playback/playback-rate";
import { clampPlaybackTime, formatPlaybackTime } from "@/lib/playback/transport-controls";
import type { PracticeLoopRange } from "@/lib/practice/practice-loop";
import {
  FastForwardIcon,
  GaugeIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RewindIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

interface PlaybackTransportControlsProps {
  activeLoop: PracticeLoopRange | null;
  onSeekRequested: (time: number) => void;
  onSkipRequested: (deltaSeconds: number) => void;
  onStopRequested: () => void;
  onRestartRequested: () => void;
  playbackRate: number;
  pitchPreservingPlaybackSupported: boolean;
  onPlaybackRateRequested: (rate: number) => void;
  keybindings: PlaybackShortcutBindings;
  compact?: boolean;
}

interface TransportButtonProps {
  children: ReactNode;
  label: string;
  onClick: () => void;
  emphasis?: boolean;
  compact?: boolean;
}

function TransportButton({
  children,
  label,
  onClick,
  emphasis = false,
  compact = false,
}: TransportButtonProps) {
  return (
    <button
      type="button"
      className={`flex items-center gap-2 rounded-sm border font-semibold text-white transition-colors ${
        compact ? "min-h-10 px-2.5 text-sm" : "min-h-14 px-4 text-lg"
      } ${
        emphasis
          ? "border-white/35 bg-white/20 hover:bg-white/30"
          : "border-white/18 bg-white/10 hover:bg-white/18"
      }`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function PlaybackTransportControls({
  activeLoop,
  onSeekRequested,
  onSkipRequested,
  onStopRequested,
  onRestartRequested,
  playbackRate,
  pitchPreservingPlaybackSupported,
  onPlaybackRateRequested,
  keybindings,
  compact = false,
}: PlaybackTransportControlsProps) {
  const { duration, isPlaying } = usePlaybackTransportState();
  const { getCurrentTime, subscribe, togglePlayback } = usePlaybackTransportActions();
  const [currentTime, setCurrentTime] = useState(() => getCurrentTime());
  const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);

  useEffect(() => {
    setCurrentTime(getCurrentTime());
    return subscribe(setCurrentTime);
  }, [getCurrentTime, subscribe]);

  const sliderMax = safeDuration > 0 ? safeDuration : 1;
  const displayTime = clampPlaybackTime(currentTime, safeDuration);
  const sliderValue = safeDuration > 0 ? displayTime : 0;

  return (
    <div
      className={`pointer-events-auto absolute inset-x-4 bottom-4 z-30 rounded-sm border border-white/16 bg-black/82 text-white shadow-2xl shadow-black/60 backdrop-blur ${
        compact ? "px-3 py-2" : "px-4 py-3"
      }`}
      data-nav-passthrough
    >
      <div className={`flex flex-col lg:flex-row lg:items-center ${compact ? "gap-2" : "gap-3"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <TransportButton
            label={isPlaying ? "Pause" : "Play"}
            onClick={togglePlayback}
            emphasis
            compact={compact}
          >
            {isPlaying ? (
              <PauseIcon className={compact ? "size-5" : "size-7"} />
            ) : (
              <PlayIcon className={compact ? "size-5" : "size-7"} />
            )}
            <span>
              {isPlaying ? "Pause" : "Play"} {shortcutHint(keybindings, "playPause")}
            </span>
          </TransportButton>

          <TransportButton label="Stop" onClick={onStopRequested} compact={compact}>
            <SquareIcon className={compact ? "size-5" : "size-6"} />
            <span>Stop</span>
          </TransportButton>

          <TransportButton label="Restart" onClick={onRestartRequested} compact={compact}>
            <RotateCcwIcon className={compact ? "size-5" : "size-6"} />
            <span>Start {shortcutHint(keybindings, "restart")}</span>
          </TransportButton>

          <TransportButton
            label="Back 5 seconds"
            onClick={() => onSkipRequested(-5)}
            compact={compact}
          >
            <RewindIcon className={compact ? "size-5" : "size-6"} />
            <span>5s {shortcutHint(keybindings, "skipBack5")}</span>
          </TransportButton>

          <TransportButton
            label="Forward 5 seconds"
            onClick={() => onSkipRequested(5)}
            compact={compact}
          >
            <span>5s {shortcutHint(keybindings, "skipForward5")}</span>
            <FastForwardIcon className={compact ? "size-5" : "size-6"} />
          </TransportButton>

          <div
            className={`flex items-center gap-2 rounded-sm border border-white/18 bg-white/10 text-white ${
              compact ? "min-h-10 px-2" : "min-h-14 px-3"
            }`}
          >
            <GaugeIcon className={compact ? "size-5" : "size-6"} />
            <button
              type="button"
              className={`flex items-center justify-center rounded-sm border border-white/18 bg-black/20 transition-colors hover:bg-white/18 disabled:opacity-35 ${
                compact ? "size-7" : "size-9"
              }`}
              disabled={!pitchPreservingPlaybackSupported}
              aria-label="Slow down playback"
              onClick={() => onPlaybackRateRequested(stepPlaybackRate(playbackRate, -1))}
            >
              <MinusIcon className={compact ? "size-4" : "size-5"} />
            </button>
            <button
              type="button"
              className={`rounded-sm border border-white/18 bg-black/20 font-semibold tabular-nums transition-colors hover:bg-white/18 disabled:opacity-35 ${
                compact ? "min-w-20 px-2 py-1 text-sm" : "min-w-24 px-3 py-2 text-lg"
              }`}
              disabled={!pitchPreservingPlaybackSupported}
              aria-label="Reset playback speed"
              onClick={() => onPlaybackRateRequested(1)}
            >
              {pitchPreservingPlaybackSupported ? formatPlaybackRate(playbackRate) : "1.00x"}
            </button>
            <button
              type="button"
              className={`flex items-center justify-center rounded-sm border border-white/18 bg-black/20 transition-colors hover:bg-white/18 disabled:opacity-35 ${
                compact ? "size-7" : "size-9"
              }`}
              disabled={!pitchPreservingPlaybackSupported}
              aria-label="Speed up playback"
              onClick={() => onPlaybackRateRequested(stepPlaybackRate(playbackRate, 1))}
            >
              <PlusIcon className={compact ? "size-4" : "size-5"} />
            </button>
            <span className="text-xs leading-tight text-white/55">
              {shortcutHint(keybindings, "speedDown")} {shortcutHint(keybindings, "speedReset")}{" "}
              {shortcutHint(keybindings, "speedUp")}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <p
            className={`text-right font-semibold tabular-nums text-white ${
              compact ? "w-24 text-base" : "w-28 text-xl"
            }`}
          >
            {formatPlaybackTime(displayTime)}
          </p>
          <input
            type="range"
            className="h-8 min-w-0 flex-1 cursor-pointer accent-white disabled:cursor-not-allowed disabled:opacity-45"
            min={0}
            max={sliderMax}
            step={0.001}
            value={sliderValue}
            disabled={safeDuration <= 0}
            aria-label="Song position"
            aria-valuetext={`${formatPlaybackTime(displayTime)} of ${formatPlaybackTime(
              safeDuration,
            )}`}
            onChange={(event) => onSeekRequested(Number(event.currentTarget.value))}
          />
          <p
            className={`font-semibold tabular-nums text-white/72 ${
              compact ? "w-24 text-base" : "w-28 text-xl"
            }`}
          >
            {formatPlaybackTime(safeDuration)}
          </p>
        </div>

        {activeLoop && (
          <p className="shrink-0 rounded-sm border border-white/16 bg-white/10 px-3 py-2 text-base font-semibold text-white/78">
            Loop {formatPlaybackTime(activeLoop.start)}-{formatPlaybackTime(activeLoop.end)}
          </p>
        )}
      </div>
    </div>
  );
}

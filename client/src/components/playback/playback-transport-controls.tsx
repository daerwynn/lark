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
}

interface TransportButtonProps {
  children: ReactNode;
  label: string;
  onClick: () => void;
  emphasis?: boolean;
}

function TransportButton({ children, label, onClick, emphasis = false }: TransportButtonProps) {
  return (
    <button
      type="button"
      className={`flex min-h-14 items-center gap-2 rounded-sm border px-4 text-lg font-semibold text-white transition-colors ${
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
      className="pointer-events-auto absolute inset-x-4 bottom-4 z-30 rounded-sm border border-white/16 bg-black/82 px-4 py-3 text-white shadow-2xl shadow-black/60 backdrop-blur"
      data-nav-passthrough
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <TransportButton label={isPlaying ? "Pause" : "Play"} onClick={togglePlayback} emphasis>
            {isPlaying ? <PauseIcon className="size-7" /> : <PlayIcon className="size-7" />}
            <span>
              {isPlaying ? "Pause" : "Play"} {shortcutHint(keybindings, "playPause")}
            </span>
          </TransportButton>

          <TransportButton label="Stop" onClick={onStopRequested}>
            <SquareIcon className="size-6" />
            <span>Stop</span>
          </TransportButton>

          <TransportButton label="Restart" onClick={onRestartRequested}>
            <RotateCcwIcon className="size-6" />
            <span>Start {shortcutHint(keybindings, "restart")}</span>
          </TransportButton>

          <TransportButton label="Back 5 seconds" onClick={() => onSkipRequested(-5)}>
            <RewindIcon className="size-6" />
            <span>5s {shortcutHint(keybindings, "skipBack5")}</span>
          </TransportButton>

          <TransportButton label="Forward 5 seconds" onClick={() => onSkipRequested(5)}>
            <span>5s {shortcutHint(keybindings, "skipForward5")}</span>
            <FastForwardIcon className="size-6" />
          </TransportButton>

          <div className="flex min-h-14 items-center gap-2 rounded-sm border border-white/18 bg-white/10 px-3 text-white">
            <GaugeIcon className="size-6" />
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-sm border border-white/18 bg-black/20 transition-colors hover:bg-white/18 disabled:opacity-35"
              disabled={!pitchPreservingPlaybackSupported}
              aria-label="Slow down playback"
              onClick={() => onPlaybackRateRequested(stepPlaybackRate(playbackRate, -1))}
            >
              <MinusIcon className="size-5" />
            </button>
            <button
              type="button"
              className="min-w-24 rounded-sm border border-white/18 bg-black/20 px-3 py-2 text-lg font-semibold tabular-nums transition-colors hover:bg-white/18 disabled:opacity-35"
              disabled={!pitchPreservingPlaybackSupported}
              aria-label="Reset playback speed"
              onClick={() => onPlaybackRateRequested(1)}
            >
              {pitchPreservingPlaybackSupported ? formatPlaybackRate(playbackRate) : "1.00x"}
            </button>
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-sm border border-white/18 bg-black/20 transition-colors hover:bg-white/18 disabled:opacity-35"
              disabled={!pitchPreservingPlaybackSupported}
              aria-label="Speed up playback"
              onClick={() => onPlaybackRateRequested(stepPlaybackRate(playbackRate, 1))}
            >
              <PlusIcon className="size-5" />
            </button>
            <span className="text-xs leading-tight text-white/55">
              {shortcutHint(keybindings, "speedDown")} {shortcutHint(keybindings, "speedReset")}{" "}
              {shortcutHint(keybindings, "speedUp")}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <p className="w-28 text-right text-xl font-semibold tabular-nums text-white">
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
          <p className="w-28 text-xl font-semibold tabular-nums text-white/72">
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

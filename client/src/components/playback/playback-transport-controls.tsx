import { usePlaybackTransportActions, usePlaybackTransportState } from "@/contexts/playback";
import { clampPlaybackTime, formatPlaybackTime } from "@/lib/playback/transport-controls";
import type { PracticeLoopRange } from "@/lib/practice/practice-loop";
import {
  FastForwardIcon,
  PauseIcon,
  PlayIcon,
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
            <span>{isPlaying ? "Pause" : "Play"}</span>
          </TransportButton>

          <TransportButton label="Stop" onClick={onStopRequested}>
            <SquareIcon className="size-6" />
            <span>Stop</span>
          </TransportButton>

          <TransportButton label="Restart" onClick={onRestartRequested}>
            <RotateCcwIcon className="size-6" />
            <span>Start</span>
          </TransportButton>

          <TransportButton label="Back 5 seconds" onClick={() => onSkipRequested(-5)}>
            <RewindIcon className="size-6" />
            <span>5s</span>
          </TransportButton>

          <TransportButton label="Forward 5 seconds" onClick={() => onSkipRequested(5)}>
            <span>5s</span>
            <FastForwardIcon className="size-6" />
          </TransportButton>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <p className="w-16 text-right text-xl font-semibold tabular-nums text-white">
            {formatPlaybackTime(displayTime)}
          </p>
          <input
            type="range"
            className="h-8 min-w-0 flex-1 cursor-pointer accent-white disabled:cursor-not-allowed disabled:opacity-45"
            min={0}
            max={sliderMax}
            step={0.1}
            value={sliderValue}
            disabled={safeDuration <= 0}
            aria-label="Song position"
            aria-valuetext={`${formatPlaybackTime(displayTime)} of ${formatPlaybackTime(
              safeDuration,
            )}`}
            onChange={(event) => onSeekRequested(Number(event.currentTarget.value))}
          />
          <p className="w-16 text-xl font-semibold tabular-nums text-white/72">
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

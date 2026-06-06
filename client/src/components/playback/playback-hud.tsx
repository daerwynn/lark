import {
  usePlaybackMicState,
  usePlaybackThemeState,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from "@/contexts/playback";
import {
  shortcutHint,
  shortcutListHint,
  type PlaybackShortcutBindings,
} from "@/lib/playback/keybindings";
import type { PracticeHudSummary } from "@/components/playback/practice-overlay";
import { formatPlaybackVolume } from "@/lib/playback/playback-volume";
import { formatPlaybackTime } from "@/lib/playback/transport-controls";
import type { VideoFlavor } from "@/lib/playback/video-flavor";
import { CogIcon } from "lucide-react";
import { forwardRef, memo, useEffect, useRef } from "react";
import { isPixabayTheme, themeName } from "./background";

function formatGuideText(volume: number, keybindings: PlaybackShortcutBindings): string {
  const pct = Math.round(volume * 100);
  const hint = shortcutListHint(keybindings, ["guideToggle", "guideUp", "guideDown"]);
  return pct === 0 ? `Guide: OFF ${hint}` : `Guide: ${pct}% ${hint}`;
}

function formatThemeText(
  themeIndex: number,
  videoFlavor: VideoFlavor,
  keybindings: PlaybackShortcutBindings,
): string {
  const actions = isPixabayTheme(themeIndex)
    ? (["themeCycle", "videoFlavorCycle"] as const)
    : (["themeCycle"] as const);
  return `Theme: ${themeName(themeIndex, videoFlavor)} ${shortcutListHint(keybindings, [...actions])}`;
}

const SkipButton = forwardRef<HTMLButtonElement, { label: string; onClick: () => void }>(
  ({ label, onClick }, ref) => (
    <button
      ref={ref}
      onClick={onClick}
      className="pointer-events-auto flex gap-1 rounded-sm border-2 border-white/70 bg-black/10 px-2.5 py-1 text-sm text-white/90 transition-colors hover:bg-black/20"
      style={{ display: "none" }}
    >
      <span>{label}</span> <span>⏎</span>
    </button>
  ),
);

function HudChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border border-white/12 bg-white/10 px-2 py-0.5 text-[0.72rem] font-medium text-white/66">
      {children}
    </span>
  );
}

function HudButton({
  children,
  pressed,
  onClick,
}: {
  children: React.ReactNode;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-sm border px-2 py-0.5 text-[0.72rem] font-semibold transition-colors ${
        pressed
          ? "border-white/40 bg-white/20 text-white"
          : "border-white/18 bg-black/25 text-white/76 hover:bg-white/10"
      }`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const FOOTER_NOTE_CLASS = `pointer-events-none absolute bottom-2 z-20 text-[0.6rem] text-white/30`;

function Disclaimer({ source }: { source: string }) {
  if (source === "usdx") {
    return null;
  }

  const text =
    source === "lyrics"
      ? "Timing is AI-generated and may not be perfectly accurate"
      : "Lyrics and timing are AI-generated and may not be perfectly accurate";

  return (
    <p className={`${FOOTER_NOTE_CLASS} left-1/2 -translate-x-1/2 whitespace-nowrap text-center`}>
      {text}
    </p>
  );
}

interface PlaybackHudProps {
  title: string;
  artist: string;
  practiceMode: boolean;
  onTogglePracticeMode: () => void;
  usdxTimingAvailable?: boolean;
  usdxTimingOpen?: boolean;
  onToggleUsdxTiming?: () => void;
  settingsOpen?: boolean;
  onOpenSettings?: () => void;
  keybindings: PlaybackShortcutBindings;
  practiceSummary?: PracticeHudSummary | null;
}

function PlaybackHudImpl({
  title,
  artist,
  practiceMode,
  onTogglePracticeMode,
  usdxTimingAvailable = false,
  usdxTimingOpen = false,
  onToggleUsdxTiming,
  settingsOpen = false,
  onOpenSettings,
  keybindings,
  practiceSummary,
}: PlaybackHudProps) {
  const { duration, guideVolume, playbackVolume, paused } = usePlaybackTransportState();
  const { subscribe, getCurrentTime, handleContinue, handleExit } = usePlaybackTransportActions();
  const { themeIndex, videoFlavor } = usePlaybackThemeState();
  const { firstSegmentStart, lastSegmentEnd, introSkipLeadSec, transcriptSource } =
    usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { pitchScore, micUserEnabled, micName, micMonitorUserEnabled, monitorStatus } =
    usePlaybackMicState();

  const timerRef = useRef<HTMLParagraphElement>(null);
  const skipIntroRef = useRef<HTMLButtonElement>(null);
  const skipOutroRef = useRef<HTMLButtonElement>(null);

  const showPixabayCredit = isPixabayTheme(themeIndex);

  // Updates the timer text and skip-button visibility via direct DOM mutation
  // (rAF subscriber), matching the millisecond precision shown in the transport bar.
  useEffect(() => {
    if (timerRef.current) {
      timerRef.current.textContent = `${formatPlaybackTime(getCurrentTime())} / ${formatPlaybackTime(
        duration,
      )}`;
    }

    return subscribe((time) => {
      if (timerRef.current) {
        timerRef.current.textContent = `${formatPlaybackTime(time)} / ${formatPlaybackTime(
          duration,
        )}`;
      }

      if (skipIntroRef.current) {
        skipIntroRef.current.style.display =
          time < firstSegmentStart - introSkipLeadSec ? "" : "none";
      }
      if (skipOutroRef.current) {
        skipOutroRef.current.style.display = time > lastSegmentEnd + 1 ? "" : "none";
      }
    });
  }, [subscribe, getCurrentTime, duration, firstSegmentStart, introSkipLeadSec, lastSegmentEnd]);

  return (
    <>
      <div className="pointer-events-auto absolute inset-x-0 top-3 z-20 flex items-start justify-between gap-4 px-4">
        <div className="max-w-[min(62rem,calc(100vw-5rem))] overflow-hidden rounded-sm border border-white/14 bg-black/58 px-3 py-2 text-white shadow-xl shadow-black/35 backdrop-blur">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h1 className="max-w-[22rem] truncate text-base font-semibold text-white">{title}</h1>
            <p className="max-w-[18rem] truncate text-sm text-white/68">{artist}</p>
            <p ref={timerRef} className="text-sm tabular-nums text-white/68">
              0:00.000 / {formatPlaybackTime(duration)}
            </p>
            <p className="text-sm font-semibold tabular-nums text-white/84">
              {practiceSummary ? `Match: ${practiceSummary.match}` : `Score: ${pitchScore ?? "--"}`}
            </p>
            {practiceSummary && (
              <>
                <HudChip>{practiceSummary.status}</HudChip>
                <HudChip>Last loop: {practiceSummary.attempt}</HudChip>
              </>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <HudButton pressed={practiceMode} onClick={onTogglePracticeMode}>
              Practice {practiceMode ? "ON" : "OFF"} {shortcutHint(keybindings, "practiceMode")}
            </HudButton>
            {usdxTimingAvailable && (
              <HudButton pressed={usdxTimingOpen} onClick={onToggleUsdxTiming ?? (() => {})}>
                USDX Timing {usdxTimingOpen ? "ON" : "OFF"}{" "}
                {shortcutHint(keybindings, "usdxTiming")}
              </HudButton>
            )}
            <HudChip>{formatGuideText(guideVolume, keybindings)}</HudChip>
            <HudChip>
              Vol {formatPlaybackVolume(playbackVolume)}{" "}
              {shortcutListHint(keybindings, ["volumeUp", "volumeDown"])}
            </HudChip>
            <HudChip>
              Mic {micUserEnabled ? micName : "OFF"}{" "}
              {shortcutListHint(keybindings, ["micToggle", "micCycle"])}
            </HudChip>
            <HudChip>
              Monitor {micMonitorUserEnabled ? "ON" : "OFF"}{" "}
              {shortcutHint(keybindings, "micMonitorToggle")}
            </HudChip>
            {micMonitorUserEnabled && (
              <HudChip>
                Monitor{" "}
                {monitorStatus == null
                  ? "latency unknown"
                  : `${Math.round(monitorStatus.monitor_queue_latency_ms)}ms queue`}
              </HudChip>
            )}
            <HudChip>{formatThemeText(themeIndex, videoFlavor, keybindings)}</HudChip>
            <HudChip>{shortcutHint(keybindings, "pauseMenu")} Back</HudChip>
          </div>

          {practiceSummary && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <HudChip>{practiceSummary.expected}</HudChip>
              <HudChip>{practiceSummary.guideStatus}</HudChip>
              <HudChip>{practiceSummary.micStatus}</HudChip>
              <HudChip>{practiceSummary.loop}</HudChip>
              {practiceSummary.timingWarning && (
                <span className="rounded-sm border border-yellow-300/25 bg-yellow-300/10 px-2 py-0.5 text-[0.72rem] font-semibold text-yellow-200">
                  {practiceSummary.timingWarning}
                </span>
              )}
            </div>
          )}

          {practiceMode && paused && (
            <div className="mt-1 flex items-center gap-1.5">
              <HudButton pressed onClick={handleContinue}>
                Resume
              </HudButton>
              <button
                type="button"
                className="rounded-sm border border-red-300/28 bg-red-500/18 px-2 py-0.5 text-[0.72rem] font-semibold text-red-100 transition-colors hover:bg-red-500/28"
                onClick={handleExit}
              >
                Exit
              </button>
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <SkipButton ref={skipIntroRef} label="Skip Intro" onClick={handleSkipIntro} />
            <SkipButton ref={skipOutroRef} label="Skip Outro" onClick={handleSkipOutro} />
          </div>
        </div>

        {onOpenSettings && (
          <button
            type="button"
            className="pointer-events-auto flex size-10 items-center justify-center rounded-sm border border-white/30 bg-black/25 text-white/90 transition-colors hover:bg-white/10"
            aria-label="Open playback settings"
            aria-pressed={settingsOpen}
            onClick={onOpenSettings}
          >
            <CogIcon className="size-6" />
          </button>
        )}
      </div>

      {showPixabayCredit && <p className={`${FOOTER_NOTE_CLASS} right-4`}>Videos by Pixabay</p>}

      <Disclaimer source={transcriptSource} />
    </>
  );
}

export const PlaybackHud = memo(PlaybackHudImpl);

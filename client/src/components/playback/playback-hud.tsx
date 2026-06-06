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

function HintText({ children, fontSize = "sm" }: { children: React.ReactNode; fontSize?: string }) {
  return <p className={`text-${fontSize} text-white/50`}>{children}</p>;
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
}: PlaybackHudProps) {
  const { duration, guideVolume, playbackVolume } = usePlaybackTransportState();
  const { subscribe, getCurrentTime } = usePlaybackTransportActions();
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
      <div className="pointer-events-auto absolute inset-x-0 top-3 z-20 flex justify-between px-4">
        <div className="max-w-[40%] overflow-hidden">
          <h1 className="truncate text-[1.375rem] text-white">{title}</h1>
          <p className="truncate text-base text-white/70">{artist}</p>
          <p ref={timerRef} className="text-base text-white/70">
            0:00.000 / {formatPlaybackTime(duration)}
          </p>
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

      <div className="pointer-events-auto absolute bottom-[8.5rem] left-4 z-20 flex max-w-[min(32rem,calc(100vw-2rem))] flex-col items-start rounded-sm border border-white/15 bg-black/72 px-3 py-2 text-left shadow-2xl shadow-black/45 backdrop-blur">
        <div className={`text-lg text-white${pitchScore ? "" : "/50"}`}>
          Score: {pitchScore ?? "--"}
        </div>
        <button
          type="button"
          className="mt-1 rounded-sm border border-white/30 bg-black/25 px-2.5 py-1 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
          aria-pressed={practiceMode}
          onClick={onTogglePracticeMode}
        >
          Practice: {practiceMode ? "ON" : "OFF"} {shortcutHint(keybindings, "practiceMode")}
        </button>
        {usdxTimingAvailable && (
          <button
            type="button"
            className="mt-1 rounded-sm border border-white/30 bg-black/25 px-2.5 py-1 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
            aria-pressed={usdxTimingOpen}
            onClick={onToggleUsdxTiming}
          >
            USDX Timing: {usdxTimingOpen ? "ON" : "OFF"} {shortcutHint(keybindings, "usdxTiming")}
          </button>
        )}
        <HintText>{formatGuideText(guideVolume, keybindings)}</HintText>
        <HintText>
          Volume: {formatPlaybackVolume(playbackVolume)}{" "}
          {shortcutListHint(keybindings, ["volumeUp", "volumeDown"])}
        </HintText>
        <HintText>
          Mic: {micUserEnabled ? micName : "OFF"}{" "}
          {shortcutListHint(keybindings, ["micToggle", "micCycle"])}
        </HintText>
        <HintText>
          Monitor: {micMonitorUserEnabled ? "ON" : "OFF"}{" "}
          {shortcutHint(keybindings, "micMonitorToggle")}
        </HintText>
        {micMonitorUserEnabled && (
          <HintText>
            Monitor latency:{" "}
            {monitorStatus == null
              ? "unknown"
              : `${Math.round(monitorStatus.monitor_queue_latency_ms)}ms queue`}
          </HintText>
        )}
        {micMonitorUserEnabled && (
          <HintText>
            Mic monitor may have audible latency depending on hardware/buffers. This is separate
            from USDX timing.
          </HintText>
        )}
        <HintText>{formatThemeText(themeIndex, videoFlavor, keybindings)}</HintText>
        <HintText>{shortcutHint(keybindings, "pauseMenu")} Back</HintText>
      </div>

      {showPixabayCredit && <p className={`${FOOTER_NOTE_CLASS} right-4`}>Videos by Pixabay</p>}

      <Disclaimer source={transcriptSource} />
    </>
  );
}

export const PlaybackHud = memo(PlaybackHudImpl);

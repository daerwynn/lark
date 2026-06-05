import {
  usePlaybackMicState,
  usePlaybackThemeState,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from "@/contexts/playback";
import { formatPlaybackTime } from "@/lib/playback/transport-controls";
import type { VideoFlavor } from "@/lib/playback/video-flavor";
import { CogIcon } from "lucide-react";
import { forwardRef, memo, useEffect, useRef } from "react";
import { isPixabayTheme, themeName } from "./background";

function formatGuideText(volume: number): string {
  const pct = Math.round(volume * 100);
  return pct === 0 ? "Guide: OFF" : `Guide: ${pct}% [G +/-]`;
}

function formatThemeText(themeIndex: number, videoFlavor: VideoFlavor): string {
  return `Theme: ${themeName(themeIndex, videoFlavor)} [T${isPixabayTheme(themeIndex) ? "/F" : ""}]`;
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
}: PlaybackHudProps) {
  const { duration, guideVolume } = usePlaybackTransportState();
  const { subscribe, getCurrentTime } = usePlaybackTransportActions();
  const { themeIndex, videoFlavor } = usePlaybackThemeState();
  const { firstSegmentStart, lastSegmentEnd, introSkipLeadSec, transcriptSource } =
    usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { pitchScore, micUserEnabled, micName, micMonitorUserEnabled } = usePlaybackMicState();

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

        <div className="flex flex-col items-end">
          <div className="flex items-center gap-2">
            <div className={`text-lg text-white${pitchScore ? "" : "/50"}`}>
              Score: {pitchScore ?? "--"}
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
          <button
            type="button"
            className="pointer-events-auto mt-1 rounded-sm border border-white/30 bg-black/25 px-2.5 py-1 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
            aria-pressed={practiceMode}
            onClick={onTogglePracticeMode}
          >
            Practice: {practiceMode ? "ON" : "OFF"} [P]
          </button>
          {usdxTimingAvailable && (
            <button
              type="button"
              className="pointer-events-auto mt-1 rounded-sm border border-white/30 bg-black/25 px-2.5 py-1 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
              aria-pressed={usdxTimingOpen}
              onClick={onToggleUsdxTiming}
            >
              USDX Timing: {usdxTimingOpen ? "ON" : "OFF"} [U]
            </button>
          )}
          <HintText>{formatGuideText(guideVolume)}</HintText>
          <HintText>Mic: {micUserEnabled ? micName : "OFF"} [M/N]</HintText>
          <HintText>Monitor: {micMonitorUserEnabled ? "ON" : "OFF"} [R]</HintText>
          <HintText>{formatThemeText(themeIndex, videoFlavor)}</HintText>
          <HintText>[ESC] Back</HintText>
        </div>
      </div>

      {showPixabayCredit && <p className={`${FOOTER_NOTE_CLASS} right-4`}>Videos by Pixabay</p>}

      <Disclaimer source={transcriptSource} />
    </>
  );
}

export const PlaybackHud = memo(PlaybackHudImpl);

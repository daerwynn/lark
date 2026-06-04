/**
 * Playback session: audio engine, visual background, lyrics HUD, and pause overlay.
 * Route shell (`Playback`) mounts this with a `key` of `file_hash` so state resets per track.
 *
 * `PlaybackInner` itself is the provider shell; `PlaybackLayout` is the
 * presentational tree that consumes the playback contexts via hooks.
 */

import { Background } from "@/components/playback/background";
import { ResultDialog } from "@/components/playback/dialogs/result";
import { LyricsDisplay } from "@/components/playback/lyrics-display";
import { PauseOverlay } from "@/components/playback/pause-overlay";
import { PitchGraph } from "@/components/playback/pitch-graph";
import { PlaybackHud } from "@/components/playback/playback-hud";
import { PlaybackTransportControls } from "@/components/playback/playback-transport-controls";
import { PracticeOverlay } from "@/components/playback/practice-overlay";
import { UsdxTimingPanel } from "@/components/playback/usdx-timing-panel";
import {
  PlaybackProviders,
  usePlaybackMicState,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from "@/contexts/playback";
import { usePlaybackInput, usePlaybackResult, usePracticeLoop } from "@/hooks/playback";
import {
  clampPlaybackTime,
  isSeekOutsideLoop,
  skipPlaybackTime,
  stopPlaybackTarget,
} from "@/lib/playback/transport-controls";
import type { AppConfig } from "@/types/AppConfig";
import type { Song } from "@/types/Song";
import { useCallback, useState } from "react";

export interface PlaybackInnerProps {
  song: Song;
  config: AppConfig | null;
}

interface PlaybackLayoutProps {
  song: Song;
  config: AppConfig | null;
}

function PlaybackLayout({ song, config }: PlaybackLayoutProps) {
  const { isReady, paused, duration } = usePlaybackTransportState();
  const { getCurrentTime, handleContinue, handleExit, seek, stopAt, togglePlayback } =
    usePlaybackTransportActions();
  const { segments } = usePlaybackTranscriptState();
  const { series } = usePlaybackMicState();
  const [practiceMode, setPracticeMode] = useState(false);
  const [usdxTimingOpen, setUsdxTimingOpen] = useState(false);
  const isUsdx = song.transcript_source === "Usdx" || song.usdx != null;
  const practiceLoop = usePracticeLoop({ enabled: practiceMode, segments, series });
  const activeLoop = practiceLoop.activeLoop;
  const clearPracticeLoop = practiceLoop.handleClearLoop;

  const handleTogglePracticeMode = useCallback(() => {
    setPracticeMode((prev) => !prev);
  }, []);

  const handleToggleUsdxTiming = useCallback(() => {
    if (!isUsdx) return;
    setUsdxTimingOpen((prev) => !prev);
  }, [isUsdx]);

  const handleCloseUsdxTiming = useCallback(() => {
    setUsdxTimingOpen(false);
  }, []);

  const handleSeekRequested = useCallback(
    (time: number) => {
      const target = clampPlaybackTime(time, duration);

      // User-initiated seeks outside an active loop mean "leave this loop" and
      // move normally. Retry-loop and automatic loop jumps bypass this handler.
      if (isSeekOutsideLoop(target, activeLoop)) {
        clearPracticeLoop();
      }

      seek(target);
    },
    [activeLoop, clearPracticeLoop, duration, seek],
  );

  const handleSkipRequested = useCallback(
    (deltaSeconds: number) => {
      handleSeekRequested(skipPlaybackTime(getCurrentTime(), deltaSeconds, duration));
    },
    [duration, getCurrentTime, handleSeekRequested],
  );

  const handleRestartRequested = useCallback(() => {
    handleSeekRequested(0);
  }, [handleSeekRequested]);

  const handleStopRequested = useCallback(() => {
    stopAt(stopPlaybackTarget(activeLoop, duration));
  }, [activeLoop, duration, stopAt]);

  usePlaybackInput(config, {
    onTogglePlayback: togglePlayback,
    onSkipPlayback: handleSkipRequested,
    onRestartPlayback: handleRestartRequested,
    onTogglePracticeMode: handleTogglePracticeMode,
    onToggleUsdxTiming: isUsdx ? handleToggleUsdxTiming : undefined,
    onSetLoopStart: practiceMode ? practiceLoop.handleSetLoopStart : undefined,
    onSetLoopEnd: practiceMode ? practiceLoop.handleSetLoopEnd : undefined,
    onClearLoop: practiceMode ? practiceLoop.handleClearLoop : undefined,
    onRetryLoop: practiceMode ? practiceLoop.handleRetryLoop : undefined,
  });
  const result = usePlaybackResult(song);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black" style={{ contain: "strict" }}>
      <Background />

      {isReady && (
        <>
          <PlaybackHud
            title={song.title}
            artist={song.artist}
            practiceMode={practiceMode}
            onTogglePracticeMode={handleTogglePracticeMode}
            usdxTimingAvailable={isUsdx}
            usdxTimingOpen={usdxTimingOpen}
            onToggleUsdxTiming={handleToggleUsdxTiming}
          />
          {practiceMode ? (
            <PracticeOverlay segments={segments} series={series} loop={practiceLoop} />
          ) : (
            <>
              <PitchGraph series={series} />
              <LyricsDisplay segments={segments} />
            </>
          )}
          {isUsdx && (
            <UsdxTimingPanel
              fileHash={song.file_hash}
              open={usdxTimingOpen}
              onClose={handleCloseUsdxTiming}
              onSeekRelative={handleSkipRequested}
            />
          )}
          <PlaybackTransportControls
            activeLoop={activeLoop}
            onSeekRequested={handleSeekRequested}
            onSkipRequested={handleSkipRequested}
            onStopRequested={handleStopRequested}
            onRestartRequested={handleRestartRequested}
          />
        </>
      )}

      <PauseOverlay open={paused && !result.open} onContinue={handleContinue} onExit={handleExit} />

      <ResultDialog
        open={result.open}
        score={result.score}
        song={song}
        scores={result.scores}
        activeProfile={result.activeProfile}
        onFinish={result.onFinish}
      />
    </div>
  );
}

export function PlaybackInner({ song, config }: PlaybackInnerProps) {
  return (
    <PlaybackProviders song={song} config={config}>
      <PlaybackLayout song={song} config={config} />
    </PlaybackProviders>
  );
}

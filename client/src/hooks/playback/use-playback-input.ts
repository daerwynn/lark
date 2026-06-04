import {
  usePlaybackMicActions,
  usePlaybackThemeActions,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from "@/contexts/playback";
import { useNavInput } from "@/hooks/navigation/use-nav-input";
import { usePlaybackConfigPersist } from "@/hooks/playback/use-playback-config-persist";
import type { AppConfig } from "@/types/AppConfig";
import { useCallback, useEffect, useRef } from "react";

export interface PlaybackInputHandlers {
  onTogglePracticeMode?: () => void;
  onToggleUsdxTiming?: () => void;
  onSetLoopStart?: () => void;
  onSetLoopEnd?: () => void;
  onClearLoop?: () => void;
  onRetryLoop?: () => boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/**
 * Wires keyboard + gamepad input for the playback session. Reads everything it
 * needs from the playback contexts; only the app config is passed in so we can
 * persist guide-volume changes without coupling this hook to the config query.
 */
export function usePlaybackInput(config: AppConfig | null, handlers: PlaybackInputHandlers = {}) {
  const { paused, isReady, guideVolume } = usePlaybackTransportState();
  const { getCurrentTime, setGuideVolume, handlePause, handleContinue } =
    usePlaybackTransportActions();
  const { cycleTheme, cycleFlavor } = usePlaybackThemeActions();
  const { firstSegmentStart, lastSegmentEnd, introSkipLeadSec } = usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { handleToggleMic, handleCycleMic, handleToggleMicMonitor } = usePlaybackMicActions();
  const {
    onTogglePracticeMode,
    onToggleUsdxTiming,
    onSetLoopStart,
    onSetLoopEnd,
    onClearLoop,
    onRetryLoop,
  } = handlers;

  const persistConfig = usePlaybackConfigPersist(config);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Gamepad: nav.back = pause/resume, nav.confirm = skip intro/outro
  useNavInput(
    useCallback(
      (action) => {
        if (action.back) {
          if (pausedRef.current) {
            handleContinue();
          } else {
            handlePause();
          }
          return;
        }

        if (pausedRef.current) return;

        if (action.confirm) {
          if (onRetryLoop?.()) return;

          if (!isReady) return;
          const t = getCurrentTime();
          if (t < firstSegmentStart - introSkipLeadSec) {
            handleSkipIntro();
          } else if (t > lastSegmentEnd + 1) {
            handleSkipOutro();
          }
        }
      },
      [
        handlePause,
        handleContinue,
        isReady,
        getCurrentTime,
        firstSegmentStart,
        lastSegmentEnd,
        introSkipLeadSec,
        handleSkipIntro,
        handleSkipOutro,
        onRetryLoop,
      ],
    ),
  );

  // Keyboard-only shortcuts (G, T, F, M, N, R, P, U, loop keys, +/-, Space)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) {
        return;
      }

      if (e.key === " ") {
        e.preventDefault();
        if (paused) {
          handleContinue();
        } else {
          handlePause();
        }
        return;
      }

      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        onTogglePracticeMode?.();
        return;
      }

      if (e.key === "u" || e.key === "U") {
        e.preventDefault();
        onToggleUsdxTiming?.();
        return;
      }

      if (e.key === "[" && onSetLoopStart) {
        e.preventDefault();
        onSetLoopStart();
        return;
      }

      if (e.key === "]" && onSetLoopEnd) {
        e.preventDefault();
        onSetLoopEnd();
        return;
      }

      if (e.key === "\\" && onClearLoop) {
        e.preventDefault();
        onClearLoop();
        return;
      }

      if (e.key === "Enter" && onRetryLoop?.()) {
        e.preventDefault();
        return;
      }

      if (paused) return;

      switch (e.key) {
        case "t":
        case "T":
          cycleTheme();
          break;

        case "f":
        case "F":
          cycleFlavor();
          break;

        case "g":
        case "G": {
          const nextVol = guideVolume > 0 ? 0 : 0.3;
          setGuideVolume(nextVol);
          persistConfig({ guide_volume: nextVol });
          break;
        }

        case "=":
        case "+": {
          const next = Math.min(1, guideVolume + 0.1);
          setGuideVolume(next);
          persistConfig({ guide_volume: next });
          break;
        }

        case "-": {
          const next = Math.max(0, guideVolume - 0.1);
          setGuideVolume(next);
          persistConfig({ guide_volume: next });
          break;
        }

        case "m":
        case "M":
          handleToggleMic();
          break;

        case "n":
        case "N":
          handleCycleMic();
          break;

        case "r":
        case "R":
          handleToggleMicMonitor();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    paused,
    guideVolume,
    setGuideVolume,
    cycleTheme,
    cycleFlavor,
    persistConfig,
    handlePause,
    handleContinue,
    onTogglePracticeMode,
    onToggleUsdxTiming,
    onSetLoopStart,
    onSetLoopEnd,
    onClearLoop,
    onRetryLoop,
    handleToggleMic,
    handleCycleMic,
    handleToggleMicMonitor,
  ]);
}

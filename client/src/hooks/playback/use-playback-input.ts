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
import {
  actionForShortcutCode,
  keyboardEventMatchesShortcut,
  playbackKeybindingsFromConfig,
  type PlaybackShortcutAction,
  type PlaybackShortcutBindings,
} from "@/lib/playback/keybindings";
import { clampPlaybackRate, stepPlaybackRate } from "@/lib/playback/playback-rate";
import { stepPlaybackVolume } from "@/lib/playback/playback-volume";
import type { AppConfig } from "@/types/AppConfig";
import { useCallback, useEffect, useMemo, useRef } from "react";

export interface PlaybackInputHandlers {
  onTogglePlayback?: () => void;
  onSkipPlayback?: (deltaSeconds: number) => void;
  onRestartPlayback?: () => void;
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
  if (target.closest("[role='dialog'], [role='slider'], [role='menu'], [role='listbox']")) {
    return true;
  }
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function navActionCode(action: {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
}): string | null {
  if (action.up) return "ArrowUp";
  if (action.down) return "ArrowDown";
  if (action.left) return "ArrowLeft";
  if (action.right) return "ArrowRight";
  if (action.confirm) return "Enter";
  if (action.back) return "Escape";
  return null;
}

/**
 * Wires keyboard + gamepad input for the playback session. Reads everything it
 * needs from the playback contexts; only the app config is passed in so we can
 * persist guide-volume changes without coupling this hook to the config query.
 */
export function usePlaybackInput(config: AppConfig | null, handlers: PlaybackInputHandlers = {}) {
  const {
    paused,
    isReady,
    guideVolume,
    playbackVolume,
    playbackRate,
    pitchPreservingPlaybackSupported,
  } = usePlaybackTransportState();
  const {
    getCurrentTime,
    setGuideVolume,
    setPlaybackVolume,
    setPlaybackRate,
    handlePause,
    handleContinue,
  } = usePlaybackTransportActions();
  const { cycleTheme, cycleFlavor } = usePlaybackThemeActions();
  const { firstSegmentStart, lastSegmentEnd, introSkipLeadSec } = usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { handleToggleMic, handleCycleMic, handleToggleMicMonitor } = usePlaybackMicActions();
  const {
    onTogglePlayback,
    onSkipPlayback,
    onRestartPlayback,
    onTogglePracticeMode,
    onToggleUsdxTiming,
    onSetLoopStart,
    onSetLoopEnd,
    onClearLoop,
    onRetryLoop,
  } = handlers;

  const persistConfig = usePlaybackConfigPersist(config);
  const keybindings = useMemo(() => playbackKeybindingsFromConfig(config), [config]);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const handlePlaybackShortcut = useCallback(
    (action: PlaybackShortcutAction): boolean => {
      switch (action) {
        case "playPause":
          onTogglePlayback?.();
          return true;

        case "pauseMenu":
          if (pausedRef.current) {
            handleContinue();
          } else {
            handlePause();
          }
          return true;

        case "restart":
          onRestartPlayback?.();
          return true;

        case "skipBack5":
          onSkipPlayback?.(-5);
          return true;

        case "skipForward5":
          onSkipPlayback?.(5);
          return true;

        case "volumeUp": {
          const next = stepPlaybackVolume(playbackVolume, 1);
          setPlaybackVolume(next);
          persistConfig({ playback_volume: next });
          return true;
        }

        case "volumeDown": {
          const next = stepPlaybackVolume(playbackVolume, -1);
          setPlaybackVolume(next);
          persistConfig({ playback_volume: next });
          return true;
        }

        case "fullscreen":
          return false;

        case "speedReset": {
          const next = clampPlaybackRate(1, pitchPreservingPlaybackSupported);
          setPlaybackRate(next);
          persistConfig({ practice_playback_rate: next });
          return true;
        }

        case "speedDown": {
          const next = stepPlaybackRate(playbackRate, -1, pitchPreservingPlaybackSupported);
          setPlaybackRate(next);
          persistConfig({ practice_playback_rate: next });
          return true;
        }

        case "speedUp": {
          const next = stepPlaybackRate(playbackRate, 1, pitchPreservingPlaybackSupported);
          setPlaybackRate(next);
          persistConfig({ practice_playback_rate: next });
          return true;
        }

        case "practiceMode":
          onTogglePracticeMode?.();
          return true;

        case "usdxTiming":
          onToggleUsdxTiming?.();
          return true;

        case "loopStart":
          if (!onSetLoopStart) return false;
          onSetLoopStart();
          return true;

        case "loopEnd":
          if (!onSetLoopEnd) return false;
          onSetLoopEnd();
          return true;

        case "loopClear":
          if (!onClearLoop) return false;
          onClearLoop();
          return true;

        case "loopRetry":
          return onRetryLoop?.() ?? false;

        case "guideToggle": {
          if (pausedRef.current) return false;
          const nextVol = guideVolume > 0 ? 0 : 0.3;
          setGuideVolume(nextVol);
          persistConfig({ guide_volume: nextVol });
          return true;
        }

        case "guideUp": {
          if (pausedRef.current) return false;
          const next = Math.min(1, guideVolume + 0.1);
          setGuideVolume(next);
          persistConfig({ guide_volume: next });
          return true;
        }

        case "guideDown": {
          if (pausedRef.current) return false;
          const next = Math.max(0, guideVolume - 0.1);
          setGuideVolume(next);
          persistConfig({ guide_volume: next });
          return true;
        }

        case "micToggle":
          if (pausedRef.current) return false;
          handleToggleMic();
          return true;

        case "micCycle":
          if (pausedRef.current) return false;
          handleCycleMic();
          return true;

        case "micMonitorToggle":
          if (pausedRef.current) return false;
          handleToggleMicMonitor();
          return true;

        case "themeCycle":
          if (pausedRef.current) return false;
          cycleTheme();
          return true;

        case "videoFlavorCycle":
          if (pausedRef.current) return false;
          cycleFlavor();
          return true;
      }
    },
    [
      cycleFlavor,
      cycleTheme,
      guideVolume,
      handleContinue,
      handleCycleMic,
      handlePause,
      handleToggleMic,
      handleToggleMicMonitor,
      onClearLoop,
      onRestartPlayback,
      onRetryLoop,
      onSetLoopEnd,
      onSetLoopStart,
      onSkipPlayback,
      onTogglePlayback,
      onTogglePracticeMode,
      onToggleUsdxTiming,
      persistConfig,
      pitchPreservingPlaybackSupported,
      playbackRate,
      playbackVolume,
      setGuideVolume,
      setPlaybackRate,
      setPlaybackVolume,
    ],
  );

  // NavInput owns arrows/Enter/Escape at capture phase. Keyboard events are
  // mapped through custom bindings; gamepad keeps the original navigation feel.
  useNavInput(
    useCallback(
      (action) => {
        if (action.source === "keyboard") {
          const code = navActionCode(action);
          const shortcutAction = code ? actionForShortcutCode(keybindings, code) : null;
          if (shortcutAction && handlePlaybackShortcut(shortcutAction)) {
            return;
          }
          if (code !== "Enter") {
            return;
          }
        }

        if (action.back) {
          if (pausedRef.current) {
            handleContinue();
          } else {
            handlePause();
          }
          return;
        }

        if (action.left) {
          onSkipPlayback?.(-5);
          return;
        }

        if (action.right) {
          onSkipPlayback?.(5);
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
        keybindings,
        handlePlaybackShortcut,
        handlePause,
        handleContinue,
        isReady,
        getCurrentTime,
        firstSegmentStart,
        lastSegmentEnd,
        introSkipLeadSec,
        handleSkipIntro,
        handleSkipOutro,
        onSkipPlayback,
        onRetryLoop,
      ],
    ),
  );

  // Keyboard-only shortcuts. Arrow/Enter/Escape keys arrive through NavInput
  // unless focus is inside a managed playback control.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) {
        return;
      }

      for (const [action, shortcut] of Object.entries(keybindings) as [
        PlaybackShortcutAction,
        PlaybackShortcutBindings[PlaybackShortcutAction],
      ][]) {
        if (!keyboardEventMatchesShortcut(e, shortcut)) {
          continue;
        }

        if (handlePlaybackShortcut(action)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, handlePlaybackShortcut]);
}

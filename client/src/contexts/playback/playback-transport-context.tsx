/**
 * Owns the audio engine for the active song: wraps `useAudioPlayer`, the
 * stems-ready handshake, the user-facing `paused` flag, and the pause/continue/
 * exit handlers shared by overlays, hotkeys, and the result dialog.
 *
 * Splits state and actions into two contexts so consumers that only need
 * stable callbacks (subscribe, getCurrentTime, handlePause...) don't re-render
 * when reactive fields like `isPlaying` or `guideVolume` change.
 */

import { type AudioPlayer, type TimeSubscriber, useAudioPlayer } from "@/hooks/use-audio-player";
import { ensureMp3Stems, onStemsReady } from "@/bridge/playback";
import { clampPlaybackRate } from "@/lib/playback/playback-rate";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

export interface PlaybackTransportState {
  isReady: boolean;
  isPlaying: boolean;
  isFinished: boolean;
  paused: boolean;
  duration: number;
  guideVolume: number;
  playbackRate: number;
  pitchPreservingPlaybackSupported: boolean;
  error: string | null;
}

export interface PlaybackTransportActions {
  subscribe: (fn: TimeSubscriber) => () => void;
  getCurrentTime: () => number;
  seek: (time: number) => void;
  setGuideVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  getVocalsBuffer: AudioPlayer["getVocalsBuffer"];
  getAudioContext: AudioPlayer["getAudioContext"];
  playAudio: () => void;
  /** Raw audio-engine pause; does NOT raise the `paused` UI flag. */
  pauseAudio: () => void;
  togglePlayback: () => void;
  stopAt: (time: number) => void;
  handlePause: () => void;
  handleContinue: () => void;
  handleExit: () => void;
}

const TransportStateContext = createContext<PlaybackTransportState | null>(null);
const TransportActionsContext = createContext<PlaybackTransportActions | null>(null);

interface PlaybackTransportProviderProps {
  fileHash: string;
  initialGuideVolume: number;
  initialPlaybackRate: number;
  children: ReactNode;
}

export function PlaybackTransportProvider({
  fileHash,
  initialGuideVolume,
  initialPlaybackRate,
  children,
}: PlaybackTransportProviderProps) {
  const navigate = useNavigate();
  // Snapshot the initial guide volume so changing config later doesn't
  // re-instantiate the audio engine via useAudioPlayer's effect deps.
  const initialGuideVolumeRef = useRef(initialGuideVolume);
  const initialPlaybackRateRef = useRef(clampPlaybackRate(initialPlaybackRate));

  const [stemsReady, setStemsReady] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    // Register the listener BEFORE invoking the command. On a page reload the
    // WS handshake races the `stems-ready` broadcast — if the listener isn't
    // attached (or the socket isn't open) when the server emits, the event
    // is gone forever and `stemsReady` stays false, leaving the page stuck
    // on a black screen. `onStemsReady` awaits the socket open under the
    // hood, so once its promise resolves we are guaranteed to receive the
    // event the command triggers.
    onStemsReady((event) => {
      if (event.file_hash !== fileHash) return;
      if (event.error) {
        toast.error(`Stem conversion failed: ${event.error}`);
        navigate("/", { replace: true });
      } else {
        setStemsReady(true);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
      ensureMp3Stems(fileHash);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [fileHash, navigate]);

  const audio = useAudioPlayer(
    fileHash,
    initialGuideVolumeRef.current,
    initialPlaybackRateRef.current,
    stemsReady,
  );

  useEffect(() => {
    if (audio.error) {
      toast.error(audio.error);
      navigate("/", { replace: true });
    }
  }, [audio.error, navigate]);

  const handlePause = useCallback(() => {
    audio.pause();
    setPaused(true);
  }, [audio.pause]);

  const playAudio = useCallback(() => {
    setPaused(false);
    if (audio.isFinished || (audio.duration > 0 && audio.getCurrentTime() >= audio.duration)) {
      audio.seek(0);
    }
    audio.resume();
  }, [audio.duration, audio.getCurrentTime, audio.isFinished, audio.resume, audio.seek]);

  const pauseAudio = useCallback(() => {
    audio.pause();
  }, [audio.pause]);

  const togglePlayback = useCallback(() => {
    if (audio.isPlaying) {
      audio.pause();
      setPaused(false);
      return;
    }

    setPaused(false);
    if (audio.isFinished || (audio.duration > 0 && audio.getCurrentTime() >= audio.duration)) {
      audio.seek(0);
    }
    audio.resume();
  }, [
    audio.duration,
    audio.getCurrentTime,
    audio.isFinished,
    audio.isPlaying,
    audio.pause,
    audio.resume,
    audio.seek,
  ]);

  const stopAt = useCallback(
    (time: number) => {
      // Stop parks playback without raising PauseOverlay; phrase loops stop at
      // their loop start so retrying the same range stays predictable.
      audio.pause();
      audio.seek(time);
      setPaused(false);
    },
    [audio.pause, audio.seek],
  );

  const handleContinue = useCallback(() => {
    setPaused(false);
    audio.resume();
  }, [audio.resume]);

  const handleExit = useCallback(() => {
    audio.cleanup();
    navigate("/", { replace: true });
  }, [audio.cleanup, navigate]);

  const stateValue = useMemo<PlaybackTransportState>(
    () => ({
      isReady: audio.isReady,
      isPlaying: audio.isPlaying,
      isFinished: audio.isFinished,
      paused,
      duration: audio.duration,
      guideVolume: audio.guideVolume,
      playbackRate: audio.playbackRate,
      pitchPreservingPlaybackSupported: audio.pitchPreservingPlaybackSupported,
      error: audio.error,
    }),
    [
      audio.isReady,
      audio.isPlaying,
      audio.isFinished,
      audio.duration,
      audio.guideVolume,
      audio.playbackRate,
      audio.pitchPreservingPlaybackSupported,
      audio.error,
      paused,
    ],
  );

  const actionsValue = useMemo<PlaybackTransportActions>(
    () => ({
      subscribe: audio.subscribe,
      getCurrentTime: audio.getCurrentTime,
      seek: audio.seek,
      setGuideVolume: audio.setGuideVolume,
      setPlaybackRate: audio.setPlaybackRate,
      getVocalsBuffer: audio.getVocalsBuffer,
      getAudioContext: audio.getAudioContext,
      playAudio,
      pauseAudio,
      togglePlayback,
      stopAt,
      handlePause,
      handleContinue,
      handleExit,
    }),
    [
      audio.subscribe,
      audio.getCurrentTime,
      audio.seek,
      audio.setGuideVolume,
      audio.setPlaybackRate,
      audio.getVocalsBuffer,
      audio.getAudioContext,
      playAudio,
      pauseAudio,
      togglePlayback,
      stopAt,
      handlePause,
      handleContinue,
      handleExit,
    ],
  );

  return (
    <TransportStateContext.Provider value={stateValue}>
      <TransportActionsContext.Provider value={actionsValue}>
        {children}
      </TransportActionsContext.Provider>
    </TransportStateContext.Provider>
  );
}

export function usePlaybackTransportState(): PlaybackTransportState {
  const ctx = useContext(TransportStateContext);
  if (!ctx) {
    throw new Error("usePlaybackTransportState must be used within a PlaybackTransportProvider");
  }
  return ctx;
}

export function usePlaybackTransportActions(): PlaybackTransportActions {
  const ctx = useContext(TransportActionsContext);
  if (!ctx) {
    throw new Error("usePlaybackTransportActions must be used within a PlaybackTransportProvider");
  }
  return ctx;
}

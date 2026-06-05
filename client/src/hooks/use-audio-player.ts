/**
 * Media-element playback for instrumental + guide vocals, with a shared rAF
 * tick that notifies subscribers for visuals (background sync, lyrics, HUD).
 *
 * HTMLMediaElement gives us browser-native pitch-preserving playbackRate. The
 * decoded guide-vocal AudioBuffer is still kept for local pitch scoring.
 */

import type { PlaybackAdapter } from "@/bridge/playback";
import { playbackAdapter } from "@/bridge/playback";
import { clampPlaybackRate, DEFAULT_PLAYBACK_RATE } from "@/lib/playback/playback-rate";
import { clampPlaybackTime } from "@/lib/playback/transport-controls";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PlaybackTimeEventReason = "tick" | "seek";

export interface PlaybackTimeEvent {
  reason: PlaybackTimeEventReason;
  isDiscontinuity: boolean;
  previousTime: number;
}

export type TimeSubscriber = (time: number, event?: PlaybackTimeEvent) => void;

export interface AudioPlayer {
  getCurrentTime: () => number;
  subscribe: (fn: TimeSubscriber) => () => void;
  duration: number;
  isReady: boolean;
  isPlaying: boolean;
  isFinished: boolean;
  error: string | null;
  guideVolume: number;
  playbackRate: number;
  pitchPreservingPlaybackSupported: boolean;
  play: () => void;
  pause: () => void;
  resume: () => void;
  seek: (time: number) => void;
  setGuideVolume: (v: number) => void;
  setPlaybackRate: (rate: number) => void;
  cleanup: () => void;
  getVocalsBuffer: () => AudioBuffer | null;
  getAudioContext: () => AudioContext | null;
}

type PitchPreservingAudio = HTMLAudioElement & {
  preservesPitch?: boolean;
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
};

const NOTIFY_INTERVAL_MS = 33;
const MEDIA_SYNC_DRIFT_SEC = 0.08;

function createAudioElement(src: string): HTMLAudioElement {
  const audio = new Audio(src);
  audio.preload = "auto";
  return audio;
}

function enablePitchPreservation(audio: HTMLAudioElement): boolean {
  const candidate = audio as PitchPreservingAudio;
  let supported = false;

  if ("preservesPitch" in candidate) {
    candidate.preservesPitch = true;
    supported = true;
  }
  if ("mozPreservesPitch" in candidate) {
    candidate.mozPreservesPitch = true;
    supported = true;
  }
  if ("webkitPreservesPitch" in candidate) {
    candidate.webkitPreservesPitch = true;
    supported = true;
  }

  return supported;
}

function applyPlaybackRate(
  audio: HTMLAudioElement | null,
  rate: number,
  pitchPreservingSupported: boolean,
): number {
  const next = clampPlaybackRate(rate, pitchPreservingSupported);
  if (audio) {
    enablePitchPreservation(audio);
    audio.playbackRate = next;
  }
  return next;
}

function waitForMetadata(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(audio.duration)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("error", onError);
    };
    const onMetadata = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(audio.error?.message || "media metadata failed to load"));
    };

    audio.addEventListener("loadedmetadata", onMetadata, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.load();
  });
}

function mediaDuration(audio: HTMLAudioElement | null, fallback: number): number {
  if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
    return audio.duration;
  }
  return fallback;
}

function mediaCurrentTime(audio: HTMLAudioElement | null, fallback: number): number {
  if (audio && Number.isFinite(audio.currentTime)) {
    return audio.currentTime;
  }
  return fallback;
}

function releaseAudio(audio: HTMLAudioElement | null): void {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

export function useAudioPlayer(
  fileHash: string,
  initialGuideVolume: number,
  initialPlaybackRate: number,
  enabled: boolean,
  adapter: PlaybackAdapter = playbackAdapter,
): AudioPlayer {
  const ctxRef = useRef<AudioContext | null>(null);
  const instrumentalElRef = useRef<HTMLAudioElement | null>(null);
  const vocalsElRef = useRef<HTMLAudioElement | null>(null);
  const vocalsBufRef = useRef<AudioBuffer | null>(null);
  const rafRef = useRef<number>(0);
  const currentTimeRef = useRef(0);
  const subscribersRef = useRef<Set<TimeSubscriber>>(new Set());
  const playingRef = useRef(false);
  const cancelledRef = useRef(false);
  const playbackRateRef = useRef(DEFAULT_PLAYBACK_RATE);
  const pitchPreservingSupportedRef = useRef(true);

  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guideVolume, setGuideVolumeState] = useState(initialGuideVolume);
  const [playbackRate, setPlaybackRateState] = useState(DEFAULT_PLAYBACK_RATE);
  const [pitchPreservingPlaybackSupported, setPitchPreservingPlaybackSupported] = useState(true);

  const getVocalsBuffer = useCallback(() => vocalsBufRef.current, []);

  const getAudioContext = useCallback(() => ctxRef.current, []);

  const getCurrentTime = useCallback(
    () => mediaCurrentTime(instrumentalElRef.current, currentTimeRef.current),
    [],
  );

  const subscribe = useCallback((fn: TimeSubscriber) => {
    subscribersRef.current.add(fn);

    return () => {
      subscribersRef.current.delete(fn);
    };
  }, []);

  const notifySubscribers = useCallback((t: number, event: PlaybackTimeEvent) => {
    for (const fn of subscribersRef.current) {
      fn(t, event);
    }
  }, []);

  const setMediaPosition = useCallback(
    (time: number) => {
      const inst = instrumentalElRef.current;
      const voc = vocalsElRef.current;
      const clamped = clampPlaybackTime(time, mediaDuration(inst, duration));

      if (inst) inst.currentTime = clamped;
      if (voc) voc.currentTime = clamped;
      currentTimeRef.current = clamped;
      return clamped;
    },
    [duration],
  );

  const stopMedia = useCallback(() => {
    playingRef.current = false;
    instrumentalElRef.current?.pause();
    vocalsElRef.current?.pause();
  }, []);

  const startMedia = useCallback(
    (offset: number) => {
      const inst = instrumentalElRef.current;
      const voc = vocalsElRef.current;
      if (!inst || !voc) return;

      stopMedia();
      const clamped = setMediaPosition(offset);
      const rate = clampPlaybackRate(playbackRateRef.current, pitchPreservingSupportedRef.current);

      applyPlaybackRate(inst, rate, pitchPreservingSupportedRef.current);
      applyPlaybackRate(voc, rate, pitchPreservingSupportedRef.current);

      playingRef.current = true;
      currentTimeRef.current = clamped;

      Promise.all([inst.play(), voc.play()]).catch((e) => {
        if (cancelledRef.current) return;
        playingRef.current = false;
        setIsPlaying(false);
        setError(`Failed to start audio: ${e instanceof Error ? e.message : String(e)}`);
      });
    },
    [setMediaPosition, stopMedia],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    cancelledRef.current = false;
    playingRef.current = false;
    currentTimeRef.current = 0;
    setIsReady(false);
    setIsPlaying(false);
    setIsFinished(false);
    setError(null);

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const isCancelled = () => cancelled || cancelledRef.current;

    adapter
      .getAudioPaths(fileHash)
      .then(async (paths) => {
        if (isCancelled()) return;

        const inst = createAudioElement(paths.instrumental);
        const voc = createAudioElement(paths.vocals);
        instrumentalElRef.current = inst;
        vocalsElRef.current = voc;

        const canPreservePitch = enablePitchPreservation(inst) && enablePitchPreservation(voc);
        pitchPreservingSupportedRef.current = canPreservePitch;
        setPitchPreservingPlaybackSupported(canPreservePitch);

        const nextRate = clampPlaybackRate(initialPlaybackRate, canPreservePitch);
        playbackRateRef.current = nextRate;
        setPlaybackRateState(nextRate);
        applyPlaybackRate(inst, nextRate, canPreservePitch);
        applyPlaybackRate(voc, nextRate, canPreservePitch);

        voc.volume = Math.max(0, Math.min(1, initialGuideVolume));

        inst.onended = () => {
          if (!cancelledRef.current && playingRef.current && instrumentalElRef.current === inst) {
            playingRef.current = false;
            currentTimeRef.current = inst.duration;
            setIsFinished(true);
            setIsPlaying(false);
          }
        };

        const [vocalsData] = await Promise.all([
          fetch(paths.vocals).then((r) => {
            if (!r.ok) {
              throw new Error(`Failed to fetch vocals: ${r.status}`);
            }

            return r.arrayBuffer();
          }),
          waitForMetadata(inst),
          waitForMetadata(voc),
        ]);

        if (isCancelled()) return;

        if (ctx.state === "suspended") {
          await ctx.resume().catch(() => {});
        }

        const vocalsBuffer = await ctx.decodeAudioData(vocalsData);
        if (isCancelled()) return;

        vocalsBufRef.current = vocalsBuffer;
        const nextDuration = mediaDuration(inst, vocalsBuffer.duration);
        setDuration(nextDuration);

        startMedia(0);
        setIsReady(true);
        setIsPlaying(true);
      })
      .catch((e) => {
        if (!isCancelled()) {
          setError(`Failed to load audio: ${e}`);
        }
      });

    let lastNotify = 0;

    const tick = () => {
      if (isCancelled()) {
        return;
      }

      if (playingRef.current) {
        const inst = instrumentalElRef.current;
        const voc = vocalsElRef.current;

        if (inst) {
          const now = performance.now();
          const previous = currentTimeRef.current;
          const t = inst.currentTime;
          currentTimeRef.current = t;

          if (voc && Math.abs(voc.currentTime - t) > MEDIA_SYNC_DRIFT_SEC) {
            voc.currentTime = t;
          }

          if (now - lastNotify >= NOTIFY_INTERVAL_MS) {
            lastNotify = now;
            for (const fn of subscribersRef.current) {
              fn(t, { reason: "tick", isDiscontinuity: false, previousTime: previous });
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      stopMedia();
      releaseAudio(instrumentalElRef.current);
      releaseAudio(vocalsElRef.current);
      instrumentalElRef.current = null;
      vocalsElRef.current = null;
      vocalsBufRef.current = null;
      ctx.close();
      ctxRef.current = null;
    };
  }, [adapter, enabled, fileHash, initialGuideVolume, initialPlaybackRate, startMedia, stopMedia]);

  const play = useCallback(() => {
    startMedia(currentTimeRef.current);
    setIsPlaying(true);
  }, [startMedia]);

  const pause = useCallback(() => {
    currentTimeRef.current = getCurrentTime();
    stopMedia();
    setIsPlaying(false);
  }, [getCurrentTime, stopMedia]);

  const resume = useCallback(() => {
    startMedia(currentTimeRef.current);
    setIsPlaying(true);
  }, [startMedia]);

  const seek = useCallback(
    (time: number) => {
      const wasPlaying = playingRef.current;
      const previous = getCurrentTime();

      stopMedia();
      const clamped = setMediaPosition(time);

      if (wasPlaying) {
        startMedia(clamped);
        setIsPlaying(true);
      }

      notifySubscribers(clamped, {
        reason: "seek",
        isDiscontinuity: true,
        previousTime: previous,
      });
      setIsFinished(false);
    },
    [getCurrentTime, notifySubscribers, setMediaPosition, startMedia, stopMedia],
  );

  const setGuideVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));

    setGuideVolumeState(clamped);

    if (vocalsElRef.current) {
      vocalsElRef.current.volume = clamped;
    }
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const next = clampPlaybackRate(rate, pitchPreservingSupportedRef.current);
    playbackRateRef.current = next;
    setPlaybackRateState(next);
    applyPlaybackRate(instrumentalElRef.current, next, pitchPreservingSupportedRef.current);
    applyPlaybackRate(vocalsElRef.current, next, pitchPreservingSupportedRef.current);
  }, []);

  const cleanup = useCallback(() => {
    cancelledRef.current = true;

    cancelAnimationFrame(rafRef.current);
    stopMedia();
    releaseAudio(instrumentalElRef.current);
    releaseAudio(vocalsElRef.current);
    instrumentalElRef.current = null;
    vocalsElRef.current = null;

    ctxRef.current?.close();
    ctxRef.current = null;
  }, [stopMedia]);

  return useMemo(
    () => ({
      getCurrentTime,
      subscribe,
      duration,
      isReady,
      isPlaying,
      isFinished,
      error,
      guideVolume,
      playbackRate,
      pitchPreservingPlaybackSupported,
      play,
      pause,
      resume,
      seek,
      setGuideVolume,
      setPlaybackRate,
      cleanup,
      getVocalsBuffer,
      getAudioContext,
    }),
    [
      getCurrentTime,
      subscribe,
      duration,
      isReady,
      isPlaying,
      isFinished,
      error,
      guideVolume,
      playbackRate,
      pitchPreservingPlaybackSupported,
      play,
      pause,
      resume,
      seek,
      setGuideVolume,
      setPlaybackRate,
      cleanup,
      getVocalsBuffer,
      getAudioContext,
    ],
  );
}

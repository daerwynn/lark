import {
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from "@/contexts/playback/playback-transport-context";
import { useLatestRef } from "@/hooks/use-latest-ref";
import type { PitchSeries } from "@/lib/pitch/state";
import {
  computeLoopAttemptScore,
  createManualLoopRange,
  createPhraseLoopRange,
  DEFAULT_LOOP_COUNT_IN_SEC,
  didCrossLoopEnd,
  loopRetrySeekTime,
  normalizePracticeCountIn,
  type PracticeCountInSec,
  type PracticeLoopRange,
} from "@/lib/practice/practice-loop";
import type { Segment } from "@/types/Transcript";
import { useCallback, useEffect, useRef, useState } from "react";

interface UsePracticeLoopOptions {
  enabled: boolean;
  segments: Segment[];
  series: PitchSeries;
  lyricDisplayOffsetSec?: number;
  lyricLeadSec?: number;
}

export interface PracticeLoopControls {
  activeLoop: PracticeLoopRange | null;
  manualStart: number | null;
  manualEnd: number | null;
  countInSec: PracticeCountInSec;
  lastAttemptScore: number | null;
  lastAttemptRange: PracticeLoopRange | null;
  handleLoopCurrentPhrase: () => void;
  handleSetLoopStart: () => void;
  handleSetLoopEnd: () => void;
  handleClearLoop: () => void;
  handleRetryLoop: () => boolean;
  handleSetCountInSec: (value: number) => void;
}

export function usePracticeLoop({
  enabled,
  segments,
  series,
  lyricDisplayOffsetSec = 0,
  lyricLeadSec,
}: UsePracticeLoopOptions): PracticeLoopControls {
  const { duration, isPlaying } = usePlaybackTransportState();
  const { getCurrentTime, seek, subscribe } = usePlaybackTransportActions();
  const [activeLoop, setActiveLoop] = useState<PracticeLoopRange | null>(null);
  const [manualStart, setManualStart] = useState<number | null>(null);
  const [manualEnd, setManualEnd] = useState<number | null>(null);
  const [countInSec, setCountInSec] = useState<PracticeCountInSec>(DEFAULT_LOOP_COUNT_IN_SEC);
  const [lastAttemptScore, setLastAttemptScore] = useState<number | null>(null);
  const [lastAttemptRange, setLastAttemptRange] = useState<PracticeLoopRange | null>(null);

  const enabledRef = useLatestRef(enabled);
  const activeLoopRef = useLatestRef(activeLoop);
  const countInSecRef = useLatestRef(countInSec);
  const isPlayingRef = useLatestRef(isPlaying);
  const seriesRef = useLatestRef(series);
  const previousTimeRef = useRef(getCurrentTime());
  const retryingRef = useRef(false);

  const resetAttempt = useCallback(() => {
    setLastAttemptScore(null);
    setLastAttemptRange(null);
  }, []);

  const clearLoopState = useCallback(() => {
    setActiveLoop(null);
    setManualStart(null);
    setManualEnd(null);
    resetAttempt();
  }, [resetAttempt]);

  const activateLoop = useCallback(
    (range: PracticeLoopRange | null) => {
      setActiveLoop(range);
      resetAttempt();
    },
    [resetAttempt],
  );

  const scoreAttempt = useCallback(
    (range: PracticeLoopRange) => {
      const score = computeLoopAttemptScore(seriesRef.current, range);
      setLastAttemptScore(score);
      setLastAttemptRange(range);
    },
    [seriesRef],
  );

  const seekToLoopStart = useCallback(
    (range: PracticeLoopRange) => {
      const target = loopRetrySeekTime(range, countInSecRef.current);
      retryingRef.current = true;
      previousTimeRef.current = target;
      seek(target);
      window.setTimeout(() => {
        retryingRef.current = false;
      }, 0);
    },
    [countInSecRef, seek],
  );

  const handleLoopCurrentPhrase = useCallback(() => {
    if (!enabled) return;

    const range = createPhraseLoopRange(
      segments,
      getCurrentTime(),
      duration,
      lyricDisplayOffsetSec,
      lyricLeadSec,
    );
    setManualStart(null);
    setManualEnd(null);
    activateLoop(range);
  }, [
    activateLoop,
    duration,
    enabled,
    getCurrentTime,
    lyricDisplayOffsetSec,
    lyricLeadSec,
    segments,
  ]);

  const handleSetLoopStart = useCallback(() => {
    if (!enabled) return;

    const nextStart = getCurrentTime();
    setManualStart(nextStart);
    setActiveLoop(createManualLoopRange(nextStart, manualEnd, duration));
    resetAttempt();
  }, [duration, enabled, getCurrentTime, manualEnd, resetAttempt]);

  const handleSetLoopEnd = useCallback(() => {
    if (!enabled) return;

    const nextEnd = getCurrentTime();
    setManualEnd(nextEnd);
    setActiveLoop(createManualLoopRange(manualStart, nextEnd, duration));
    resetAttempt();
  }, [duration, enabled, getCurrentTime, manualStart, resetAttempt]);

  const handleClearLoop = useCallback(() => {
    clearLoopState();
  }, [clearLoopState]);

  const handleRetryLoop = useCallback(() => {
    if (!enabled) return false;

    const range = activeLoopRef.current;
    if (!range) return false;

    scoreAttempt(range);
    seekToLoopStart(range);
    return true;
  }, [activeLoopRef, enabled, scoreAttempt, seekToLoopStart]);

  const handleSetCountInSec = useCallback((value: number) => {
    setCountInSec(normalizePracticeCountIn(value));
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearLoopState();
    }
  }, [clearLoopState, enabled]);

  useEffect(() => {
    previousTimeRef.current = getCurrentTime();

    return subscribe((time) => {
      const previous = previousTimeRef.current;
      previousTimeRef.current = time;

      const range = activeLoopRef.current;
      if (!enabledRef.current || !range || !isPlayingRef.current || retryingRef.current) {
        return;
      }

      if (!didCrossLoopEnd(previous, time, range)) {
        return;
      }

      scoreAttempt(range);
      seekToLoopStart(range);
    });
  }, [
    activeLoopRef,
    enabledRef,
    getCurrentTime,
    isPlayingRef,
    scoreAttempt,
    seekToLoopStart,
    subscribe,
  ]);

  return {
    activeLoop,
    manualStart,
    manualEnd,
    countInSec,
    lastAttemptScore,
    lastAttemptRange,
    handleLoopCurrentPhrase,
    handleSetLoopStart,
    handleSetLoopEnd,
    handleClearLoop,
    handleRetryLoop,
    handleSetCountInSec,
  };
}

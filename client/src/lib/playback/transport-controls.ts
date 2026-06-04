import type { PracticeLoopRange } from "@/lib/practice/practice-loop";

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function clampPlaybackTime(time: number, duration: number): number {
  const max = Math.max(0, finiteOrZero(duration));
  return Math.min(max, Math.max(0, finiteOrZero(time)));
}

export function skipPlaybackTime(
  currentTime: number,
  deltaSeconds: number,
  duration: number,
): number {
  return clampPlaybackTime(finiteOrZero(currentTime) + finiteOrZero(deltaSeconds), duration);
}

export function formatPlaybackTime(seconds: number): string {
  const totalMilliseconds = Math.round(Math.max(0, finiteOrZero(seconds)) * 1000);
  const hrs = Math.floor(totalMilliseconds / 3_600_000);
  const mins = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const millis = totalMilliseconds % 1000;
  const secondsText = `${secs.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secondsText}`;
  }

  return `${mins}:${secondsText}`;
}

export function stopPlaybackTarget(activeLoop: PracticeLoopRange | null, duration: number): number {
  return clampPlaybackTime(activeLoop?.start ?? 0, duration);
}

export function isSeekOutsideLoop(
  targetTime: number,
  activeLoop: PracticeLoopRange | null,
): boolean {
  if (!activeLoop) return false;
  return targetTime < activeLoop.start || targetTime > activeLoop.end;
}

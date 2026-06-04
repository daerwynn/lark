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
  const totalSeconds = Math.max(0, Math.floor(finiteOrZero(seconds)));
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  return `${mins}:${secs.toString().padStart(2, "0")}`;
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

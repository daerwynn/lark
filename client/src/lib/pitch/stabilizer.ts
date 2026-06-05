import type { PitchDetectionFrame } from "./detect";
import { freqToSemitone, semitoneToFreq, snapToRefOctave } from "./state";

export interface LivePitchStabilizerOptions {
  expectedHz?: number | null;
  referenceHz?: number | null;
}

export interface LivePitchStabilizerConfig {
  medianWindow: number;
  jumpThresholdSemitones: number;
  confirmedJumpFrames: number;
  pendingToleranceSemitones: number;
  missingFrameResetCount: number;
}

const DEFAULT_CONFIG: LivePitchStabilizerConfig = {
  medianWindow: 5,
  jumpThresholdSemitones: 5,
  confirmedJumpFrames: 2,
  pendingToleranceSemitones: 1.5,
  missingFrameResetCount: 8,
};

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function correctPitchOctave(rawHz: number, targetHz: number | null | undefined): number {
  if (!isFinitePositive(rawHz)) return rawHz;
  if (!isFinitePositive(targetHz)) return rawHz;
  return semitoneToFreq(snapToRefOctave(freqToSemitone(targetHz), freqToSemitone(rawHz)));
}

export class LivePitchStabilizer {
  private readonly config: LivePitchStabilizerConfig;
  private stableSemi: number | null = null;
  private pendingJumpSemi: number | null = null;
  private pendingJumpCount = 0;
  private missingFrameCount = 0;
  private recentSemi: number[] = [];

  constructor(config: Partial<LivePitchStabilizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  reset(): void {
    this.stableSemi = null;
    this.pendingJumpSemi = null;
    this.pendingJumpCount = 0;
    this.missingFrameCount = 0;
    this.recentSemi = [];
  }

  stabilize(
    frame: PitchDetectionFrame | null,
    options: LivePitchStabilizerOptions = {},
  ): number | null {
    if (!frame || !isFinitePositive(frame.hz)) {
      this.missingFrameCount += 1;
      if (this.missingFrameCount >= this.config.missingFrameResetCount) {
        this.reset();
      }
      return null;
    }

    this.missingFrameCount = 0;
    const targetHz = options.expectedHz ?? options.referenceHz;
    const correctedHz = correctPitchOctave(frame.hz, targetHz);
    const correctedSemi = freqToSemitone(correctedHz);

    if (this.stableSemi != null) {
      const jump = Math.abs(correctedSemi - this.stableSemi);
      if (jump > this.config.jumpThresholdSemitones) {
        if (
          this.pendingJumpSemi != null &&
          Math.abs(correctedSemi - this.pendingJumpSemi) <= this.config.pendingToleranceSemitones
        ) {
          this.pendingJumpCount += 1;
        } else {
          this.pendingJumpSemi = correctedSemi;
          this.pendingJumpCount = 1;
        }

        if (this.pendingJumpCount < this.config.confirmedJumpFrames) {
          return null;
        }

        this.recentSemi = [];
      }
    }

    this.pendingJumpSemi = null;
    this.pendingJumpCount = 0;
    this.recentSemi.push(correctedSemi);
    while (this.recentSemi.length > this.config.medianWindow) {
      this.recentSemi.shift();
    }

    const stableSemi = median(this.recentSemi);
    this.stableSemi = stableSemi;
    return semitoneToFreq(stableSemi);
  }
}

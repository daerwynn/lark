import type { PitchDetectionFrame } from "./detect";
import { MIC_REACQUIRE_CLARITY_THRESHOLD, MIC_REACQUIRE_RMS_GATE } from "./constants";
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
  reacquireFrames: number;
  reacquireToleranceSemitones: number;
  reacquireRmsGate: number;
  reacquireClarityThreshold: number;
}

export interface LivePitchStabilizerStatus {
  voiced: boolean;
  reacquiring: boolean;
}

const DEFAULT_CONFIG: LivePitchStabilizerConfig = {
  medianWindow: 5,
  jumpThresholdSemitones: 5,
  confirmedJumpFrames: 2,
  pendingToleranceSemitones: 1.5,
  missingFrameResetCount: 8,
  reacquireFrames: 2,
  reacquireToleranceSemitones: 1.5,
  reacquireRmsGate: MIC_REACQUIRE_RMS_GATE,
  reacquireClarityThreshold: MIC_REACQUIRE_CLARITY_THRESHOLD,
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
  private reacquiring = false;
  private reacquireSemi: number | null = null;
  private reacquireCount = 0;
  private voiced = false;
  private recentSemi: number[] = [];

  constructor(config: Partial<LivePitchStabilizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  reset(): void {
    this.stableSemi = null;
    this.pendingJumpSemi = null;
    this.pendingJumpCount = 0;
    this.missingFrameCount = 0;
    this.reacquiring = false;
    this.reacquireSemi = null;
    this.reacquireCount = 0;
    this.voiced = false;
    this.recentSemi = [];
  }

  status(): LivePitchStabilizerStatus {
    return { voiced: this.voiced, reacquiring: this.reacquiring };
  }

  private enterReacquire(): void {
    this.stableSemi = null;
    this.pendingJumpSemi = null;
    this.pendingJumpCount = 0;
    this.recentSemi = [];
    this.reacquiring = true;
    this.reacquireSemi = null;
    this.reacquireCount = 0;
    this.voiced = false;
  }

  private passesReacquireGate(frame: PitchDetectionFrame): boolean {
    return (
      frame.rms >= this.config.reacquireRmsGate &&
      frame.clarity >= this.config.reacquireClarityThreshold
    );
  }

  private acceptReacquireCandidate(correctedSemi: number): boolean {
    if (
      this.reacquireSemi != null &&
      Math.abs(correctedSemi - this.reacquireSemi) <= this.config.reacquireToleranceSemitones
    ) {
      this.reacquireCount += 1;
    } else {
      this.reacquireSemi = correctedSemi;
      this.reacquireCount = 1;
    }

    if (this.reacquireCount < this.config.reacquireFrames) {
      return false;
    }

    this.reacquiring = false;
    this.reacquireSemi = null;
    this.reacquireCount = 0;
    this.recentSemi = [];
    return true;
  }

  stabilize(
    frame: PitchDetectionFrame | null,
    options: LivePitchStabilizerOptions = {},
  ): number | null {
    if (!frame || !isFinitePositive(frame.hz)) {
      this.missingFrameCount += 1;
      if (this.missingFrameCount >= this.config.missingFrameResetCount) {
        this.enterReacquire();
      }
      this.voiced = false;
      return null;
    }

    this.missingFrameCount = 0;
    const targetHz = options.expectedHz ?? options.referenceHz;
    const correctedHz = correctPitchOctave(frame.hz, targetHz);
    const correctedSemi = freqToSemitone(correctedHz);

    if (this.reacquiring) {
      if (!this.passesReacquireGate(frame) || !this.acceptReacquireCandidate(correctedSemi)) {
        this.voiced = false;
        return null;
      }
    }

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
          this.voiced = false;
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
    this.voiced = true;
    return semitoneToFreq(stableSemi);
  }
}

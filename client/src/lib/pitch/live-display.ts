import { MIC_REACQUIRE_CLARITY_THRESHOLD, MIC_REACQUIRE_RMS_GATE } from "@/lib/pitch/constants";
import {
  snapToRefOctave,
  type PitchLiveDisplayCalibrationQuality,
  type PitchLiveDisplayDropReason,
  type PitchLiveDisplayFrame,
  type PitchLiveDisplayOffsetSource,
} from "./state";

export const LIVE_DISPLAY_OFFSET_LOCK_SAMPLES = 32;
const LIVE_DISPLAY_OFFSET_MAX_SAMPLES = 96;
const LIVE_DISPLAY_OFFSET_REJECT_AFTER_SAMPLES = 8;
const LIVE_DISPLAY_OFFSET_OUTLIER_SEMITONES = 2.5;
const LIVE_DISPLAY_JUMP_THRESHOLD_ST = 4;
const LIVE_DISPLAY_CONFIRMED_JUMP_FRAMES = 2;
const LIVE_DISPLAY_JUMP_TOLERANCE_ST = 1.5;
const SAFE_ABSOLUTE_MIDI_MIN = 24;
const SAFE_ABSOLUTE_MIDI_MAX = 96;

export interface LiveDisplayMapperOptions {
  lockSampleCount?: number;
  maxSampleCount?: number;
  fallbackMinClarity?: number;
  fallbackMinRms?: number;
  offsetRejectAfterSamples?: number;
  offsetOutlierSemitones?: number;
  jumpThresholdSemitones?: number;
  confirmedJumpFrames?: number;
  jumpToleranceSemitones?: number;
}

export interface LiveDisplayVoicedInput {
  rawMidi?: number | null | undefined;
  displayMidi?: number | null | undefined;
  registerMidi?: number | null | undefined;
  chartPitch?: number | null;
  guideOffset?: number | null;
  guideSampleCount?: number;
  guideConfidence?: number;
  guideQuality?: PitchLiveDisplayCalibrationQuality | null;
  clarity?: number | null;
  rms?: number | null;
  scored?: boolean;
}

export interface LiveDisplaySilenceInput {
  chartPitch?: number | null;
  guideOffset?: number | null;
  guideSampleCount?: number;
  guideConfidence?: number;
  guideQuality?: PitchLiveDisplayCalibrationQuality | null;
  fallbackPitch?: number | null;
  dropReason?: PitchLiveDisplayDropReason;
}

export interface ChartLanePitchMapping {
  displayPitch: number;
  centsFromExpected: number;
  registerOffset: number;
  expectedRawMidi: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function isProbablyAbsoluteMidi(pitch: number | null): boolean {
  return (
    pitch != null &&
    Number.isFinite(pitch) &&
    pitch >= SAFE_ABSOLUTE_MIDI_MIN &&
    pitch <= SAFE_ABSOLUTE_MIDI_MAX
  );
}

export function foldOffsetToAnchor(offset: number, anchor: number): number {
  return offset - Math.round((offset - anchor) / 12) * 12;
}

export function mapRawMidiToChartLane(
  rawMidi: number,
  chartPitch: number,
  micToChartOffset: number,
  registerMidi: number = rawMidi,
): ChartLanePitchMapping {
  const expectedRawMidi = chartPitch + micToChartOffset;
  const displayPitch = snapToRefOctave(chartPitch, rawMidi - micToChartOffset);

  return {
    displayPitch,
    centsFromExpected: Math.round((displayPitch - chartPitch) * 100),
    registerOffset: Math.round((registerMidi - expectedRawMidi) / 12),
    expectedRawMidi,
  };
}

export class LiveDisplayMapper {
  private samples: number[] = [];
  private anchorOffset: number | null = null;
  private lockedOffset: number | null = null;
  private lastDisplayPitch: number | null = null;
  private pendingJumpPitch: number | null = null;
  private pendingJumpCount = 0;

  private readonly lockSampleCount: number;
  private readonly maxSampleCount: number;
  private readonly fallbackMinClarity: number;
  private readonly fallbackMinRms: number;
  private readonly offsetRejectAfterSamples: number;
  private readonly offsetOutlierSemitones: number;
  private readonly jumpThresholdSemitones: number;
  private readonly confirmedJumpFrames: number;
  private readonly jumpToleranceSemitones: number;

  constructor(options: LiveDisplayMapperOptions = {}) {
    this.lockSampleCount = Math.max(1, options.lockSampleCount ?? LIVE_DISPLAY_OFFSET_LOCK_SAMPLES);
    this.maxSampleCount = Math.max(
      this.lockSampleCount,
      options.maxSampleCount ?? LIVE_DISPLAY_OFFSET_MAX_SAMPLES,
    );
    this.fallbackMinClarity = options.fallbackMinClarity ?? MIC_REACQUIRE_CLARITY_THRESHOLD;
    this.fallbackMinRms = options.fallbackMinRms ?? MIC_REACQUIRE_RMS_GATE;
    this.offsetRejectAfterSamples =
      options.offsetRejectAfterSamples ?? LIVE_DISPLAY_OFFSET_REJECT_AFTER_SAMPLES;
    this.offsetOutlierSemitones =
      options.offsetOutlierSemitones ?? LIVE_DISPLAY_OFFSET_OUTLIER_SEMITONES;
    this.jumpThresholdSemitones = options.jumpThresholdSemitones ?? LIVE_DISPLAY_JUMP_THRESHOLD_ST;
    this.confirmedJumpFrames = options.confirmedJumpFrames ?? LIVE_DISPLAY_CONFIRMED_JUMP_FRAMES;
    this.jumpToleranceSemitones = options.jumpToleranceSemitones ?? LIVE_DISPLAY_JUMP_TOLERANCE_ST;
  }

  reset(): void {
    this.samples = [];
    this.anchorOffset = null;
    this.lockedOffset = null;
    this.lastDisplayPitch = null;
    this.pendingJumpPitch = null;
    this.pendingJumpCount = 0;
  }

  status(): Pick<
    PitchLiveDisplayFrame,
    | "micToChartOffset"
    | "micToChartOffsetSampleCount"
    | "micToChartOffsetLocked"
    | "offsetSource"
    | "userMicOffset"
    | "userMicOffsetSampleCount"
    | "userMicOffsetLocked"
  > {
    const userMicOffset = this.lockedOffset ?? median(this.samples);
    return {
      micToChartOffset: userMicOffset,
      micToChartOffsetSampleCount: this.samples.length,
      micToChartOffsetLocked: this.lockedOffset != null,
      offsetSource: userMicOffset == null ? "none" : "user-mic",
      userMicOffset,
      userMicOffsetSampleCount: this.samples.length,
      userMicOffsetLocked: this.lockedOffset != null,
    };
  }

  mapVoiced({
    rawMidi,
    displayMidi,
    registerMidi,
    chartPitch = null,
    guideOffset = null,
    guideSampleCount = 0,
    guideConfidence = 0,
    guideQuality = null,
    clarity = null,
    rms = null,
    scored = false,
  }: LiveDisplayVoicedInput): PitchLiveDisplayFrame {
    const pitchMidi = isFiniteNumber(displayMidi)
      ? displayMidi
      : isFiniteNumber(rawMidi)
        ? rawMidi
        : null;
    const registerSourceMidi = isFiniteNumber(registerMidi)
      ? registerMidi
      : isFiniteNumber(rawMidi)
        ? rawMidi
        : pitchMidi;

    if (!isFiniteNumber(pitchMidi)) {
      return this.mapSilence({
        chartPitch,
        guideOffset,
        guideSampleCount,
        guideConfidence,
        guideQuality,
        dropReason: "no-display-pitch",
      });
    }

    const safeChartPitch = isFiniteNumber(chartPitch) ? chartPitch : null;
    const safeGuideOffset = isFiniteNumber(guideOffset) ? guideOffset : null;
    let offset: number | null = safeGuideOffset;
    let sampleCount = safeGuideOffset == null ? this.samples.length : Math.max(0, guideSampleCount);
    let locked = safeGuideOffset != null;
    let offsetSource: PitchLiveDisplayOffsetSource =
      safeGuideOffset == null ? "none" : "guide-vocal";

    if (safeChartPitch != null && safeGuideOffset == null) {
      if (isProbablyAbsoluteMidi(safeChartPitch)) {
        offset = 0;
        locked = true;
        sampleCount = 0;
        offsetSource = "none";
      } else {
        this.observeRelativeSample({
          sampleOffset: pitchMidi - safeChartPitch,
          clarity,
          rms,
        });
        offset = this.lockedOffset ?? median(this.samples);
        sampleCount = this.samples.length;
        locked = this.lockedOffset != null;
        offsetSource = offset == null ? "none" : "user-mic";
      }
    }

    if (safeChartPitch != null && offset != null) {
      const mapping = mapRawMidiToChartLane(
        pitchMidi,
        safeChartPitch,
        offset,
        registerSourceMidi ?? pitchMidi,
      );
      const displayPitch = locked
        ? mapping.displayPitch
        : snapToRefOctave(safeChartPitch, pitchMidi);
      const jumpOutlier = this.rejectDisplayJump(displayPitch);
      if (jumpOutlier) {
        return this.heldOutlier({
          chartPitch: safeChartPitch,
          expectedRawMidi: mapping.expectedRawMidi,
          offset,
          sampleCount,
          locked,
          offsetSource,
          guideOffset: safeGuideOffset,
          guideSampleCount,
          guideConfidence,
          guideQuality,
          dropReason: "display-outlier",
        });
      }

      this.acceptDisplayPitch(displayPitch);

      return {
        displayPitch,
        centsFromExpected: locked ? mapping.centsFromExpected : null,
        registerOffset: locked ? mapping.registerOffset : null,
        kind: "voiced",
        expectedChartPitch: safeChartPitch,
        expectedRawMidi: mapping.expectedRawMidi,
        offsetSource,
        micToChartOffset: offset,
        micToChartOffsetSampleCount: sampleCount,
        micToChartOffsetLocked: locked,
        guideVocalOffset: safeGuideOffset,
        guideVocalOffsetSampleCount: guideSampleCount,
        guideVocalConfidence: guideConfidence,
        guideVocalQuality: guideQuality,
        userMicOffset: this.lockedOffset ?? median(this.samples),
        userMicOffsetSampleCount: this.samples.length,
        userMicOffsetLocked: this.lockedOffset != null,
        scored,
      };
    }

    const offsetStatus = this.status();
    const currentOffset = safeGuideOffset ?? offsetStatus.micToChartOffset;
    const displayPitch =
      currentOffset == null
        ? pitchMidi
        : this.placeGapPitch(pitchMidi - currentOffset, this.lastDisplayPitch);
    const jumpOutlier = this.rejectDisplayJump(displayPitch);
    if (jumpOutlier) {
      return this.heldOutlier({
        chartPitch: null,
        expectedRawMidi: null,
        offset: currentOffset ?? null,
        sampleCount:
          safeGuideOffset == null
            ? (offsetStatus.micToChartOffsetSampleCount ?? 0)
            : guideSampleCount,
        locked: safeGuideOffset != null || (offsetStatus.micToChartOffsetLocked ?? false),
        offsetSource:
          safeGuideOffset != null
            ? "guide-vocal"
            : offsetStatus.micToChartOffset == null
              ? "none"
              : "user-mic",
        guideOffset: safeGuideOffset,
        guideSampleCount,
        guideConfidence,
        guideQuality,
        dropReason: "display-outlier",
      });
    }
    this.acceptDisplayPitch(displayPitch);

    return {
      displayPitch,
      centsFromExpected: null,
      registerOffset: null,
      kind: "voiced",
      expectedChartPitch: null,
      expectedRawMidi: null,
      offsetSource:
        safeGuideOffset != null
          ? "guide-vocal"
          : offsetStatus.micToChartOffset == null
            ? "none"
            : "user-mic",
      micToChartOffset: currentOffset,
      micToChartOffsetSampleCount:
        safeGuideOffset == null ? offsetStatus.micToChartOffsetSampleCount : guideSampleCount,
      micToChartOffsetLocked: safeGuideOffset != null || offsetStatus.micToChartOffsetLocked,
      guideVocalOffset: safeGuideOffset,
      guideVocalOffsetSampleCount: guideSampleCount,
      guideVocalConfidence: guideConfidence,
      guideVocalQuality: guideQuality,
      userMicOffset: offsetStatus.userMicOffset ?? null,
      userMicOffsetSampleCount: offsetStatus.userMicOffsetSampleCount ?? 0,
      userMicOffsetLocked: offsetStatus.userMicOffsetLocked ?? false,
      scored,
    };
  }

  mapSilence({
    chartPitch = null,
    guideOffset = null,
    guideSampleCount = 0,
    guideConfidence = 0,
    guideQuality = null,
    fallbackPitch = null,
    dropReason = "unvoiced",
  }: LiveDisplaySilenceInput = {}): PitchLiveDisplayFrame {
    const safeChartPitch = isFiniteNumber(chartPitch) ? chartPitch : null;
    const safeFallbackPitch = isFiniteNumber(fallbackPitch) ? fallbackPitch : null;
    const displayPitch = this.lastDisplayPitch ?? safeChartPitch ?? safeFallbackPitch ?? 60;
    const offsetStatus = this.status();
    const safeGuideOffset = isFiniteNumber(guideOffset) ? guideOffset : null;

    this.lastDisplayPitch = displayPitch;

    return {
      displayPitch,
      centsFromExpected: null,
      registerOffset: null,
      kind: "silence",
      expectedChartPitch: safeChartPitch,
      expectedRawMidi:
        safeChartPitch != null && safeGuideOffset != null ? safeChartPitch + safeGuideOffset : null,
      dropReason,
      offsetSource:
        safeGuideOffset != null
          ? "guide-vocal"
          : offsetStatus.micToChartOffset == null
            ? "none"
            : "user-mic",
      micToChartOffset: safeGuideOffset ?? offsetStatus.micToChartOffset,
      micToChartOffsetSampleCount:
        safeGuideOffset == null ? offsetStatus.micToChartOffsetSampleCount : guideSampleCount,
      micToChartOffsetLocked: safeGuideOffset != null || offsetStatus.micToChartOffsetLocked,
      guideVocalOffset: safeGuideOffset,
      guideVocalOffsetSampleCount: guideSampleCount,
      guideVocalConfidence: guideConfidence,
      guideVocalQuality: guideQuality,
      userMicOffset: offsetStatus.userMicOffset ?? null,
      userMicOffsetSampleCount: offsetStatus.userMicOffsetSampleCount ?? 0,
      userMicOffsetLocked: offsetStatus.userMicOffsetLocked ?? false,
      scored: false,
    };
  }

  private observeRelativeSample({
    sampleOffset,
    clarity,
    rms,
  }: {
    sampleOffset: number;
    clarity: number | null | undefined;
    rms: number | null | undefined;
  }): void {
    if (!Number.isFinite(sampleOffset) || this.lockedOffset != null) return;
    if (!isFiniteNumber(clarity) || clarity < this.fallbackMinClarity) return;
    if (!isFiniteNumber(rms) || rms < this.fallbackMinRms) return;

    const anchor = this.anchorOffset ?? median(this.samples) ?? sampleOffset;
    const folded = foldOffsetToAnchor(sampleOffset, anchor);
    const provisional = median(this.samples);
    if (
      provisional != null &&
      this.samples.length >= this.offsetRejectAfterSamples &&
      Math.abs(folded - provisional) > this.offsetOutlierSemitones
    ) {
      return;
    }

    this.anchorOffset ??= folded;
    this.samples.push(folded);

    while (this.samples.length > this.maxSampleCount) {
      this.samples.shift();
    }

    if (this.samples.length >= this.lockSampleCount) {
      this.lockedOffset = median(this.samples);
    }
  }

  private placeGapPitch(pitch: number, fallback: number | null): number {
    return fallback == null || !Number.isFinite(fallback)
      ? pitch
      : snapToRefOctave(fallback, pitch);
  }

  private rejectDisplayJump(displayPitch: number): boolean {
    if (!Number.isFinite(displayPitch) || this.lastDisplayPitch == null) return false;

    const jump = Math.abs(displayPitch - this.lastDisplayPitch);
    if (jump <= this.jumpThresholdSemitones) {
      this.pendingJumpPitch = null;
      this.pendingJumpCount = 0;
      return false;
    }

    if (
      this.pendingJumpPitch != null &&
      Math.abs(displayPitch - this.pendingJumpPitch) <= this.jumpToleranceSemitones
    ) {
      this.pendingJumpCount += 1;
    } else {
      this.pendingJumpPitch = displayPitch;
      this.pendingJumpCount = 1;
    }

    return this.pendingJumpCount < this.confirmedJumpFrames;
  }

  private acceptDisplayPitch(displayPitch: number): void {
    this.lastDisplayPitch = displayPitch;
    this.pendingJumpPitch = null;
    this.pendingJumpCount = 0;
  }

  private heldOutlier({
    chartPitch,
    expectedRawMidi,
    offset,
    sampleCount,
    locked,
    offsetSource,
    guideOffset,
    guideSampleCount,
    guideConfidence,
    guideQuality,
    dropReason,
  }: {
    chartPitch: number | null;
    expectedRawMidi: number | null;
    offset: number | null;
    sampleCount: number;
    locked: boolean;
    offsetSource: PitchLiveDisplayOffsetSource;
    guideOffset: number | null;
    guideSampleCount: number;
    guideConfidence: number;
    guideQuality: PitchLiveDisplayCalibrationQuality | null;
    dropReason: PitchLiveDisplayDropReason;
  }): PitchLiveDisplayFrame {
    const offsetStatus = this.status();

    return {
      displayPitch: this.lastDisplayPitch ?? chartPitch ?? 60,
      centsFromExpected: null,
      registerOffset: null,
      kind: "silence",
      expectedChartPitch: chartPitch,
      expectedRawMidi,
      dropReason,
      offsetSource,
      micToChartOffset: offset,
      micToChartOffsetSampleCount: sampleCount,
      micToChartOffsetLocked: locked,
      guideVocalOffset: guideOffset,
      guideVocalOffsetSampleCount: guideSampleCount,
      guideVocalConfidence: guideConfidence,
      guideVocalQuality: guideQuality,
      userMicOffset: offsetStatus.userMicOffset ?? null,
      userMicOffsetSampleCount: offsetStatus.userMicOffsetSampleCount ?? 0,
      userMicOffsetLocked: offsetStatus.userMicOffsetLocked ?? false,
      scored: false,
    };
  }
}

import { snapToRefOctave, type PitchLiveDisplayFrame } from "./state";

export const LIVE_DISPLAY_OFFSET_LOCK_SAMPLES = 8;
const LIVE_DISPLAY_OFFSET_MAX_SAMPLES = 40;
const SAFE_ABSOLUTE_MIDI_MIN = 24;
const SAFE_ABSOLUTE_MIDI_MAX = 96;

export interface LiveDisplayMapperOptions {
  lockSampleCount?: number;
  maxSampleCount?: number;
}

export interface LiveDisplayVoicedInput {
  rawMidi: number | null | undefined;
  chartPitch?: number | null;
  guideOffset?: number | null;
  guideSampleCount?: number;
  scored?: boolean;
}

export interface LiveDisplaySilenceInput {
  chartPitch?: number | null;
  guideOffset?: number | null;
  guideSampleCount?: number;
  fallbackPitch?: number | null;
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
): ChartLanePitchMapping {
  const expectedRawMidi = chartPitch + micToChartOffset;
  const displayPitch = snapToRefOctave(chartPitch, rawMidi - micToChartOffset);

  return {
    displayPitch,
    centsFromExpected: Math.round((displayPitch - chartPitch) * 100),
    registerOffset: Math.round((rawMidi - expectedRawMidi) / 12),
    expectedRawMidi,
  };
}

export class LiveDisplayMapper {
  private samples: number[] = [];
  private anchorOffset: number | null = null;
  private lockedOffset: number | null = null;
  private lastDisplayPitch: number | null = null;

  private readonly lockSampleCount: number;
  private readonly maxSampleCount: number;

  constructor(options: LiveDisplayMapperOptions = {}) {
    this.lockSampleCount = Math.max(1, options.lockSampleCount ?? LIVE_DISPLAY_OFFSET_LOCK_SAMPLES);
    this.maxSampleCount = Math.max(
      this.lockSampleCount,
      options.maxSampleCount ?? LIVE_DISPLAY_OFFSET_MAX_SAMPLES,
    );
  }

  reset(): void {
    this.samples = [];
    this.anchorOffset = null;
    this.lockedOffset = null;
    this.lastDisplayPitch = null;
  }

  status(): Pick<
    PitchLiveDisplayFrame,
    "micToChartOffset" | "micToChartOffsetSampleCount" | "micToChartOffsetLocked"
  > {
    return {
      micToChartOffset: this.lockedOffset ?? median(this.samples),
      micToChartOffsetSampleCount: this.samples.length,
      micToChartOffsetLocked: this.lockedOffset != null,
    };
  }

  mapVoiced({
    rawMidi,
    chartPitch = null,
    guideOffset = null,
    guideSampleCount = 0,
    scored = false,
  }: LiveDisplayVoicedInput): PitchLiveDisplayFrame {
    if (!isFiniteNumber(rawMidi)) {
      return this.mapSilence({ chartPitch, guideOffset, guideSampleCount });
    }

    const safeChartPitch = isFiniteNumber(chartPitch) ? chartPitch : null;
    const safeGuideOffset = isFiniteNumber(guideOffset) ? guideOffset : null;
    let offset: number | null = safeGuideOffset;
    let sampleCount = safeGuideOffset == null ? this.samples.length : Math.max(0, guideSampleCount);
    let locked = safeGuideOffset != null;

    if (safeChartPitch != null && safeGuideOffset == null) {
      if (isProbablyAbsoluteMidi(safeChartPitch)) {
        offset = 0;
        locked = true;
        sampleCount = 0;
      } else {
        this.observeRelativeSample(rawMidi - safeChartPitch);
        offset = this.lockedOffset ?? median(this.samples);
        sampleCount = this.samples.length;
        locked = this.lockedOffset != null;
      }
    }

    if (safeChartPitch != null && offset != null) {
      const mapping = mapRawMidiToChartLane(rawMidi, safeChartPitch, offset);
      const displayPitch = locked ? mapping.displayPitch : snapToRefOctave(safeChartPitch, rawMidi);
      this.lastDisplayPitch = displayPitch;

      return {
        displayPitch,
        centsFromExpected: locked ? mapping.centsFromExpected : null,
        registerOffset: locked ? mapping.registerOffset : null,
        kind: "voiced",
        expectedChartPitch: safeChartPitch,
        expectedRawMidi: mapping.expectedRawMidi,
        micToChartOffset: offset,
        micToChartOffsetSampleCount: sampleCount,
        micToChartOffsetLocked: locked,
        scored,
      };
    }

    const offsetStatus = this.status();
    const currentOffset = safeGuideOffset ?? offsetStatus.micToChartOffset;
    const displayPitch =
      currentOffset == null
        ? rawMidi
        : this.placeGapPitch(rawMidi - currentOffset, this.lastDisplayPitch);
    this.lastDisplayPitch = displayPitch;

    return {
      displayPitch,
      centsFromExpected: null,
      registerOffset: null,
      kind: "voiced",
      expectedChartPitch: null,
      expectedRawMidi: null,
      micToChartOffset: currentOffset,
      micToChartOffsetSampleCount:
        safeGuideOffset == null ? offsetStatus.micToChartOffsetSampleCount : guideSampleCount,
      micToChartOffsetLocked: safeGuideOffset != null || offsetStatus.micToChartOffsetLocked,
      scored,
    };
  }

  mapSilence({
    chartPitch = null,
    guideOffset = null,
    guideSampleCount = 0,
    fallbackPitch = null,
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
      micToChartOffset: safeGuideOffset ?? offsetStatus.micToChartOffset,
      micToChartOffsetSampleCount:
        safeGuideOffset == null ? offsetStatus.micToChartOffsetSampleCount : guideSampleCount,
      micToChartOffsetLocked: safeGuideOffset != null || offsetStatus.micToChartOffsetLocked,
      scored: false,
    };
  }

  private observeRelativeSample(sampleOffset: number): void {
    if (!Number.isFinite(sampleOffset) || this.lockedOffset != null) return;

    const anchor = this.anchorOffset ?? median(this.samples) ?? sampleOffset;
    const folded = foldOffsetToAnchor(sampleOffset, anchor);
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
}

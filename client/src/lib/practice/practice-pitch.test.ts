import { describe, expect, it } from "vitest";

import { semitoneToFreq, type PitchSeries } from "@/lib/pitch/state";
import type { Segment } from "@/types/Transcript";
import {
  buildRawLiveVoiceTrace,
  buildPracticeLaneModel,
  clampPracticeRange,
  computeChartPitchCalibration,
  computePhraseMatchQuality,
  computePitchCentsDifference,
  estimateMicLatencyAdjustment,
  extractChartNotes,
  filterPitchSeriesSince,
  findPracticeSegmentIndex,
  isPracticeSegmentDisplayVisible,
  practicePitchToY,
  practiceTimeToX,
  shouldConnectTracePoints,
  type PracticeExpectedNote,
  type PracticeTracePoint,
  MAX_PRACTICE_RANGE,
  MIN_PRACTICE_RANGE,
} from "./practice-pitch";

const segments: Segment[] = [
  {
    text: "first line",
    start: 1,
    end: 3,
    words: [
      { word: "first", start: 1, end: 2, pitch: 10 },
      { word: "line", start: 2, end: 3, pitch: 12 },
    ],
  },
  {
    text: "second line",
    start: 5,
    end: 7,
    words: [{ word: "second", start: 5, end: 7, pitch: 14 }],
  },
];

const series: PitchSeries = {
  times: [1.1, 1.7, 2.5, 4.5, 5.5],
  refPitches: [220, 220, 220, 220, 220],
  userPitches: [220, 233.08, null, 220, 246.94],
  similarities: [1, 0.8, 0, 0.25, 0.5],
};

function withLiveDisplay(
  base: PitchSeries,
  displayPitch: (number | null)[],
  options: {
    cents?: (number | null)[];
    register?: (number | null)[];
    kind?: ("voiced" | "silence" | null)[];
    expectedChart?: (number | null)[];
    expectedRaw?: (number | null)[];
    dropReason?: NonNullable<PitchSeries["liveDropReason"]>;
    offsetSource?: NonNullable<PitchSeries["liveOffsetSource"]>;
    offset?: (number | null)[];
    sampleCount?: number[];
    locked?: boolean[];
    guideOffset?: (number | null)[];
    guideSampleCount?: number[];
    guideConfidence?: number[];
    guideQuality?: NonNullable<PitchSeries["guideVocalQualityAtFrame"]>;
    userOffset?: (number | null)[];
    userSampleCount?: number[];
    userLocked?: boolean[];
    scored?: boolean[];
  } = {},
): PitchSeries {
  const length = base.times.length;
  const fill = <T>(value: T): T[] => Array.from({ length }, () => value);

  return {
    ...base,
    liveDisplayPitch: displayPitch,
    liveCentsFromExpected: options.cents ?? fill(null),
    liveRegisterOffset: options.register ?? fill(null),
    liveKind: options.kind ?? displayPitch.map((pitch) => (pitch == null ? "silence" : "voiced")),
    liveDropReason: options.dropReason ?? fill(null),
    liveOffsetSource: options.offsetSource ?? fill(null),
    expectedChartPitchAtFrame: options.expectedChart ?? fill(null),
    liveExpectedRawMidi: options.expectedRaw ?? fill(null),
    micToChartOffsetAtFrame: options.offset ?? fill(null),
    micToChartOffsetSampleCount: options.sampleCount ?? fill(0),
    micToChartOffsetLocked: options.locked ?? fill(false),
    guideVocalOffsetAtFrame: options.guideOffset ?? fill(null),
    guideVocalOffsetSampleCount: options.guideSampleCount ?? fill(0),
    guideVocalConfidenceAtFrame: options.guideConfidence ?? fill(0),
    guideVocalQualityAtFrame: options.guideQuality ?? fill(null),
    userMicOffsetAtFrame: options.userOffset ?? fill(null),
    userMicOffsetSampleCount: options.userSampleCount ?? fill(0),
    userMicOffsetLocked: options.userLocked ?? fill(false),
    livePointScored: options.scored ?? fill(false),
  };
}

describe("practice pitch adapter", () => {
  it("selects the active or nearest phrase", () => {
    expect(findPracticeSegmentIndex(segments, 2)).toBe(0);
    expect(findPracticeSegmentIndex(segments, 4.7)).toBe(1);
    expect(findPracticeSegmentIndex(segments, 9)).toBe(1);
    expect(findPracticeSegmentIndex([], 2)).toBe(-1);
  });

  it("prefers the next phrase lead-in over the previous phrase linger", () => {
    const closeSegments: Segment[] = [
      { text: "previous", start: 0, end: 10, words: [] },
      { text: "next", start: 10.25, end: 12, words: [] },
    ];

    expect(findPracticeSegmentIndex(closeSegments, 9.5)).toBe(1);
  });

  it("supports exact USDX lyric phrase timing and display offsets", () => {
    const closeSegments: Segment[] = [
      { text: "previous", start: 0, end: 10, words: [] },
      { text: "next", start: 10.25, end: 12, words: [] },
    ];

    expect(findPracticeSegmentIndex(closeSegments, 9.5, 0, 0)).toBe(0);
    expect(findPracticeSegmentIndex(closeSegments, 10.25, 0, 0)).toBe(1);
    expect(findPracticeSegmentIndex(closeSegments, 10.4, 0.2, 0)).toBe(0);
    expect(isPracticeSegmentDisplayVisible(closeSegments[1], 10.2, 0, 0)).toBe(false);
    expect(isPracticeSegmentDisplayVisible(closeSegments[1], 10.25, 0, 0)).toBe(true);
    expect(isPracticeSegmentDisplayVisible(closeSegments[1], 10.4, 0.2, 0)).toBe(false);
  });

  it("extracts chart notes from transcript word pitches", () => {
    expect(extractChartNotes(segments)).toEqual([
      {
        start: 1,
        end: 2,
        pitch: 10,
        label: "first",
        source: "chart",
        estimated: undefined,
      },
      {
        start: 2,
        end: 3,
        pitch: 12,
        label: "line",
        source: "chart",
        estimated: undefined,
      },
      {
        start: 5,
        end: 7,
        pitch: 14,
        label: "second",
        source: "chart",
        estimated: undefined,
      },
    ]);
  });

  it("averages phrase match quality from samples inside the phrase", () => {
    expect(computePhraseMatchQuality(series, segments[0])).toBe(90);
  });

  it("falls back to recent usable samples when the phrase has no samples", () => {
    const emptySegment: Segment = { text: "gap", start: 20, end: 21, words: [] };

    expect(computePhraseMatchQuality(series, emptySegment)).toBe(64);
  });

  it("clamps the vertical practice range", () => {
    expect(clampPracticeRange(3)).toBe(MIN_PRACTICE_RANGE);
    expect(clampPracticeRange(99)).toBe(MAX_PRACTICE_RANGE);
    expect(clampPracticeRange(25.4)).toBe(25);
  });

  it("uses vocals reference data when chart notes are unavailable", () => {
    const noChartSegments: Segment[] = [
      {
        text: "plain line",
        start: 1,
        end: 3,
        words: [{ word: "plain", start: 1, end: 3 }],
      },
    ];

    const model = buildPracticeLaneModel({
      segments: noChartSegments,
      series,
      currentTime: 2,
    });

    expect(model.expectedSource).toBe("reference");
    expect(model.referenceTrace.length).toBeGreaterThan(0);
    expect(model.vertical.source).toBe("stable-fallback");
    expect(model.missingChartData.absoluteNoteHz).toBe(true);
  });

  it("maps practice time to the lane x coordinate", () => {
    expect(practiceTimeToX({ time: 5, currentTime: 10, width: 130 })).toBeCloseTo(0);
    expect(practiceTimeToX({ time: 10, currentTime: 10, width: 130 })).toBeCloseTo(50);
    expect(practiceTimeToX({ time: 18, currentTime: 10, width: 130 })).toBeCloseTo(130);
  });

  it("maps practice pitch to the lane y coordinate", () => {
    const vertical = {
      min: 50,
      max: 74,
      center: 62,
      range: 24,
      source: "chart" as const,
      manualRange: true,
    };

    expect(practicePitchToY(74, vertical, 100, 10)).toBeCloseTo(10);
    expect(practicePitchToY(62, vertical, 100, 10)).toBeCloseTo(50);
    expect(practicePitchToY(50, vertical, 100, 10)).toBeCloseTo(90);
  });

  it("does not connect trace points across explicit discontinuities", () => {
    const previous: PracticeTracePoint = {
      time: 1,
      pitch: 60,
      similarity: 1,
      hasReference: true,
    };
    const point: PracticeTracePoint = {
      time: 1.05,
      pitch: 60.2,
      similarity: 1,
      hasReference: true,
      breakBefore: true,
    };

    expect(shouldConnectTracePoints(previous, point)).toBe(false);
  });

  it("does not connect trace points across short silence gaps", () => {
    const previous: PracticeTracePoint = {
      time: 1,
      pitch: 60,
      similarity: 1,
      hasReference: true,
    };
    const point: PracticeTracePoint = {
      time: 1.2,
      pitch: 60.2,
      similarity: 1,
      hasReference: true,
    };

    expect(shouldConnectTracePoints(previous, point)).toBe(false);
  });

  it("aligns live mic pitch to UltraStar chart pitch with guide-vocal calibration", () => {
    const chartNotes: PracticeExpectedNote[] = [
      { start: 1, end: 2, pitch: 0, label: "A", source: "chart" },
      { start: 2, end: 3, pitch: 2, label: "B", source: "chart" },
    ];
    const calibratedSeries: PitchSeries = {
      times: [1.25, 2.25],
      refPitches: [semitoneToFreq(60), semitoneToFreq(62)],
      userPitches: [semitoneToFreq(60), semitoneToFreq(74)],
      similarities: [1, 1],
    };

    const model = buildPracticeLaneModel({
      segments: [
        {
          text: "calibrated",
          start: 1,
          end: 3,
          words: chartNotes.map((note) => ({
            word: note.label,
            start: note.start,
            end: note.end,
            pitch: note.pitch,
          })),
        },
      ],
      series: calibratedSeries,
      currentTime: 2.25,
    });

    expect(computeChartPitchCalibration(calibratedSeries, chartNotes).midiOffset).toBeCloseTo(60);
    expect(model.userTrace[0].pitch).toBeCloseTo(0);
    expect(model.userTrace[1].pitch).toBeCloseTo(2);
    expect(model.latestCentsDifference).toBe(0);
  });

  it("plots unlocked live user pitch before chart pitch lock is available", () => {
    const chartOnlySeries: PitchSeries = {
      times: [1.25],
      refPitches: [null],
      userPitches: [semitoneToFreq(72)],
      similarities: [0],
    };

    const model = buildPracticeLaneModel({
      segments: [
        {
          text: "relative",
          start: 1,
          end: 2,
          words: [{ word: "relative", start: 1, end: 2, pitch: 0 }],
        },
      ],
      series: chartOnlySeries,
      currentTime: 1.25,
    });

    expect(model.expectedSource).toBe("chart");
    expect(model.pitchCalibration.midiOffset).toBeNull();
    expect(model.userTrace).toHaveLength(1);
    expect(model.userTrace[0].pitch).toBeCloseTo(0);
  });

  it("uses a stable chart-derived vertical range without live mic pitch", () => {
    const model = buildPracticeLaneModel({
      segments: [
        {
          text: "relative",
          start: 1,
          end: 2,
          words: [{ word: "relative", start: 1, end: 2, pitch: 0 }],
        },
      ],
      series: {
        times: [1.25],
        refPitches: [null],
        userPitches: [semitoneToFreq(67)],
        rawMicHz: [semitoneToFreq(67)],
        rawMicVoiced: [true],
        similarities: [0],
      },
      currentTime: 1.25,
      semitoneRange: 12,
    });

    expect(model.userTrace).toHaveLength(1);
    expect(model.userTrace[0].pitch).toBeCloseTo(-5);
    expect(model.vertical.source).toBe("chart");
    expect(model.vertical.center).toBe(0);
    expect(model.vertical.range).toBe(12);
    expect(model.vertical.min).toBe(-6);
    expect(model.vertical.max).toBe(6);
  });

  it("keeps vertical range unchanged as playback time changes", () => {
    const stableSegments: Segment[] = [
      {
        text: "wide",
        start: 1,
        end: 12,
        words: [
          { word: "low", start: 1, end: 2, pitch: 60 },
          { word: "high", start: 10, end: 11, pitch: 72 },
        ],
      },
    ];
    const stableSeries: PitchSeries = {
      times: [1.5, 10.5],
      refPitches: [null, null],
      userPitches: [null, null],
      rawMicHz: [semitoneToFreq(84), semitoneToFreq(48)],
      rawMicVoiced: [true, true],
      similarities: [0, 0],
    };

    const early = buildPracticeLaneModel({
      segments: stableSegments,
      series: stableSeries,
      currentTime: 1.5,
      semitoneRange: 12,
    });
    const late = buildPracticeLaneModel({
      segments: stableSegments,
      series: stableSeries,
      currentTime: 10.5,
      semitoneRange: 12,
    });

    expect(early.vertical).toEqual(late.vertical);
    expect(early.vertical).toMatchObject({
      source: "chart",
      center: 66,
      range: 18,
      manualRange: false,
    });
  });

  it("changes stable vertical range only when the selected range changes", () => {
    const stableSegments: Segment[] = [
      {
        text: "wide",
        start: 1,
        end: 12,
        words: [
          { word: "low", start: 1, end: 2, pitch: 60 },
          { word: "high", start: 10, end: 11, pitch: 72 },
        ],
      },
    ];
    const stableSeries: PitchSeries = {
      times: [],
      refPitches: [],
      userPitches: [],
      similarities: [],
    };

    const compact = buildPracticeLaneModel({
      segments: stableSegments,
      series: stableSeries,
      currentTime: 1.5,
      semitoneRange: 12,
    });
    const expanded = buildPracticeLaneModel({
      segments: stableSegments,
      series: stableSeries,
      currentTime: 1.5,
      semitoneRange: 24,
    });

    expect(compact.vertical.range).toBe(18);
    expect(compact.vertical.manualRange).toBe(false);
    expect(expanded.vertical.range).toBe(24);
    expect(expanded.vertical.manualRange).toBe(true);
    expect(expanded.vertical.center).toBe(compact.vertical.center);
  });

  it("builds the main live voice trace from raw mic pitch instead of scoring pitch", () => {
    const model = buildPracticeLaneModel({
      segments: [
        {
          text: "relative",
          start: 1,
          end: 2,
          words: [{ word: "A", start: 1, end: 2, pitch: 69 }],
        },
      ],
      series: withLiveDisplay(
        {
          times: [1.25],
          refPitches: [semitoneToFreq(69)],
          userPitches: [semitoneToFreq(60)],
          rawMicHz: [semitoneToFreq(57)],
          rawMicMidi: [57],
          rawMicClarity: [0.9],
          rawMicRms: [0.05],
          rawMicVoiced: [true],
          similarities: [0],
        },
        [69],
        {
          cents: [0],
          register: [-1],
          expectedChart: [69],
          expectedRaw: [69],
          offset: [0],
          locked: [true],
        },
      ),
      currentTime: 1.25,
    });

    expect(model.userTrace[0].pitch).toBeCloseTo(72);
    expect(model.liveVoiceTrace).toBe(model.rawLiveVoiceTrace);
    expect(model.liveVoiceTrace[0].displayMidi).toBeCloseTo(69);
    expect(model.liveVoiceTrace[0].pitch).toBeCloseTo(69);
    expect(model.liveVoiceTrace[0].rawMidi).toBeCloseTo(57);
    expect(model.liveVoiceTrace[0].expectedMidi).toBe(69);
    expect(model.liveVoiceTrace[0].expectedChartPitch).toBe(69);
    expect(model.liveVoiceTrace[0].absoluteOctaveOffsetFromExpected).toBe(-1);
    expect(model.chartRelativeVoiceTrace[0].displayMidi).toBeCloseTo(69);
    expect(model.chartRelativeVoiceTrace[0].absoluteOctaveOffsetFromExpected).toBe(-1);
    expect(model.latestLiveCentsDifference).toBe(0);
  });

  it("keeps the raw live voice trace visible during chart gaps", () => {
    const model = buildPracticeLaneModel({
      segments: [
        {
          text: "relative",
          start: 1,
          end: 2,
          words: [{ word: "A", start: 1, end: 2, pitch: 69 }],
        },
      ],
      series: withLiveDisplay(
        {
          times: [2.5],
          refPitches: [null],
          userPitches: [null],
          rawMicHz: [semitoneToFreq(69)],
          rawMicMidi: [69],
          rawMicClarity: [0.9],
          rawMicRms: [0.05],
          rawMicVoiced: [true],
          similarities: [0],
        },
        [69],
      ),
      currentTime: 2.5,
    });

    expect(model.liveVoiceTrace).toHaveLength(1);
    expect(model.liveVoiceTrace[0].displayMidi).toBeCloseTo(69);
    expect(model.chartRelativeVoiceTrace).toHaveLength(0);
  });

  it("keeps live voice trace connected across brief invalid frames", () => {
    const model = buildPracticeLaneModel({
      segments: [
        {
          text: "relative",
          start: 1,
          end: 2,
          words: [{ word: "A", start: 1, end: 2, pitch: 69 }],
        },
      ],
      series: withLiveDisplay(
        {
          times: [1, 1.03, 1.06],
          refPitches: [semitoneToFreq(69), semitoneToFreq(69), semitoneToFreq(69)],
          userPitches: [semitoneToFreq(69), null, semitoneToFreq(69)],
          rawMicHz: [semitoneToFreq(69), null, semitoneToFreq(69)],
          rawMicMidi: [69, null, 69],
          rawMicClarity: [0.9, null, 0.9],
          rawMicRms: [0.05, 0.001, 0.05],
          rawMicVoiced: [true, false, true],
          similarities: [1, 0, 1],
        },
        [69, 69, 69],
        {
          kind: ["voiced", "silence", "voiced"],
          cents: [0, null, 0],
          expectedChart: [69, 69, 69],
          expectedRaw: [69, null, 69],
          locked: [true, true, true],
        },
      ),
      currentTime: 1.06,
    });

    expect(model.liveVoiceTrace).toHaveLength(3);
    expect(model.liveVoiceTrace[1].kind).toBe("silence");
    expect(model.liveVoiceTrace[1].displayMidi).toBeCloseTo(69);
    expect(model.liveVoiceTrace[2].traceBreak).toBe(false);
  });

  it("preserves raw pitch contour instead of snapping every point to the expected note", () => {
    const model = buildPracticeLaneModel({
      segments: [
        {
          text: "relative",
          start: 1,
          end: 2,
          words: [{ word: "A", start: 1, end: 2, pitch: 69 }],
        },
      ],
      series: withLiveDisplay(
        {
          times: [1, 1.03, 1.06],
          refPitches: [semitoneToFreq(69), semitoneToFreq(69), semitoneToFreq(69)],
          userPitches: [semitoneToFreq(69), semitoneToFreq(70), semitoneToFreq(71)],
          rawMicHz: [semitoneToFreq(57), semitoneToFreq(58), semitoneToFreq(59)],
          rawMicMidi: [57, 58, 59],
          rawMicClarity: [0.9, 0.9, 0.9],
          rawMicRms: [0.05, 0.05, 0.05],
          rawMicVoiced: [true, true, true],
          similarities: [1, 0.8, 0.6],
        },
        [69, 70, 71],
        {
          cents: [0, 100, 200],
          register: [-1, -1, -1],
          expectedChart: [69, 69, 69],
          expectedRaw: [69, 69, 69],
          locked: [true, true, true],
        },
      ),
      currentTime: 1.06,
    });

    expect(model.rawUserTrace).toHaveLength(3);
    expect(model.liveVoiceTrace).toHaveLength(3);
    expect(model.liveVoiceTrace.map((point) => Math.round(point.displayMidi))).toEqual([
      69, 70, 71,
    ]);
    expect(model.liveVoiceTrace.map((point) => point.centsFromExpected)).toEqual([0, 100, 200]);
  });

  it("maps absolute mic MIDI into UltraStar relative chart-lane pitch", () => {
    const model = buildPracticeLaneModel({
      segments: [
        {
          text: "relative",
          start: 1,
          end: 3,
          words: [
            { word: "C", start: 1, end: 2, pitch: 0 },
            { word: "D", start: 2, end: 3, pitch: 2 },
          ],
        },
      ],
      series: withLiveDisplay(
        {
          times: [1.25, 2.25],
          refPitches: [null, null],
          userPitches: [null, null],
          rawMicHz: [semitoneToFreq(60), semitoneToFreq(62)],
          rawMicMidi: [60, 62],
          rawMicClarity: [0.9, 0.9],
          rawMicRms: [0.05, 0.05],
          rawMicVoiced: [true, true],
          similarities: [0, 0],
        },
        [0, 2],
        {
          cents: [0, 0],
          register: [0, 0],
          expectedChart: [0, 2],
          expectedRaw: [60, 62],
          offset: [60, 60],
          sampleCount: [8, 8],
          locked: [true, true],
        },
      ),
      currentTime: 1.25,
      semitoneRange: 12,
    });

    expect(model.liveVoiceTrace.map((point) => Math.round(point.rawMidi ?? 0))).toEqual([60, 62]);
    expect(model.liveVoiceTrace.map((point) => Math.round(point.pitch))).toEqual([0, 2]);
    expect(model.liveVoiceTrace.map((point) => Math.round(point.displayMidi))).toEqual([0, 2]);
    expect(model.liveVoiceTrace.map((point) => point.centsFromExpected)).toEqual([0, 0]);
    expect(model.liveVoiceTrace[0].expectedMidi).toBe(60);
    expect(model.liveVoiceTrace[0].expectedChartPitch).toBe(0);
    expect(model.liveVoiceTrace[0].absoluteOctaveOffsetFromExpected).toBe(0);
  });

  it("does not use absolute MIDI directly as the Y-position for relative chart notes", () => {
    const model = buildPracticeLaneModel({
      segments: [
        {
          text: "relative",
          start: 1,
          end: 2,
          words: [{ word: "C", start: 1, end: 2, pitch: 0 }],
        },
      ],
      series: withLiveDisplay(
        {
          times: [1.25],
          refPitches: [null],
          userPitches: [null],
          rawMicHz: [semitoneToFreq(61)],
          rawMicMidi: [61],
          rawMicClarity: [0.9],
          rawMicRms: [0.05],
          rawMicVoiced: [true],
          similarities: [0],
        },
        [1],
        {
          cents: [100],
          register: [0],
          expectedChart: [0],
          expectedRaw: [60],
          offset: [60],
          sampleCount: [8],
          locked: [true],
        },
      ),
      currentTime: 1.25,
      semitoneRange: 12,
    });

    expect(model.liveVoiceTrace[0].rawMidi).toBeCloseTo(61);
    expect(model.liveVoiceTrace[0].pitch).toBeCloseTo(1);
    expect(model.liveVoiceTrace[0].centsFromExpected).toBe(100);
  });

  it("builds raw live trace independently of viewport time", () => {
    const chartNotes = [
      { start: 1, end: 2, pitch: 69, label: "A", source: "chart" as const },
      { start: 8, end: 9, pitch: 72, label: "C", source: "chart" as const },
    ];
    const rawSeries: PitchSeries = withLiveDisplay(
      {
        times: [1.25, 4, 8.25],
        refPitches: [null, null, null],
        userPitches: [null, null, null],
        rawMicHz: [semitoneToFreq(69), semitoneToFreq(70), semitoneToFreq(72)],
        rawMicVoiced: [true, true, true],
        similarities: [0, 0, 0],
      },
      [69, 69, 72],
      {
        cents: [0, null, 0],
        expectedChart: [69, null, 72],
        expectedRaw: [69, null, 72],
        locked: [true, false, true],
      },
    );

    const first = buildRawLiveVoiceTrace(rawSeries, chartNotes);
    const second = buildRawLiveVoiceTrace(rawSeries, chartNotes);

    expect(first).toEqual(second);
    expect(first.map((point) => point.time)).toEqual([1.25, 4, 8.25]);
    expect(first.map((point) => Math.round(point.displayMidi))).toEqual([69, 69, 72]);
  });

  it("does not rewrite historical live points when later offset metadata changes", () => {
    const chartNotes = [{ start: 1, end: 3, pitch: 5, label: "A", source: "chart" as const }];
    const storedSeries = withLiveDisplay(
      {
        times: [1.1, 1.2],
        refPitches: [semitoneToFreq(65), semitoneToFreq(66)],
        userPitches: [null, null],
        rawMicHz: [semitoneToFreq(65), semitoneToFreq(66)],
        rawMicMidi: [65, 66],
        rawMicVoiced: [true, true],
        similarities: [0, 0],
      },
      [5, 8],
      {
        cents: [0, null],
        expectedChart: [5, 5],
        expectedRaw: [65, 65],
        offset: [60, 58],
        sampleCount: [8, 9],
        locked: [true, true],
      },
    );

    const trace = buildRawLiveVoiceTrace(storedSeries, chartNotes);

    expect(trace.map((point) => point.displayMidi)).toEqual([5, 8]);
    expect(trace.map((point) => point.centsFromExpected)).toEqual([0, null]);
    expect(trace.map((point) => point.micToChartOffset)).toEqual([60, 58]);
  });

  it("uses stored live display fields instead of current chart calibration", () => {
    const chartNotes = [{ start: 1, end: 2, pitch: 5, label: "A", source: "chart" as const }];
    const storedSeries = withLiveDisplay(
      {
        times: [1.25],
        refPitches: [semitoneToFreq(80)],
        userPitches: [null],
        rawMicHz: [semitoneToFreq(65)],
        rawMicMidi: [65],
        rawMicVoiced: [true],
        similarities: [0],
      },
      [5],
      {
        cents: [0],
        expectedChart: [5],
        expectedRaw: [65],
        offset: [60],
        sampleCount: [8],
        locked: [true],
      },
    );

    expect(computeChartPitchCalibration(storedSeries, chartNotes).midiOffset).toBeCloseTo(75);
    expect(buildRawLiveVoiceTrace(storedSeries, chartNotes)[0].displayMidi).toBe(5);
  });

  it("carries trace breaks across skipped null pitch samples", () => {
    const model = buildPracticeLaneModel({
      segments: [
        {
          text: "relative",
          start: 1,
          end: 2,
          words: [{ word: "relative", start: 1, end: 2, pitch: 0 }],
        },
      ],
      series: {
        times: [1, 1.08, 1.16],
        refPitches: [semitoneToFreq(60), semitoneToFreq(60), semitoneToFreq(60)],
        userPitches: [semitoneToFreq(60), null, semitoneToFreq(60)],
        similarities: [1, 0, 1],
        traceBreaks: [false, true, false],
      },
      currentTime: 1.16,
    });

    expect(model.userTrace).toHaveLength(2);
    expect(model.userTrace[1].breakBefore).toBe(true);
    expect(shouldConnectTracePoints(model.userTrace[0], model.userTrace[1])).toBe(false);
  });

  it("keeps raw debug pitch separate when no expected pitch is available", () => {
    const model = buildPracticeLaneModel({
      segments: [],
      series: {
        times: [1],
        refPitches: [null],
        userPitches: [null],
        rawUserPitches: [semitoneToFreq(60)],
        rawMicHz: [semitoneToFreq(60)],
        rawMicClarity: [0.9],
        rawMicRms: [0.05],
        rawMicVoiced: [true],
        similarities: [0],
      },
      currentTime: 1,
    });

    expect(model.expectedSource).toBe("none");
    expect(model.userTrace).toHaveLength(0);
    expect(model.rawUserTrace).toHaveLength(1);
    expect(model.liveVoiceTrace).toHaveLength(1);
    expect(model.liveVoiceTrace[0].displayMidi).toBeCloseTo(60);
    expect(model.chartRelativeVoiceTrace).toHaveLength(0);
  });

  it("computes expected-vs-mic cents differences", () => {
    expect(computePitchCentsDifference(12, 12.4)).toBe(40);
    expect(computePitchCentsDifference(null, 12.4)).toBeNull();
  });

  it("estimates mic latency adjustment from voiced onsets near chart notes", () => {
    const estimate = estimateMicLatencyAdjustment(
      {
        times: [0.8, 1.12, 1.4, 2.0, 2.18, 2.5],
        refPitches: [null, null, null, null, null, null],
        userPitches: [null, null, null, null, null, null],
        similarities: [0, 0, 0, 0, 0, 0],
        liveKind: ["silence", "voiced", "voiced", "silence", "voiced", "voiced"],
      },
      [
        { start: 1, end: 1.5, pitch: 5, label: "one", source: "chart" },
        { start: 2, end: 2.5, pitch: 7, label: "two", source: "chart" },
      ],
    );

    expect(estimate).toEqual({
      observedOffsetMs: 150,
      suggestedAdjustmentMs: -150,
      sampleCount: 2,
    });
  });

  it("filters pitch history after a local reset time", () => {
    const filtered = filterPitchSeriesSince(
      {
        ...series,
        rawMicHz: [110, 120, 130, 140, 150],
        rawMicVoiced: [true, true, false, true, true],
        liveDisplayPitch: [1, 2, 3, 4, 5],
        liveCentsFromExpected: [10, 20, null, 40, 50],
        liveRegisterOffset: [0, 0, null, 1, 1],
        liveKind: ["voiced", "voiced", "silence", "voiced", "voiced"],
        liveDropReason: [null, null, "unvoiced", null, null],
        liveOffsetSource: ["guide-vocal", "guide-vocal", "guide-vocal", "user-mic", "user-mic"],
        expectedChartPitchAtFrame: [1, 2, 3, 4, 5],
        liveExpectedRawMidi: [61, 62, null, 64, 65],
        micToChartOffsetAtFrame: [60, 60, 60, 60, 60],
        micToChartOffsetSampleCount: [1, 2, 3, 4, 5],
        micToChartOffsetLocked: [false, false, false, true, true],
        guideVocalOffsetAtFrame: [60, 60, 60, null, null],
        guideVocalOffsetSampleCount: [21, 22, 23, 0, 0],
        guideVocalConfidenceAtFrame: [0.7, 0.75, 0.8, 0, 0],
        guideVocalQualityAtFrame: ["low", "low", "ok", null, null],
        userMicOffsetAtFrame: [null, null, null, 60, 60],
        userMicOffsetSampleCount: [0, 0, 0, 34, 35],
        userMicOffsetLocked: [false, false, false, true, true],
        livePointScored: [false, false, false, true, true],
      },
      2,
    );

    expect(filtered.times).toEqual([2.5, 4.5, 5.5]);
    expect(filtered.userPitches).toEqual([null, 220, 246.94]);
    expect(filtered.rawMicHz).toEqual([130, 140, 150]);
    expect(filtered.rawMicVoiced).toEqual([false, true, true]);
    expect(filtered.liveDisplayPitch).toEqual([3, 4, 5]);
    expect(filtered.liveCentsFromExpected).toEqual([null, 40, 50]);
    expect(filtered.liveRegisterOffset).toEqual([null, 1, 1]);
    expect(filtered.liveKind).toEqual(["silence", "voiced", "voiced"]);
    expect(filtered.liveDropReason).toEqual(["unvoiced", null, null]);
    expect(filtered.liveOffsetSource).toEqual(["guide-vocal", "user-mic", "user-mic"]);
    expect(filtered.expectedChartPitchAtFrame).toEqual([3, 4, 5]);
    expect(filtered.liveExpectedRawMidi).toEqual([null, 64, 65]);
    expect(filtered.micToChartOffsetAtFrame).toEqual([60, 60, 60]);
    expect(filtered.micToChartOffsetSampleCount).toEqual([3, 4, 5]);
    expect(filtered.micToChartOffsetLocked).toEqual([false, true, true]);
    expect(filtered.guideVocalOffsetAtFrame).toEqual([60, null, null]);
    expect(filtered.guideVocalOffsetSampleCount).toEqual([23, 0, 0]);
    expect(filtered.guideVocalConfidenceAtFrame).toEqual([0.8, 0, 0]);
    expect(filtered.guideVocalQualityAtFrame).toEqual(["ok", null, null]);
    expect(filtered.userMicOffsetAtFrame).toEqual([null, 60, 60]);
    expect(filtered.userMicOffsetSampleCount).toEqual([0, 34, 35]);
    expect(filtered.userMicOffsetLocked).toEqual([false, true, true]);
    expect(filtered.livePointScored).toEqual([false, true, true]);
  });
});

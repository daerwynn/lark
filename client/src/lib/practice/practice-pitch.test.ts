import { describe, expect, it } from "vitest";

import { semitoneToFreq, type PitchSeries } from "@/lib/pitch/state";
import type { Segment } from "@/types/Transcript";
import {
  buildPracticeLaneModel,
  clampPracticeRange,
  computeChartPitchCalibration,
  computePhraseMatchQuality,
  computePitchCentsDifference,
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
    expect(model.missingChartData.absoluteNoteHz).toBe(true);
  });

  it("maps practice time to the lane x coordinate", () => {
    expect(practiceTimeToX({ time: 5, currentTime: 10, width: 130 })).toBeCloseTo(0);
    expect(practiceTimeToX({ time: 10, currentTime: 10, width: 130 })).toBeCloseTo(50);
    expect(practiceTimeToX({ time: 18, currentTime: 10, width: 130 })).toBeCloseTo(130);
  });

  it("maps practice pitch to the lane y coordinate", () => {
    const vertical = { min: 50, max: 74, center: 62, range: 24 };

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

  it("includes visible user trace when computing chart-note vertical range", () => {
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
        similarities: [0],
      },
      currentTime: 1.25,
      semitoneRange: 12,
    });

    expect(model.userTrace).toHaveLength(1);
    expect(model.userTrace[0].pitch).toBeCloseTo(-5);
    expect(model.vertical.min).toBeLessThan(-6);
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
      series: {
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
      currentTime: 1.25,
    });

    expect(model.userTrace[0].pitch).toBeCloseTo(72);
    expect(model.liveVoiceTrace[0].displayMidi).toBeCloseTo(69);
    expect(model.liveVoiceTrace[0].absoluteOctaveOffsetFromExpected).toBe(-1);
    expect(model.latestLiveCentsDifference).toBe(0);
  });

  it("does not create a main live voice point during chart gaps", () => {
    const model = buildPracticeLaneModel({
      segments: [
        {
          text: "relative",
          start: 1,
          end: 2,
          words: [{ word: "A", start: 1, end: 2, pitch: 69 }],
        },
      ],
      series: {
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
      currentTime: 2.5,
    });

    expect(model.liveVoiceTrace).toHaveLength(0);
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
        similarities: [0],
      },
      currentTime: 1,
    });

    expect(model.expectedSource).toBe("none");
    expect(model.userTrace).toHaveLength(0);
    expect(model.rawUserTrace).toHaveLength(1);
  });

  it("computes expected-vs-mic cents differences", () => {
    expect(computePitchCentsDifference(12, 12.4)).toBe(40);
    expect(computePitchCentsDifference(null, 12.4)).toBeNull();
  });

  it("filters pitch history after a local reset time", () => {
    const filtered = filterPitchSeriesSince(
      {
        ...series,
        rawMicHz: [110, 120, 130, 140, 150],
        rawMicVoiced: [true, true, false, true, true],
      },
      2,
    );

    expect(filtered.times).toEqual([2.5, 4.5, 5.5]);
    expect(filtered.userPitches).toEqual([null, 220, 246.94]);
    expect(filtered.rawMicHz).toEqual([130, 140, 150]);
    expect(filtered.rawMicVoiced).toEqual([false, true, true]);
  });
});

import { describe, expect, it } from "vitest";

import { LiveDisplayMapper, mapRawMidiToChartLane } from "./live-display";

describe("live display mapper", () => {
  it("maps raw MIDI to chart-relative pitch with a learned offset", () => {
    const mapped = mapRawMidiToChartLane(65, 5, 60);

    expect(mapped.displayPitch).toBeCloseTo(5);
    expect(mapped.centsFromExpected).toBe(0);
    expect(mapped.expectedRawMidi).toBe(65);
    expect(mapped.registerOffset).toBe(0);
  });

  it("preserves cents from expected after chart-relative mapping", () => {
    const mapped = mapRawMidiToChartLane(65.5, 5, 60);

    expect(mapped.displayPitch).toBeCloseTo(5.5);
    expect(mapped.centsFromExpected).toBe(50);
  });

  it("classifies octave register without moving the displayed y pitch by an octave", () => {
    const mapped = mapRawMidiToChartLane(77, 5, 60);

    expect(mapped.displayPitch).toBeCloseTo(5);
    expect(mapped.centsFromExpected).toBe(0);
    expect(mapped.registerOffset).toBe(1);
  });

  it("locks a relative chart offset after enough folded samples", () => {
    const mapper = new LiveDisplayMapper({ lockSampleCount: 3 });
    const voiced = { chartPitch: 5, clarity: 0.95, rms: 0.05 };

    expect(mapper.mapVoiced({ displayMidi: 65, ...voiced }).micToChartOffsetLocked).toBe(false);
    expect(mapper.mapVoiced({ displayMidi: 77, ...voiced }).micToChartOffsetLocked).toBe(false);
    const locked = mapper.mapVoiced({ displayMidi: 65.5, ...voiced });

    expect(locked.micToChartOffset).toBeCloseTo(60);
    expect(locked.micToChartOffsetLocked).toBe(true);
    expect(locked.displayPitch).toBeCloseTo(5.5);
    expect(locked.centsFromExpected).toBe(50);
  });

  it("keeps pre-lock display neutral while still placing it near the chart lane", () => {
    const mapper = new LiveDisplayMapper();
    const point = mapper.mapVoiced({ displayMidi: 65.5, chartPitch: 5, clarity: 0.95, rms: 0.05 });

    expect(point.displayPitch).toBeCloseTo(5.5);
    expect(point.centsFromExpected).toBeNull();
    expect(point.registerOffset).toBeNull();
    expect(point.micToChartOffsetLocked).toBe(false);
  });

  it("uses silence at the last display pitch without changing the offset", () => {
    const mapper = new LiveDisplayMapper({ lockSampleCount: 1 });
    const voiced = mapper.mapVoiced({ displayMidi: 65, chartPitch: 5, clarity: 0.95, rms: 0.05 });
    const silence = mapper.mapSilence({ chartPitch: 7 });

    expect(voiced.displayPitch).toBeCloseTo(5);
    expect(silence.kind).toBe("silence");
    expect(silence.displayPitch).toBeCloseTo(5);
    expect(silence.micToChartOffset).toBeCloseTo(60);
  });

  it("prefers guide-vocal offset over a locked user fallback", () => {
    const mapper = new LiveDisplayMapper({ lockSampleCount: 1 });

    expect(
      mapper.mapVoiced({ displayMidi: 55, chartPitch: 5, clarity: 0.95, rms: 0.05 })
        .micToChartOffset,
    ).toBeCloseTo(50);

    const guided = mapper.mapVoiced({
      displayMidi: 65,
      chartPitch: 5,
      guideOffset: 60,
      guideSampleCount: 30,
      guideConfidence: 0.9,
      guideQuality: "ok",
    });

    expect(guided.displayPitch).toBeCloseTo(5);
    expect(guided.micToChartOffset).toBe(60);
    expect(guided.offsetSource).toBe("guide-vocal");
    expect(guided.userMicOffset).toBeCloseTo(50);
  });

  it("does not lock user fallback before the safer default sample count", () => {
    const mapper = new LiveDisplayMapper();

    for (let i = 0; i < 31; i++) {
      mapper.mapVoiced({ displayMidi: 65, chartPitch: 5, clarity: 0.95, rms: 0.05 });
    }
    expect(mapper.status().userMicOffsetLocked).toBe(false);

    const locked = mapper.mapVoiced({ displayMidi: 65, chartPitch: 5, clarity: 0.95, rms: 0.05 });
    expect(locked.userMicOffsetLocked).toBe(true);
  });

  it("uses register MIDI for octave styling without moving y position", () => {
    const point = new LiveDisplayMapper().mapVoiced({
      displayMidi: 65,
      registerMidi: 77,
      chartPitch: 5,
      guideOffset: 60,
      guideSampleCount: 30,
    });

    expect(point.displayPitch).toBeCloseTo(5);
    expect(point.registerOffset).toBe(1);
  });

  it("holds a grey outlier point instead of accepting an impossible display spike", () => {
    const mapper = new LiveDisplayMapper({ jumpThresholdSemitones: 4, confirmedJumpFrames: 2 });

    const first = mapper.mapVoiced({ displayMidi: 65, chartPitch: 5, guideOffset: 60 });
    const spike = mapper.mapVoiced({ displayMidi: 72, chartPitch: 5, guideOffset: 60 });

    expect(first.kind).toBe("voiced");
    expect(spike.kind).toBe("silence");
    expect(spike.displayPitch).toBeCloseTo(first.displayPitch ?? 0);
    expect(spike.dropReason).toBe("display-outlier");
  });
});

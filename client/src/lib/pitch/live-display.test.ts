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

    expect(mapper.mapVoiced({ rawMidi: 65, chartPitch: 5 }).micToChartOffsetLocked).toBe(false);
    expect(mapper.mapVoiced({ rawMidi: 77, chartPitch: 5 }).micToChartOffsetLocked).toBe(false);
    const locked = mapper.mapVoiced({ rawMidi: 65.5, chartPitch: 5 });

    expect(locked.micToChartOffset).toBeCloseTo(60);
    expect(locked.micToChartOffsetLocked).toBe(true);
    expect(locked.displayPitch).toBeCloseTo(5.5);
    expect(locked.centsFromExpected).toBe(50);
  });

  it("keeps pre-lock display neutral while still placing it near the chart lane", () => {
    const mapper = new LiveDisplayMapper({ lockSampleCount: 8 });
    const point = mapper.mapVoiced({ rawMidi: 65.5, chartPitch: 5 });

    expect(point.displayPitch).toBeCloseTo(5.5);
    expect(point.centsFromExpected).toBeNull();
    expect(point.registerOffset).toBeNull();
    expect(point.micToChartOffsetLocked).toBe(false);
  });

  it("uses silence at the last display pitch without changing the offset", () => {
    const mapper = new LiveDisplayMapper({ lockSampleCount: 1 });
    const voiced = mapper.mapVoiced({ rawMidi: 65, chartPitch: 5 });
    const silence = mapper.mapSilence({ chartPitch: 7 });

    expect(voiced.displayPitch).toBeCloseTo(5);
    expect(silence.kind).toBe("silence");
    expect(silence.displayPitch).toBeCloseTo(5);
    expect(silence.micToChartOffset).toBeCloseTo(60);
  });
});

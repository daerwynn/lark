import { describe, expect, it } from "vitest";

import { measureRms } from "./detect";

describe("pitch detection helpers", () => {
  it("measures silence as zero RMS", () => {
    expect(measureRms(new Float32Array([0, 0, 0]))).toBe(0);
  });

  it("measures full-scale alternating samples as one RMS", () => {
    expect(measureRms(new Float32Array([1, -1, 1, -1]))).toBe(1);
  });

  it("supports generic array-like samples", () => {
    expect(measureRms([0.5, -0.5])).toBe(0.5);
  });
});

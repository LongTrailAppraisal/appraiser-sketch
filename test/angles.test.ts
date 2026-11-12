import { describe, expect, it } from "vitest";
import { cornerAngles, formatAngle, parseVectors } from "../src/geometry/index.js";

const angles = (v: string) => cornerAngles(parseVectors(v).path).map((c) => Math.round(c.angle * 10) / 10);

describe("corner angles", () => {
  it("rectangle, either direction", () => {
    expect(angles("R24 U30 L24 D30")).toEqual([90, 90, 90, 90]);
    expect(angles("U30 R24 D30 L24")).toEqual([90, 90, 90, 90]);
  });
  it("L-shape has one inside corner of 270", () => {
    expect(angles("R40 U24 L16 U12 L24 D36").sort((a, b) => a - b)).toEqual([90, 90, 90, 90, 90, 270]);
  });
  it("45° bay", () => {
    const a = angles("R12 R2D2 R4 R2U2 R10 U24 L30 D24");
    expect(a).toEqual([90, 225, 135, 135, 225, 90, 90, 90].map((x) => x));
  });
  it("right triangle 3-4-5", () => {
    expect(angles("R4 U3 CL")).toEqual([36.9, 90, 53.1]);
  });
  it("bisectors point into the shape", () => {
    const c = cornerAngles(parseVectors("R10 U10 L10 D10").path)[0]!;
    expect(c.bisector.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(c.bisector.y).toBeCloseTo(Math.SQRT1_2, 9);
    const cw = cornerAngles(parseVectors("U10 R10 D10 L10").path)[0]!;
    expect(cw.bisector.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(cw.bisector.y).toBeCloseTo(Math.SQRT1_2, 9);
  });
  it("arc corners use the tangent", () => {
    // Bow window: the corners where the arc meets straight walls are not 180.
    const a = angles("R10 R10^2 R10 U24 L30 D24");
    expect(a[1]).toBeGreaterThan(180);
    expect(a[1]).toBeCloseTo(a[2]!, 6);
  });
  it("formats", () => {
    expect([formatAngle(90), formatAngle(126.87), formatAngle(225.0001)]).toEqual(["90°", "126.9°", "225°"]);
  });
});

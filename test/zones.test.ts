import { describe, expect, it } from "vitest";
import { bounds, computeArea, flatten, outlinesOverlap, parseVectors, stripZone, type Area } from "../src/geometry/index.js";

const upper = (zones: Area["zones"]): Area => ({
  id: "a", name: "Second floor", kind: "living", grade: "above", finished: true, level: "2", connected: true,
  ceiling: "full", origin: { x: 0, y: 0 }, vectors: "R32 U24 L32 D24", zones,
});

describe("knee-wall strips", () => {
  const b = bounds(parseVectors("R32 U24 L32 D24").path);

  it("builds strips along each side", () => {
    expect(stripZone(b, "south", 4)).toEqual({ origin: { x: 0, y: 0 }, vectors: "R32' U4' L32' D4'" });
    expect(stripZone(b, "north", 4)).toEqual({ origin: { x: 0, y: 20 }, vectors: "R32' U4' L32' D4'" });
    expect(stripZone(b, "west", 3)).toEqual({ origin: { x: 0, y: 0 }, vectors: "R3' U24' L3' D24'" });
    expect(stripZone(b, "east", 3)).toEqual({ origin: { x: 29, y: 0 }, vectors: "R3' U24' L3' D24'" });
    expect(stripZone(b, "north", 3, 4).origin).toEqual({ x: 0, y: 17 });
  });

  it("Cape upper floor: 4' under 5' and 3' at 5'–7' on both eaves", () => {
    const z = (id: string, band: "low" | "reduced", s: ReturnType<typeof stripZone>) => ({ id, band, ...s });
    const r = computeArea(
      upper([
        z("l1", "low", stripZone(b, "south", 4)),
        z("l2", "low", stripZone(b, "north", 4)),
        z("r1", "reduced", stripZone(b, "south", 3, 4)),
        z("r2", "reduced", stripZone(b, "north", 3, 4)),
      ]),
    );
    expect(r.problems).toEqual([]);
    // 768 gross; 256 under 5' dropped; 192 at 5'-7' and 320 at 7'+ counted (320 >= half of 512).
    expect(r.ansi).toMatchObject({ bucket: "gla", low: 256, reduced: 192, full: 320, counted: 512 });
  });

  it("a deeper 5'–7' band tips it to non-standard", () => {
    const r = computeArea(
      upper([
        { id: "l1", band: "low", ...stripZone(b, "south", 4) },
        { id: "l2", band: "low", ...stripZone(b, "north", 4) },
        { id: "r1", band: "reduced", ...stripZone(b, "south", 5, 4) },
        { id: "r2", band: "reduced", ...stripZone(b, "north", 5, 4) },
      ]),
    );
    expect(r.ansi.bucket).toBe("nonStandardAbove");
    expect(r.ansi.counted).toBeCloseTo(512, 9);
  });
});

describe("zone overlap check", () => {
  const b = bounds(parseVectors("R32 U24 L32 D24").path);
  it("flags strips that overlap, not strips that only touch", () => {
    const touching = computeArea(
      upper([
        { id: "l1", band: "low", ...stripZone(b, "south", 4) },
        { id: "r1", band: "reduced", ...stripZone(b, "south", 3, 4) },
      ]),
    );
    expect(touching.problems).toEqual([]);
    const overlapping = computeArea(
      upper([
        { id: "l1", band: "low", ...stripZone(b, "south", 4) },
        { id: "r1", band: "reduced", ...stripZone(b, "south", 3, 3) },
      ]),
    );
    expect(overlapping.problems.join()).toMatch(/zones 1 and 2 overlap/);
  });

  it("detects a zone wholly inside another", () => {
    expect(
      outlinesOverlap(
        flattenOf("R10 U10 L10 D10"),
        flattenOf("R2 U2 L2 D2", { x: 4, y: 4 }),
      ),
    ).toBe(true);
    expect(outlinesOverlap(flattenOf("R10 U10 L10 D10"), flattenOf("R2 U2 L2 D2", { x: 10, y: 0 }))).toBe(false);
  });
});

function flattenOf(v: string, o = { x: 0, y: 0 }) {
  return flatten(parseVectors(v, o).path);
}

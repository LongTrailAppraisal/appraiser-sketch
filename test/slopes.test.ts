import { describe, expect, it } from "vitest";
import {
  bounds,
  clipHalfPlane,
  computeArea,
  flatten,
  parseVectors,
  slopeBands,
  slopeHeightAt,
  setSlopeRun,
  slopeFromSide,
  slopeSide,
  depthFrom,
  slopeStrip,
  type Area,
} from "../src/geometry/index.js";

const upper = (zones: Area["zones"], vectors = "R32 U24 L32 D24"): Area => ({
  id: "a", name: "Second floor", kind: "living", grade: "above", finished: true, level: "2", connected: true,
  ceiling: "full", origin: { x: 0, y: 0 }, vectors, zones,
});
const box = bounds(parseVectors("R32 U24 L32 D24").path);
const byBand = (bands: { band: string; area: number }[]) => Object.fromEntries(bands.map((b) => [b.band, b.area]));

describe("clipHalfPlane", () => {
  it("cuts a concave L shape at x <= 5", () => {
    const l = flatten(parseVectors("R10 U4 L6 U6 L4 D10").path);
    const left = clipHalfPlane(l, { x: 1, y: 0 }, 5);
    // 4 wide x 10 tall plus 1 x 4.
    const a = Math.abs(left.reduce((s, p, i) => { const q = left[(i + 1) % left.length]!; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
    expect(a).toBeCloseTo(44, 9);
  });
});

describe("sloped ceilings", () => {
  it("height rises along the slope and stays level beyond it", () => {
    const s = slopeStrip(box, "south", 6, 2, 8);
    expect(slopeHeightAt(s.slope, s.origin, { x: 10, y: 0 })).toBe(2);
    expect(slopeHeightAt(s.slope, s.origin, { x: 10, y: 3 })).toBe(5);
    expect(slopeHeightAt(s.slope, s.origin, { x: 10, y: 20 })).toBe(8);
    const n = slopeStrip(box, "north", 6, 2, 8);
    expect(slopeHeightAt(n.slope, n.origin, { x: 0, y: 24 })).toBe(2);
    expect(slopeHeightAt(n.slope, n.origin, { x: 0, y: 19 })).toBe(7);
  });

  it("splits each strip side into bands, whichever wall it is on", () => {
    for (const side of ["south", "north", "east", "west"] as const) {
      const s = slopeStrip(box, side, 6, 2, 8);
      const len = side === "south" || side === "north" ? 32 : 24;
      const out = slopeBands(flatten(parseVectors(s.vectors, s.origin).path), s.origin, s.slope);
      // 2' at the wall to 8' at 6': under 5' for 3', 5'–7' for 2', 7'+ for 1'.
      expect(byBand(out)).toEqual({ low: expect.closeTo(3 * len, 9), reduced: expect.closeTo(2 * len, 9), full: expect.closeTo(len, 9) });
    }
  });

  it("Cape upper floor with sloped eaves counts the same as hand-drawn strips", () => {
    const z = (id: string, side: "north" | "south") => ({ id, band: "sloped" as const, ...slopeStrip(box, side, 6, 2, 8) });
    const r = computeArea(upper([z("s", "south"), z("n", "north")]));
    expect(r.problems).toEqual([]);
    // 768 gross: 192 under 5' dropped; 128 at 5'–7'; 64 + 384 middle = 448 at 7'+.
    expect(r.ansi).toMatchObject({ bucket: "gla", low: expect.closeTo(192, 6), reduced: expect.closeTo(128, 6), full: expect.closeTo(448, 6) });
    expect(r.ansi.counted).toBeCloseTo(576, 6);
  });

  it("a low flat ceiling past the slope can make it non-standard", () => {
    const z = (id: string, side: "north" | "south") => ({ id, band: "sloped" as const, ...slopeStrip(box, side, 10, 3, 6.5) });
    const a = upper([z("s", "south"), z("n", "north")]);
    a.ceiling = "reduced"; // 6'6" flat ceiling in the middle
    const r = computeArea(a);
    expect(r.ansi.full).toBeCloseTo(0, 9);
    expect(r.ansi.bucket).toBe("nonStandardAbove");
  });

  it("a slope that never drops under 5' is all counted", () => {
    const s = slopeStrip(box, "west", 8, 6, 9);
    const out = byBand(slopeBands(flatten(parseVectors(s.vectors, s.origin).path), s.origin, s.slope));
    expect(out.low).toBeUndefined();
    expect(out.reduced! + out.full!).toBeCloseTo(8 * 24, 9);
  });

  it("slope moves with its zone", () => {
    const s = slopeStrip(box, "south", 6, 2, 8);
    const moved = { x: s.origin.x + 100, y: s.origin.y + 50 };
    const out = slopeBands(flatten(parseVectors(s.vectors, moved).path), moved, s.slope);
    expect(byBand(out).low).toBeCloseTo(96, 9);
  });

  it("a sloped zone with a bay (arc) splits its exact area", () => {
    const zone = { id: "z", band: "sloped" as const, origin: { x: 0, y: 0 }, vectors: "R32 U6 L32^2 D6", slope: { from: { x: 0, y: 0 }, to: { x: 0, y: 6 }, fromHeight: 2, toHeight: 8 } };
    const r = computeArea(upper([zone], "R32 U24 L32 D24"));
    const zr = r.zones[0]!;
    const sum = zr.bands!.reduce((t, b) => t + b.area, 0);
    expect(sum).toBeCloseTo(zr.area, 9);
  });

  it("flags a sloped zone with no heights", () => {
    const r = computeArea(upper([{ id: "z", band: "sloped", origin: { x: 0, y: 0 }, vectors: "R32 U6 L32 D6" }]));
    expect(r.problems.join()).toMatch(/sloped ceiling has no heights/);
    expect(r.ansi.full).toBeCloseTo(768, 9);
  });
});

describe("changing a slope's run", () => {
  const outlineOf = (z: { origin: { x: number; y: number }; vectors: string }) => flatten(parseVectors(z.vectors, z.origin).path);
  for (const side of ["south", "north", "east", "west"] as const) {
    it(`resizes a ${side} strip and keeps the wall where it was`, () => {
      const s = slopeStrip(box, side, 6, 2, 8);
      const r = setSlopeRun(s, outlineOf(s), 10);
      const b = bounds(parseVectors(r.vectors, r.origin).path);
      const depth = side === "south" || side === "north" ? b.maxY - b.minY : b.maxX - b.minX;
      expect(depth).toBeCloseTo(10, 9);
      // Still 2' at the wall and 8' at the strip's inner edge.
      const wallPt = { south: { x: 5, y: 0 }, north: { x: 5, y: 24 }, west: { x: 0, y: 5 }, east: { x: 32, y: 5 } }[side];
      expect(slopeHeightAt(r.slope, r.origin, wallPt)).toBeCloseTo(2, 9);
      const inner = { south: { x: 5, y: 10 }, north: { x: 5, y: 14 }, west: { x: 10, y: 5 }, east: { x: 22, y: 5 } }[side];
      expect(slopeHeightAt(r.slope, r.origin, inner)).toBeCloseTo(8, 9);
    });
  }
  it("leaves a hand-drawn outline alone and only changes the slope", () => {
    const z = { origin: { x: 0, y: 0 }, vectors: "R10 U6 L4 U2 L6 D8", slope: { from: { x: 0, y: 0 }, to: { x: 0, y: 6 }, fromHeight: 2, toHeight: 8 } };
    const r = setSlopeRun(z, outlineOf(z), 9);
    expect(r.vectors).toBe(z.vectors);
    expect(r.slope.to).toEqual({ x: 0, y: 9 });
  });
});

describe("custom zones made sloped", () => {
  const dormerCut = { origin: { x: 0, y: 18 }, vectors: "R10 U6 L4 D2 L2 U2 L4 D6" }; // a notch where a dormer sits
  it("slopes from any side of the outline, and reports that side back", () => {
    const outline = flatten(parseVectors(dormerCut.vectors, dormerCut.origin).path);
    const b = bounds(parseVectors(dormerCut.vectors, dormerCut.origin).path);
    for (const side of ["north", "south", "east", "west"] as const) {
      const s = slopeFromSide(b, dormerCut.origin, side, depthFrom(b, side), 2, 8);
      expect(slopeSide(s)).toBe(side);
      const wall = { south: { x: 5, y: 18 }, north: { x: 5, y: 24 }, west: { x: 0, y: 20 }, east: { x: 10, y: 20 } }[side];
      expect(slopeHeightAt(s, dormerCut.origin, wall)).toBeCloseTo(2, 9);
      const bands = slopeBands(outline, dormerCut.origin, s);
      expect(bands.reduce((t, x) => t + x.area, 0)).toBeCloseTo(56, 9); // 60 less the 2x2 notch
    }
  });
  it("an angled slope has no side", () => {
    expect(slopeSide({ from: { x: 0, y: 0 }, to: { x: 3, y: 4 }, fromHeight: 2, toHeight: 8 })).toBeNull();
  });
});

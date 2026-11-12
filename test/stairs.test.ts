import { describe, expect, it } from "vitest";
import { computeArea, defaultStair, stairDrawing, type Area } from "../src/geometry/index.js";

const pts = (d: ReturnType<typeof stairDrawing>) => d.parts.flat();
const box = (d: ReturnType<typeof stairDrawing>) => {
  const p = pts(d);
  return {
    minX: Math.min(...p.map((q) => q.x)),
    maxX: Math.max(...p.map((q) => q.x)),
    minY: Math.min(...p.map((q) => q.y)),
    maxY: Math.max(...p.map((q) => q.y)),
  };
};

describe("stair symbols", () => {
  it("straight: 3' x 12' with 10\" treads", () => {
    const d = stairDrawing(defaultStair());
    expect(d.footprint).toBeCloseTo(36, 9);
    expect(d.lines).toHaveLength(14 - 1); // 12' / 10" = 14.4 -> 14 treads, 13 lines between them
    expect(box(d)).toEqual({ minX: 0, maxX: 3, minY: 0, maxY: 12 });
  });

  it("middle landing: two flights and a square landing", () => {
    const d = stairDrawing(defaultStair({ type: "landing", run1: 6, run2: 6 }));
    expect(d.parts).toHaveLength(3);
    expect(d.footprint).toBeCloseTo(18 + 9 + 18, 9);
    expect(box(d).maxY).toBeCloseTo(15, 9);
  });

  it("L turning right goes east after the landing; left goes west", () => {
    const right = box(stairDrawing(defaultStair({ type: "l", run1: 8, run2: 5 })));
    expect(right).toEqual({ minX: 0, maxX: 8, minY: 0, maxY: 11 });
    const left = box(stairDrawing(defaultStair({ type: "l", run1: 8, run2: 5, turn: "left" })));
    expect(left).toEqual({ minX: -5, maxX: 3, minY: 0, maxY: 11 });
  });

  it("winder adds three winder lines in the corner", () => {
    const l = stairDrawing(defaultStair({ type: "l", run1: 8, run2: 5 }));
    const wdr = stairDrawing(defaultStair({ type: "winder", run1: 8, run2: 5 }));
    expect(wdr.lines.length - l.lines.length).toBe(3);
    expect(wdr.footprint).toBeCloseTo(l.footprint, 9);
  });

  it("U returns alongside the first flight", () => {
    const d = stairDrawing(defaultStair({ type: "u", run1: 8, run2: 8 }));
    expect(box(d)).toEqual({ minX: 0, maxX: 6, minY: 0, maxY: 11 });
    expect(d.arrow.at(-1)!.y).toBeLessThan(1);
  });

  it("rotation turns the stair about its origin", () => {
    const d = stairDrawing(defaultStair({ rotation: 90, origin: { x: 10, y: 10 } }));
    const b = box(d);
    expect(b.minX).toBeCloseTo(-2, 9);
    expect(b.maxX).toBeCloseTo(10, 9);
    expect(b.minY).toBeCloseTo(10, 9);
    expect(b.maxY).toBeCloseTo(13, 9);
  });

  it("never changes the area it is drawn in (counts on the floor above)", () => {
    const base: Area = {
      id: "a", name: "Second floor", kind: "living", grade: "above", finished: true, level: "2", connected: true,
      ceiling: "full", origin: { x: 0, y: 0 }, vectors: "R30 U26 L30 D26", zones: [], stairs: [],
    };
    const withStair = { ...base, stairs: [defaultStair({ id: "s1", origin: { x: 2, y: 2 } })] };
    expect(computeArea(withStair).ansi.counted).toBe(computeArea(base).ansi.counted);
    expect(computeArea(withStair).problems).toEqual([]);
  });

  it("flags a stair drawn outside its area", () => {
    const a: Area = {
      id: "a", name: "First floor", kind: "living", grade: "above", finished: true, level: "1", connected: true,
      ceiling: "full", origin: { x: 0, y: 0 }, vectors: "R10 U10 L10 D10", zones: [],
      stairs: [defaultStair({ id: "s1", origin: { x: 8, y: 0 } })],
    };
    expect(computeArea(a).problems.join()).toMatch(/stair .*outside/);
  });
});

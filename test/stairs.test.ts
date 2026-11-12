import { describe, expect, it } from "vitest";
import { computeArea, defaultStair, dragStairHandle, stairDrawing, stairHandles, type Area } from "../src/geometry/index.js";

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

describe("stair resize handles", () => {
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
  };

  it("straight stair has run and width handles", () => {
    const h = stairHandles(defaultStair());
    expect(h.map((x) => x.key)).toEqual(["run1", "width"]);
    near(h[0]!.point, { x: 1.5, y: 12 });
    near(h[1]!.point, { x: 3, y: 6 });
  });

  it("dragging the run handle sets the flight length to the nearest inch", () => {
    const s = defaultStair();
    expect(dragStairHandle(s, "run1", { x: 1.5, y: 13.52 })).toEqual({ width: 3, run1: 13.5, run2: 4 });
    expect(dragStairHandle(s, "run1", { x: 1.5, y: 13 + 4.4 / 12 }).run1).toBeCloseTo(13 + 4 / 12, 12);
  });

  it("width handle has a 2' minimum", () => {
    expect(dragStairHandle(defaultStair(), "width", { x: 3.5, y: 6 }).width).toBe(3.5);
    expect(dragStairHandle(defaultStair(), "width", { x: 0.4, y: 6 }).width).toBe(2);
  });

  it("works on a rotated, left-turning L", () => {
    const s = defaultStair({ type: "l", run1: 8, run2: 5, turn: "left", rotation: 90, origin: { x: 10, y: 10 } });
    const run2 = stairHandles(s).find((h) => h.key === "run2")!;
    // Handle sits on the drawing: drag it to where it already is and nothing changes.
    expect(dragStairHandle(s, "run2", run2.point)).toEqual({ width: 3, run1: 8, run2: 5 });
    // The second flight runs local -x (left turn) which after 90° CCW is world -y; drag 2' further.
    const moved = { x: run2.point.x, y: run2.point.y - 2 };
    expect(dragStairHandle(s, "run2", moved).run2).toBeCloseTo(7, 12);
  });

  it("U: the return flight can't outrun the first", () => {
    const s = defaultStair({ type: "u", run1: 8, run2: 8 });
    expect(dragStairHandle(s, "run2", { x: 4.5, y: -3 }).run2).toBe(8);
    expect(dragStairHandle(s, "run1", { x: 1.5, y: 6 })).toMatchObject({ run1: 6, run2: 6 });
    expect(dragStairHandle(s, "width", { x: 7, y: 9 }).width).toBe(3.5);
  });
});

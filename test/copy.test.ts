import { describe, expect, it } from "vitest";
import { computeArea, copyArea, copyStairTo, defaultStair, levelRank, type Area } from "../src/geometry/index.js";

let n = 100;
const id = (p: string) => `${p}${++n}`;
const first: Area = {
  id: "a1", name: "First floor", kind: "living", grade: "above", finished: true, level: "1", connected: true,
  ceiling: "full", origin: { x: 0, y: 0 }, vectors: "R30 U24 L30 D24",
  zones: [{ id: "z1", band: "low", origin: { x: 0, y: 0 }, vectors: "R30 U4 L30 D4" }],
  stairs: [defaultStair({ id: "s1", origin: { x: 2, y: 6 } })],
};

describe("copy area", () => {
  it("moves the outline, zones and stairs together with new ids", () => {
    const c = copyArea(first, { x: 40, y: 0 }, id);
    expect(c.id).not.toBe("a1");
    expect(c.name).toBe("First floor (copy)");
    expect(c.zones[0]!.origin).toEqual({ x: 40, y: 0 });
    expect(c.zones[0]!.id).not.toBe("z1");
    expect(c.stairs![0]!.origin).toEqual({ x: 42, y: 6 });
    expect(computeArea(c).shape.area).toBe(720);
    expect(first.stairs![0]!.origin).toEqual({ x: 2, y: 6 }); // source untouched
  });

  it("applies a preset over the copy", () => {
    const c = copyArea(first, { x: 40, y: 0 }, id, { name: "Basement", grade: "below", finished: false, level: "basement" });
    expect(c).toMatchObject({ name: "Basement", grade: "below", finished: false, vectors: first.vectors });
    expect(computeArea(c).ansi.bucket).toBe("unfinishedBelow");
  });
});

describe("copy stair to another floor", () => {
  const second: Area = { ...first, id: "a2", name: "Second floor", level: "2", origin: { x: 40, y: 0 }, stairs: [] };
  const base: Area = { ...first, id: "a3", name: "Basement", level: "basement", grade: "below", origin: { x: 80, y: -5 }, stairs: [] };
  const st = first.stairs![0]!;

  it("keeps its place relative to the floor's start point", () => {
    expect(copyStairTo(st, first, second, "x").origin).toEqual({ x: 42, y: 6 });
    expect(copyStairTo(st, first, base, "x").origin).toEqual({ x: 82, y: 1 });
  });
  it("points down from a floor above and up from below", () => {
    expect(copyStairTo(st, first, second, "x").direction).toBe("down");
    expect(copyStairTo(st, first, base, "x").direction).toBe("up");
    expect(copyStairTo(st, first, first, "x").direction).toBe("up");
  });
  it("orders levels", () => {
    expect(["attic", "2", "1", "basement"].sort((a, b) => levelRank(a) - levelRank(b))).toEqual(["basement", "1", "2", "attic"]);
  });
});

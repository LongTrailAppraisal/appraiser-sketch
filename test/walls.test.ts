import { describe, expect, it } from "vitest";
import { computeArea, computeSketch, copyArea, lockedDirection, moveToken, snapWallPoint, type Area, type SnapTargets } from "../src/geometry/index.js";
import { parseSketchFile, serialize } from "../src/app/files.js";
import { renderSketch } from "../src/app/render.js";
import { newSketch } from "../src/app/store.js";

// A 30' x 24' room as snap targets: its four corners and four walls.
const C = [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 24 },
  { x: 0, y: 24 },
];
const room: SnapTargets = { points: C, lines: C.map((p, i) => [p, C[(i + 1) % 4]!] as [typeof p, typeof p]) };
const opts = { tol: 0.5, step: 1 / 12, free: false };
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe("interior wall snapping", () => {
  it("starts on a corner when the click is near one", () => {
    const r = snapWallPoint({ x: 0.2, y: 23.9 }, null, room, opts);
    expect(r.kind).toBe("corner");
    close(r.at, { x: 0, y: 24 });
  });

  it("starts on an exterior wall, slid to whole inches along it", () => {
    const r = snapWallPoint({ x: 12.03, y: 0.3 }, null, room, opts);
    expect(r.kind).toBe("wall");
    close(r.at, { x: 12, y: 0 });
  });

  it("starts on the grid away from walls", () => {
    const r = snapWallPoint({ x: 10.04, y: 10.51 }, null, room, opts);
    expect(r.kind).toBe("grid");
    close(r.at, { x: 10, y: 10.5 });
  });

  it("locks to square and 45° from the last point", () => {
    close(lockedDirection({ x: 0, y: 0 }, { x: 10, y: 1 }), { x: 1, y: 0 });
    close(lockedDirection({ x: 0, y: 0 }, { x: 5, y: 4.6 }), { x: Math.SQRT1_2, y: Math.SQRT1_2 });
    close(lockedDirection({ x: 0, y: 0 }, { x: -0.5, y: -7 }), { x: 0, y: -1 });
  });

  it("stops exactly on the far wall when the cursor is near it", () => {
    // From the bottom wall straight up to the top wall, cursor a little short and to one side.
    const r = snapWallPoint({ x: 12.4, y: 23.7 }, { x: 12, y: 0 }, room, opts);
    expect(r.kind).toBe("wall");
    close(r.at, { x: 12, y: 24 });
  });

  it("snaps the length to the grid in open space, keeping the wall square", () => {
    const r = snapWallPoint({ x: 12.3, y: 10.02 }, { x: 12, y: 0 }, room, opts);
    expect(r.kind).toBe("grid");
    close(r.at, { x: 12, y: 10 });
  });

  it("keeps 45° walls on whole inches in both directions", () => {
    const r = snapWallPoint({ x: 4.01, y: 3.98 }, { x: 0, y: 0 }, { points: [], lines: [] }, opts);
    close(r.at, { x: 4, y: 4 });
    expect(moveToken(r.at.x, r.at.y)).toBe("R4'U4'");
  });

  it("runs to a corner off the locked line as a last resort", () => {
    const r = snapWallPoint({ x: 29.8, y: 23.8 }, { x: 20, y: 10 }, room, opts);
    expect(r.kind).toBe("corner");
    close(r.at, { x: 30, y: 24 });
  });

  it("does nothing clever with Alt held", () => {
    const r = snapWallPoint({ x: 12.37, y: 23.71 }, { x: 12, y: 0 }, room, { ...opts, free: true });
    expect(r).toEqual({ at: { x: 12.37, y: 23.71 }, kind: "free" });
  });
});

const base: Area = {
  id: "a1", name: "First floor", kind: "living", grade: "above", finished: true, level: "1", connected: true,
  ceiling: "full", origin: { x: 0, y: 0 }, vectors: "R30 U24 L30 D24", zones: [], stairs: [],
};

describe("interior walls on an area", () => {
  it("never change the area or its ANSI count", () => {
    const plain = computeArea(base);
    const walled = computeArea({ ...base, walls: [{ id: "w1", origin: { x: 12, y: 0 }, vectors: "U14 R18" }] });
    expect(walled.shape.area).toBe(plain.shape.area);
    expect(walled.ansi.counted).toBe(plain.ansi.counted);
    expect(walled.problems).toEqual([]);
    expect(walled.walls[0]!.path.segments).toHaveLength(2);
    expect(walled.walls[0]!.inside).toBe(true);
  });

  it("warns about a wall that runs outside the area", () => {
    const r = computeArea({ ...base, walls: [{ id: "w1", origin: { x: 12, y: 0 }, vectors: "U30" }] });
    expect(r.walls[0]!.inside).toBe(false);
    expect(r.problems).toContain("interior wall 1: extends outside the area");
  });

  it("reports typing mistakes in a wall", () => {
    const r = computeArea({ ...base, walls: [{ id: "w1", origin: { x: 12, y: 0 }, vectors: "U10 X4" }] });
    expect(r.problems.some((p) => p.startsWith('interior wall 1: "X4"'))).toBe(true);
  });

  it("come along when the area is copied, with new ids", () => {
    const c = copyArea({ ...base, walls: [{ id: "w1", origin: { x: 12, y: 0 }, vectors: "U14" }] }, { x: 40, y: 0 }, (p) => `${p}9`);
    expect(c.walls).toEqual([{ id: "w9", origin: { x: 52, y: 0 }, vectors: "U14" }]);
  });

  it("are saved and opened again", () => {
    const sk = newSketch();
    Object.assign(sk.structures[0]!.areas[0]!, { vectors: "R30 U24 L30 D24", walls: [{ id: "w1", origin: { x: 12, y: 0 }, vectors: "U14 R18" }] });
    const back = parseSketchFile(serialize(sk));
    expect(back.structures[0]!.areas[0]!.walls).toEqual([{ id: "w1", origin: { x: 12, y: 0 }, vectors: "U14 R18" }]);
  });

  it("refuse a file whose wall has no start point", () => {
    const text = JSON.stringify({
      formatVersion: 1,
      structures: [{ areas: [{ vectors: "R30 U24 L30 D24", walls: [{ vectors: "U14" }] }] }],
    });
    expect(() => parseSketchFile(text)).toThrow(/interior wall 1: origin/);
  });

  it("are drawn on the print as well as the screen", () => {
    const sk = newSketch();
    Object.assign(sk.structures[0]!.areas[0]!, { vectors: "R30 U24 L30 D24", walls: [{ id: "w1", origin: { x: 12, y: 0 }, vectors: "U14 R18" }] });
    const view = { scale: 10, ox: 0, oy: 300 };
    const screen = renderSketch(computeSketch(sk), { width: 400, height: 300, view, selection: null });
    const print = renderSketch(computeSketch(sk), { width: 400, height: 300, view, selection: null, interactive: false });
    expect(screen).toContain('class="iwall"');
    expect(screen).toContain("data-iwall=");
    expect(print).toContain('class="iwall"');
    expect(print).not.toContain("data-iwall="); // nothing clickable on paper
  });
});

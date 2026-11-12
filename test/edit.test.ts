import { describe, expect, it } from "vitest";
import { applyArrow, area, closeOutline, closure, corners, moveToken, openAtCorner, parseVectors } from "../src/geometry/index.js";

describe("arrow keys", () => {
  it("turns a trailing length into a wall", () => {
    expect(applyArrow("30", 2, "up")).toEqual({ text: "U30 ", caret: 4 });
    expect(applyArrow("R24 30", 6, "left")).toEqual({ text: "R24 L30 ", caret: 8 });
    expect(applyArrow("R24 24'6\"", 9, "right")).toEqual({ text: "R24 R24'6\" ", caret: 11 });
    expect(applyArrow("R24 U30 12", 10, "down")!.text).toBe("R24 U30 D12 ");
  });

  it("leaves the key alone when there is no bare length", () => {
    expect(applyArrow("", 0, "up")).toBeNull();
    expect(applyArrow("R24 ", 4, "up")).toBeNull();
    expect(applyArrow("R24", 3, "up")).toBeNull(); // already a move
  });

  it("works mid-text at the caret", () => {
    expect(applyArrow("R24 10 L24", 6, "up")).toEqual({ text: "R24 U10 L24", caret: 8 });
  });
});

describe("open and close at a corner", () => {
  const v = "R24 U30 L24 D30";

  it("lists corners from the start", () => {
    expect(corners(v, { x: 0, y: 0 })).toEqual([
      { x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 30 }, { x: 0, y: 30 },
    ]);
  });

  it("opening at a corner removes the wall leaving it and ends there", () => {
    // Corner 1 is (24,0); the wall leaving it is U30. Outline now starts at (24,30) and ends at (24,0).
    const r = openAtCorner(v, { x: 0, y: 0 }, 1)!;
    expect(r).toEqual({ vectors: "L24 D30 R24", origin: { x: 24, y: 30 } });
    const p = parseVectors(r.vectors, r.origin).path;
    expect(p.segments.at(-1)!.to).toEqual({ x: 24, y: 0 });
    expect(closure(p).closed).toBe(false);
  });

  it("drawing back to the start closes it again with the same area", () => {
    const r = openAtCorner(v, { x: 0, y: 0 }, 1)!;
    const p = parseVectors(`${r.vectors} U30`, r.origin).path;
    expect(closure(p).closed).toBe(true);
    expect(area(p)).toBeCloseTo(720, 9);
  });

  it("adds a bump-out by opening at a corner", () => {
    // Open at the start corner: remove the 24' front wall, redraw it with a 10' x 4' bump.
    const r = openAtCorner(v, { x: 0, y: 0 }, 0)!;
    expect(r.origin).toEqual({ x: 24, y: 0 });
    const p = parseVectors(`${r.vectors} R7 D4 R10 U4 R7`, r.origin).path;
    expect(closure(p).closed).toBe(true);
    expect(area(p)).toBeCloseTo(720 + 40, 9);
  });

  it("keeps arcs and turns a CL wall into an explicit move", () => {
    const r = openAtCorner("R20^3 U10 L20 CL", { x: 0, y: 0 }, 2)!;
    expect(r.vectors).toBe("D10' R20^3 U10");
    expect(r.origin).toEqual({ x: 0, y: 10 });
  });

  it("refuses an open outline or a missing corner", () => {
    expect(openAtCorner("R24 U30 L24", { x: 0, y: 0 }, 0)).toBeNull();
    expect(openAtCorner(v, { x: 0, y: 0 }, 9)).toBeNull();
  });

  it("closes with CL and formats moves", () => {
    expect(closeOutline("R24 U30 L24 ")).toBe("R24 U30 L24 CL");
    expect(moveToken(-24, 0)).toBe("L24'");
    expect(moveToken(10, 5.5)).toBe("R10'U5'6\"");
  });
});

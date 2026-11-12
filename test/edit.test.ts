import { describe, expect, it } from "vitest";
import { applyArrow, area, deleteWall, moveCorners, closeOutline, closure, corners, moveToken, openAtCorner, parseVectors } from "../src/geometry/index.js";

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

describe("delete wall", () => {
  const o = { x: 0, y: 0 };
  it("steps back one wall at a time on an open outline", () => {
    let r = deleteWall("R24 U30 L24", o, null)!;
    expect(r).toEqual({ vectors: "R24 U30", origin: o });
    r = deleteWall(r.vectors, r.origin, null)!;
    expect(r.vectors).toBe("R24");
    r = deleteWall(r.vectors, r.origin, null)!;
    expect(r.vectors).toBe("");
    expect(deleteWall("", o, null)).toBeNull();
  });

  it("opens a closed outline at the picked corner, then keeps stepping back", () => {
    const r = deleteWall("R24 U30 L24 D30", o, 1)!;
    expect(r).toEqual({ vectors: "L24 D30 R24", origin: { x: 24, y: 30 } });
    expect(deleteWall(r.vectors, r.origin, null)!.vectors).toBe("L24 D30");
  });

  it("with no corner picked, removes the closing wall", () => {
    expect(deleteWall("R24 U30 L24 D30", o, null)!.vectors).toBe("R24 U30 L24");
    expect(deleteWall("R24 U30 L24 CL", o, null)!.vectors).toBe("R24 U30 L24");
  });

  it("A closes like CL", () => {
    const p = parseVectors("R24 U30 L24 A").path;
    expect(closure(p).closed).toBe(true);
    expect(area(p)).toBeCloseTo(720, 9);
    expect(parseVectors("A30:12").errors).toEqual([]); // polar moves still work
  });
});

describe("moving corners and walls with the mouse", () => {
  const o = { x: 0, y: 0 };
  it("dragging one corner rewrites its two walls", () => {
    const r = moveCorners("R24 U30 L24 D30", o, [2], { x: 2, y: 0 })!;
    expect(r.vectors).toBe("R24 U30 L24 D30".replace("U30", "R2'U30'").replace("L24", "L26'"));
    expect(area(parseVectors(r.vectors, r.origin).path)).toBeCloseTo(720 + 30, 9);
  });

  it("dragging a wall (both its corners) keeps it parallel", () => {
    // East wall is wall 1, between corners 1 and 2: push it out 2'.
    const r = moveCorners("R24 U30 L24 D30", o, [1, 2], { x: 2, y: 0 })!;
    expect(r.vectors).toBe("R26' U30 L26' D30");
    expect(area(parseVectors(r.vectors, r.origin).path)).toBeCloseTo(26 * 30, 9);
  });

  it("moving the start corner moves the origin and the closing wall", () => {
    const r = moveCorners("R24 U30 L24 D30", o, [0, 1], { x: 0, y: -1 })!;
    expect(r).toEqual({ vectors: "R24 U31' L24 D31'", origin: { x: 0, y: -1 } });
    expect(closure(parseVectors(r.vectors, r.origin).path).closed).toBe(true);
  });

  it("keeps CL and arc depths", () => {
    const r = moveCorners("R20^3 U10 L20 CL", o, [1, 2], { x: 1, y: 0 })!;
    expect(r.vectors).toBe("R21'^3 U10 L21' CL");
    const p = parseVectors(r.vectors, r.origin).path;
    expect(closure(p).closed).toBe(true);
    expect(p.segments[0]!.kind).toBe("arc");
  });

  it("drops a wall dragged to nothing, and moves the pen on an open outline", () => {
    expect(moveCorners("R10 U5 R10", o, [2, 3], { x: 0, y: -5 })!.vectors).toBe("R10 R10");
    expect(moveCorners("R10 U5", o, [2], { x: 1, y: 0 })!.vectors).toBe("R10 R1'U5'");
  });
});

describe("short moves", () => {
  it("write inches alone under a foot", () => {
    expect(moveToken(0, -0.25)).toBe('D3"');
    expect(parseVectors('D3"').path.segments[0]!.to).toEqual({ x: 0, y: -0.25 });
    expect(moveToken(1, 0)).toBe("R1'");
  });
});

describe("adjust the last wall with arrows", async () => {
  const { adjustLastWall, setLengthStyle, formatLength } = await import("../src/geometry/index.js");
  const inch = 1 / 12;
  it("lengthens and shortens by an inch", () => {
    expect(adjustLastWall("R24 ", 4, "right", inch)).toEqual({ text: "R24'1\" ", caret: 7 });
    expect(adjustLastWall("R24 ", 4, "left", inch)!.text).toBe("R23'11\" ");
    expect(adjustLastWall("R24 U30'1\" ", 11, "down", inch)!.text).toBe("R24 U30' ");
    expect(adjustLastWall("U8\" ", 4, "down", inch)!.text).toBe('U7" ');
  });
  it("ignores crosswise arrows, diagonals and a wall shrinking to nothing", () => {
    expect(adjustLastWall("R24 ", 4, "up", inch)).toBeNull();
    expect(adjustLastWall("R10U5 ", 6, "right", inch)).toBeNull();
    expect(adjustLastWall('R1" ', 4, "left", inch)).toBeNull();
    expect(adjustLastWall("", 0, "left", inch)).toBeNull();
  });
  it("works in decimal feet", () => {
    setLengthStyle("decimal");
    try {
      expect(formatLength(24.5)).toBe("24.5'");
      expect(formatLength(24 + 1 / 12)).toBe("24.08'");
      expect(adjustLastWall("R24 ", 4, "right", 0.1)!.text).toBe("R24.1' ");
      expect(moveToken(0, -0.25)).toBe("D0.25'");
      expect(parseVectors("R24.1' U30").path.segments[0]!.to.x).toBeCloseTo(24.1, 9);
    } finally {
      setLengthStyle("ftin");
    }
  });
});

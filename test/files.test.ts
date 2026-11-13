import { describe, expect, it } from "vitest";
import { computeSketch } from "../src/geometry/index.js";
import { SketchFileError, parseSketchFile, serialize } from "../src/app/files.js";
import { renderSketch } from "../src/app/render.js";
import { newSketch } from "../src/app/store.js";

const file = (structures: unknown, extra: object = {}) => JSON.stringify({ formatVersion: 1, meta: { ansi: true }, structures, ...extra });
const area = (over: object = {}) => ({ id: "a1", name: "First floor", vectors: "R24 U30 L24 D30", ...over });
const draws = (text: string) => {
  const result = computeSketch(parseSketchFile(text));
  return renderSketch(result, { width: 800, height: 600, view: { scale: 10, ox: 0, oy: 0 }, selection: null });
};

describe("sketch files", () => {
  it("round-trips a full sketch unchanged", () => {
    const sk = newSketch();
    const a = sk.structures[0]!.areas[0]!;
    Object.assign(a, {
      vectors: "R24 U30 L24 D30",
      zones: [{ id: "z1", name: "Knee wall", band: "low", origin: { x: 0, y: 0 }, vectors: "R24 U4 L24 D4" }],
      stairs: [{ id: "t1", type: "u", origin: { x: 2, y: 8 }, rotation: 90, width: 3, run1: 8, run2: 6, turn: "left", direction: "down" }],
      override: { bucket: "gla", note: "per client" },
      label: { x: 1, y: -2 },
      hideDims: true,
      hiddenDims: [0, 2],
    });
    sk.meta.subject = "12 Main St";
    sk.meta.showDims = false;
    sk.texts = [{ id: "x1", text: "Kitchen", at: { x: 5, y: 5 } }];
    expect(parseSketchFile(serialize(sk))).toEqual(sk);
  });

  it("fills in fields an older file does not have", () => {
    const sk = parseSketchFile(file([{ areas: [{ vectors: "R10 U10 L10 D10" }] }]));
    const a = sk.structures[0]!.areas[0]!;
    expect(a).toMatchObject({ name: "New area", kind: "living", grade: "above", finished: true, origin: { x: 0, y: 0 }, zones: [], stairs: [] });
    expect(sk.structures[0]).toMatchObject({ name: "Structure", kind: "dwelling" });
    expect(computeSketch(sk).structures[0]!.reported.gla).toBe(100);
  });

  it.each([
    ["a structure that is not an object", file([null])],
    ["an area that is not an object", file([{ areas: [null] }])],
    ["areas that are not a list", file([{ areas: {} }])],
    ["walls that are not text", file([{ areas: [area({ vectors: 5 })] }])],
    ["a start point that is missing a coordinate", file([{ areas: [area({ origin: { x: 1 } })] }])],
    ["a start point that is null", file([{ areas: [area({ origin: null })] }])],
    ["an unknown area type", file([{ areas: [area({ kind: "moat" })] }])],
    ["zones that are null", file([{ areas: [area({ zones: null })] }])],
    ["a zone with no ceiling band", file([{ areas: [area({ zones: [{ origin: { x: 0, y: 0 }, vectors: "" }] })] }])],
    ["a stair with no width to speak of", file([{ areas: [area({ stairs: [{ width: 0 }] })] }])],
    ["a stair of an unknown type", file([{ areas: [area({ stairs: [{ type: "spiral" }] })] }])],
    ["an override with an unknown bucket", file([{ areas: [area({ override: { bucket: "x", note: "" } })] }])],
    ["hidden dimensions that are not wall numbers", file([{ areas: [area({ hiddenDims: ["a"] })] }])],
    ["a header that is not an object", file([], { meta: 3 })],
  ])("refuses %s with a readable message", (_what, text) => {
    expect(() => parseSketchFile(text)).toThrow(SketchFileError);
    expect(() => parseSketchFile(text)).toThrow(/damaged/);
  });

  it("names the damaged part", () => {
    expect(() => parseSketchFile(file([{ areas: [area(), area({ vectors: 5 })] }]))).toThrow("structure 1, area 2: vectors");
  });

  it("tells a file with no format version from one saved by a newer version", () => {
    expect(() => parseSketchFile(JSON.stringify({ structures: [] }))).toThrow(/no format version/);
    expect(() => parseSketchFile(JSON.stringify({ structures: [], formatVersion: 99 }))).toThrow(/newer version/);
  });

  it("anything it accepts can be computed and drawn", () => {
    expect(draws(file([{ areas: [area({ stairs: [{}], zones: [{ band: "low", origin: { x: 0, y: 0 } }] })] }]))).toContain("<svg");
    expect(draws(file([]))).toContain("<svg");
  });
});

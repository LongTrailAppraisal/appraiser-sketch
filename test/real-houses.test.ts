/**
 * Real houses, re-entered from past Total Sketch exhibits. Expected figures are
 * Total's own area calculation table. Addresses and job numbers are kept out of
 * the repo (see test/fixtures/private/, gitignored).
 */
import { describe, expect, it } from "vitest";
import { computeStructure, type Area, type Structure } from "../src/geometry/index.js";

const area = (name: string, vectors: string, over: Partial<Area> = {}): Area => ({
  id: name,
  name,
  kind: "living",
  grade: "above",
  finished: true,
  level: "1",
  connected: true,
  ceiling: "full",
  origin: { x: 0, y: 0 },
  vectors,
  zones: [],
  ...over,
});

const house = (areas: Area[]): Structure => ({ id: "main", name: "Main", kind: "dwelling", areas });

const byName = (r: ReturnType<typeof computeStructure>) =>
  Object.fromEntries(r.areas.map((a) => [a.area.name, a]));

describe("House A: two-story with mud room, closed porch, deck", () => {
  const r = computeStructure(
    house([
      area("Mud room", "R12 U12'4\" L12 D12'4\""),
      area("First floor", "R34'6\" U26'4\" L34'6\" D26'4\""),
      area("Second floor", "R34'6\" U26'4\" L34'6\" D26'4\"", { level: "2" }),
      area("Closed porch", "R34'6\" U10 L34'6\" D10", { kind: "porch" }),
      area("Wood deck", "R12 U8 L12 D8", { kind: "deck" }),
    ]),
  );
  const a = byName(r);

  it("matches each area in Total's table", () => {
    expect(a["Mud room"]!.ansi.counted).toBeCloseTo(148, 2);
    expect(a["First floor"]!.ansi.counted).toBeCloseTo(908.5, 2);
    expect(a["Second floor"]!.ansi.counted).toBeCloseTo(908.5, 2);
    expect(a["Closed porch"]!.ansi.counted).toBeCloseTo(345, 2);
    expect(a["Wood deck"]!.ansi.counted).toBeCloseTo(96, 2);
  });

  it("reports GLA 1,965", () => {
    expect(r.reported).toMatchObject({ gla: 1965, porch: 345, deck: 96 });
    expect(r.areas.flatMap((x) => x.problems)).toEqual([]);
  });
});

describe("House B: traditional, out-of-square first floor, basement, 1-car garage", () => {
  const r = computeStructure(
    house([
      // 1" lean over 36'8": Total splits it into a rectangle plus two triangles.
      area("First floor", "R24'8\" U36'8\"L1\" L24'8\" D36'8\"R1\""),
      area("Second floor", "R24'8\" U26'8\" L24'8\" D26'8\"", { level: "2" }),
      area("Basement", "R24'4\" U36'4\" L24'4\" D36'4\"", { level: "basement", grade: "below", finished: false }),
      area("Closed porch", "R5 U5 L5 D5", { kind: "porch" }),
      area("Open porch", "R20'2\" U8 L20'2\" D8", { kind: "porch" }),
      area("1-car garage", "R12'6\" U18'4\" L12'6\" D18'4\"", { kind: "garage" }),
      area("Wood deck", "R24 U11 L24 D11", { kind: "deck" }),
    ]),
  );
  const a = byName(r);

  it("matches each area in Total's table", () => {
    expect(a["First floor"]!.ansi.counted).toBeCloseTo(904.44, 2);
    expect(a["Second floor"]!.ansi.counted).toBeCloseTo(657.78, 2);
    expect(a["Basement"]!.ansi.counted).toBeCloseTo(884.11, 2);
    expect(a["Open porch"]!.ansi.counted).toBeCloseTo(161.33, 2);
    expect(a["1-car garage"]!.ansi.counted).toBeCloseTo(229.17, 2);
  });

  it("reports the UAD 3.6 figures", () => {
    expect(r.reported).toMatchObject({ gla: 1562, unfinishedBelow: 884, garage: 229, porch: 186, deck: 264 });
    const lv = Object.fromEntries(r.levels.map((l) => [l.level, Math.round(l.finished)]));
    expect(lv).toEqual({ "1": 904, "2": 658, basement: 0 });
  });
});

describe("House C: colonial with notched, out-of-square first floor and 2-car garage", () => {
  const r = computeStructure(
    house([
      // From the family room's back-left corner, clockwise. The 25'10" rear wall rises 2".
      area("First floor", "R16'2\" D8'10\" R5 D2'10\" R25'10\"U2\" D26'10\" L30'10\" U9'2\" L16'2\" U29'2\""),
      area("Second floor", "R30'10\" U26'10\" L30'10\" D26'10\"", { level: "2" }),
      area("Basement", "R30'6\" U26'6\" L30'6\" D26'6\"", { level: "basement", grade: "below", finished: false }),
      area("Screened porch", "R22 U16 L22 D16", { kind: "porch" }),
      area("2-car garage", "R24'2\" U29'2\" L24'2\" D29'2\"", { kind: "garage" }),
    ]),
  );
  const a = byName(r);

  it("closes and matches each area in Total's table", () => {
    expect(r.areas.flatMap((x) => x.problems)).toEqual([]);
    expect(a["First floor"]!.ansi.counted).toBeCloseTo(1310.07, 2);
    expect(a["Second floor"]!.ansi.counted).toBeCloseTo(827.36, 2);
    expect(a["Basement"]!.ansi.counted).toBeCloseTo(808.25, 2);
    expect(a["2-car garage"]!.ansi.counted).toBeCloseTo(704.86, 2);
  });

  it("reports GLA 2,137", () => {
    expect(r.reported).toMatchObject({ gla: 2137, unfinishedBelow: 808, garage: 705, porch: 352 });
  });
});

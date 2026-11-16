import { describe, expect, it } from "vitest";
import { classify, computeSketch, levelRank, type Area, type Sketch } from "../src/geometry/index.js";
import { reportExport } from "../src/export/report.js";
import { levelName, totalGroups, totalsText } from "../src/export/text.js";
import { parseSketchFile, serialize } from "../src/app/files.js";

const area = (name: string, vectors: string, over: Partial<Area> = {}): Area => ({
  id: name, name, kind: "living", grade: "above", finished: true, level: "main", connected: true,
  ceiling: "full", origin: { x: 0, y: 0 }, vectors, zones: [], stairs: [], ...over,
});

// A tri-level: main level, an upper level half a floor up, a lower level partly below grade.
const sketch: Sketch = {
  formatVersion: 1,
  meta: { ansi: true },
  structures: [
    {
      id: "h", name: "Dwelling", kind: "dwelling",
      areas: [
        area("Upper", "R26 U24 L26 D24", { level: "upper" }),
        area("Lower", "R26 U24 L26 D24", { level: "lower", grade: "partial" }),
        area("Main", "R24 U28 L24 D28"),
      ],
    },
  ],
};

describe("partly below grade", () => {
  it("counts as below grade under ANSI, finished or not", () => {
    const base = { kind: "living" as const, connected: true, ceiling: "full" as const, grossArea: 100, zones: [] };
    expect(classify({ ...base, grade: "partial", finished: true }).bucket).toBe("finishedBelow");
    expect(classify({ ...base, grade: "partial", finished: false }).bucket).toBe("unfinishedBelow");
  });

  it("keeps the level's grade for the report", () => {
    const r = computeSketch(sketch);
    const s = r.structures[0]!;
    expect(s.reported.gla).toBe(24 * 28 + 26 * 24);
    expect(s.reported.finishedBelow).toBe(26 * 24);
    const below = totalGroups(s).find((g) => g.name === "Finished below grade")!;
    expect(below.levels).toEqual([{ level: "lower", grade: "partial", sf: 624 }]);
    const rows = reportExport(r).structures[0]!.totals.filter((t) => t.level);
    expect(rows.map((t) => [t.label, t.grade])).toEqual([
      ["Main level", "above"],
      ["Upper level", "above"],
      ["Lower level", "partial"],
    ]);
    expect(totalsText(r)).toMatch(/Lower level: 624 sf/);
  });

  it("reads and writes the new grade in sketch files", () => {
    const back = parseSketchFile(serialize(sketch));
    expect(back.structures[0]!.areas[1]!.grade).toBe("partial");
  });
});

describe("split-level names", () => {
  it("sort lower, main, upper, then 2", () => {
    const order = ["2", "upper", "lower level", "main", "1"].sort((a, b) => levelRank(a) - levelRank(b));
    expect(order).toEqual(["lower level", "main", "1", "upper", "2"]);
  });
  it("have display names", () => {
    expect(levelName("upper")).toBe("Upper level");
    expect(levelName("lower")).toBe("Lower level");
  });
});

describe("sloped zones in sketch files", () => {
  it("round-trip with their slope, and a damaged slope is refused", () => {
    const withSlope: Sketch = structuredClone(sketch);
    const slope = { from: { x: 0, y: 0 }, to: { x: 0, y: 6 }, fromHeight: 2, toHeight: 8 };
    withSlope.structures[0]!.areas[0]!.zones.push({ id: "z1", band: "sloped", origin: { x: 0, y: 0 }, vectors: "R26 U6 L26 D6", slope });
    const back = parseSketchFile(serialize(withSlope));
    expect(back.structures[0]!.areas[0]!.zones[0]).toMatchObject({ band: "sloped", slope });
    const bad = serialize(withSlope).replace('"fromHeight": 2', '"fromHeight": "two"');
    expect(() => parseSketchFile(bad)).toThrow(/slope/);
  });
});

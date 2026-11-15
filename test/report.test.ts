import { describe, expect, it } from "vitest";
import { computeSketch, type Area, type Sketch } from "../src/geometry/index.js";
import { reportExport, reportExportJson } from "../src/export/report.js";
import { totalsText } from "../src/export/text.js";

const area = (name: string, vectors: string, over: Partial<Area> = {}): Area => ({
  id: name, name, kind: "living", grade: "above", finished: true, level: "1", connected: true,
  ceiling: "full", origin: { x: 0, y: 0 }, vectors, zones: [], stairs: [], ...over,
});

const sketch: Sketch = {
  formatVersion: 1,
  meta: { ansi: true, subject: "1 Test Rd", fileNumber: "T-1" },
  structures: [
    {
      id: "h", name: "Main house", kind: "dwelling",
      areas: [
        area("First floor", "R40 U25 L40 D25"),
        area("Second floor", "R40 U25 L40 D25", { level: "2" }),
        area("Basement", "R40 U25 L40 D25", { grade: "below", finished: false, level: "basement" }),
        area("Garage", "R24 U24 L24 D24", { kind: "garage", origin: { x: 0, y: -25 } }),
      ],
    },
    { id: "b", name: "Bank barn", kind: "barn", areas: [area("Barn", "R36 U60 L36 D60", { kind: "other" })] },
    { id: "e", name: "Empty", kind: "shed", areas: [] },
  ],
};

describe("report export", () => {
  const r = computeSketch(sketch);
  const x = reportExport(r);

  it("carries format, standard and dwelling GLA", () => {
    expect(x.formatVersion).toBe(1);
    expect(x.standard).toBe("ANSI Z765-2021");
    expect(x.gla).toBe(2000);
    expect(x.meta.fileNumber).toBe("T-1");
  });

  it("lists structures with kinds, leaving empty ones out", () => {
    expect(x.structures.map((s) => [s.name, s.kind, s.kindLabel])).toEqual([
      ["Main house", "dwelling", "Dwelling"],
      ["Bank barn", "barn", expect.any(String)],
    ]);
  });

  it("matches the paste-ready totals, with levels under their group", () => {
    const house = x.structures[0]!;
    expect(house.buckets.gla).toBe(2000);
    expect(house.buckets.unfinishedBelow).toBe(1000);
    expect(house.buckets.garage).toBe(576);
    const gla = house.totals.find((t) => t.bucket === "gla")!;
    expect(gla.area).toBe(2000);
    expect(house.totals.filter((t) => t.level && t.group === gla.group).map((t) => [t.label, t.area])).toEqual([
      ["Level 1", 1000],
      ["Level 2", 1000],
    ]);
    // every total in the export also appears in the paste-ready block
    const text = totalsText(r);
    for (const t of house.totals) expect(text).toContain(`${t.area.toLocaleString("en-US")} sf`);
  });

  it("embeds a standalone SVG and is valid JSON", () => {
    expect(x.svg.startsWith("<svg")).toBe(true);
    expect(JSON.parse(reportExportJson(r)).structures).toHaveLength(2);
  });

  it("reports overrides and the ANSI-off case", () => {
    const off = reportExport(computeSketch({ ...sketch, meta: { ...sketch.meta, ansi: false } }));
    expect(off.standard).toBeNull();
    expect(off.ansi).toBe(false);
  });
});

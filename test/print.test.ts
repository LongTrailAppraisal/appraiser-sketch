import { describe, expect, it } from "vitest";
import { computeSketch, defaultStair, type Area, type Sketch } from "../src/geometry/index.js";
import { areaFormula, printPageHtml } from "../src/export/print.js";
import { drawingBounds, standaloneSvg } from "../src/export/svg.js";

const area = (name: string, vectors: string, over: Partial<Area> = {}): Area => ({
  id: name, name, kind: "living", grade: "above", finished: true, level: "1", connected: true,
  ceiling: "full", origin: { x: 0, y: 0 }, vectors, zones: [], stairs: [], ...over,
});

const sketch: Sketch = {
  formatVersion: 1,
  meta: { ansi: true, subject: "1 Test Rd, Testville", fileNumber: "T-1", borrower: "A & B <Co>" },
  structures: [
    {
      id: "s", name: "Main house", kind: "dwelling",
      areas: [
        area("First floor", "R63'4\" U28'4\" L63'4\" D28'4\"", { stairs: [defaultStair({ id: "t", origin: { x: 2, y: 2 } })] }),
        area("Garage", "R26'4\" U26'2\" L26'4\" D26'2\"", { kind: "garage", origin: { x: 0, y: -27 } }),
        area("Ell", "R40 U24 L16 U12 L24 D36", { origin: { x: 70, y: 0 } }),
      ],
    },
  ],
};

describe("print page", () => {
  const r = computeSketch(sketch);
  const html = printPageHtml(r);

  it("gives a W × D formula only for plain rectangles", () => {
    const [ff, gar, ell] = r.structures[0]!.areas;
    expect(areaFormula(ff!)).toBe("63'4\" × 28'4\"");
    expect(areaFormula(gar!)).toBe("26'4\" × 26'2\"");
    expect(areaFormula(ell!)).toBe("");
  });

  it("has the header, each area, and the rounded totals", () => {
    expect(html).toContain("1 Test Rd, Testville");
    expect(html).toContain("A &amp; B &lt;Co&gt;"); // escaped
    expect(html).toContain("1,794.4");
    expect(html).toMatch(/Standard finished above grade \(GLA\)<\/td><td class="num">3,042</); // 1,794.4 + 1,248
    expect(html).toMatch(/Garage<\/td><td class="num">689</);
    expect(html).toContain("Measured to ANSI Z765-2021");
  });

  it("embeds a self-contained SVG with its own styles and no grid", () => {
    const svg = standaloneSvg(r, 720, 560);
    expect(svg).toMatch(/^<svg[^>]*><style>/);
    expect(svg).not.toContain("grid");
    expect(svg).not.toContain("pen-mark");
    expect(svg).toContain('class="stair');
  });

  it("fits around outlines and stairs", () => {
    const b = drawingBounds(r)!;
    expect(b.minX).toBeCloseTo(0, 9);
    expect(b.maxX).toBeCloseTo(110, 9);
    expect(b.minY).toBeCloseTo(-27, 9);
    expect(b.maxY).toBeCloseTo(36, 9);
  });
});

describe("room labels", () => {
  it("are saved, reloaded and drawn on the printed sketch", async () => {
    const { parseSketchFile, serialize } = await import("../src/app/files.js");
    const { computeSketch } = await import("../src/geometry/index.js");
    const { standaloneSvg } = await import("../src/export/svg.js");
    const sk = parseSketchFile(
      JSON.stringify({
        formatVersion: 1,
        meta: { ansi: true },
        structures: [],
        texts: [{ id: "t1", text: "Kitchen", at: { x: 5, y: 5 } }, { text: 3 }],
      }),
    );
    expect(sk.texts).toEqual([{ id: "t1", text: "Kitchen", at: { x: 5, y: 5 } }]);
    expect(parseSketchFile(serialize(sk)).texts).toEqual(sk.texts);
    expect(standaloneSvg(computeSketch(sk), 400, 300)).toContain(">Kitchen</text>");
  });
});

describe("hidden dimensions", () => {
  it("stay off the printed drawing", async () => {
    const { computeSketch } = await import("../src/geometry/index.js");
    const { standaloneSvg } = await import("../src/export/svg.js");
    const sk = (hiddenDims?: number[]) => ({
      formatVersion: 1, meta: { ansi: true },
      structures: [{ id: "s", name: "Dwelling", kind: "dwelling" as const, areas: [{
        id: "a", name: "First floor", kind: "living" as const, grade: "above" as const, finished: true, level: "1",
        connected: true, ceiling: "full" as const, origin: { x: 0, y: 0 }, vectors: "R30 U24 L30 D24", zones: [], stairs: [],
        ...(hiddenDims ? { hiddenDims } : {}),
      }] }],
    });
    const count = (svg: string) => (svg.match(/class="dim"/g) ?? []).length;
    expect(count(standaloneSvg(computeSketch(sk()), 600, 400))).toBe(4);
    expect(count(standaloneSvg(computeSketch(sk([1, 2])), 600, 400))).toBe(2);
  });
});

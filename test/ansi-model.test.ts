import { describe, expect, it } from "vitest";
import {
  classify,
  computeArea,
  computeSketch,
  roundTotals,
  totalByBucket,
  type AnsiInput,
  type Area,
  type Sketch,
} from "../src/geometry/index.js";

const living = (over: Partial<AnsiInput> = {}): AnsiInput => ({
  kind: "living",
  grade: "above",
  finished: true,
  connected: true,
  ceiling: "full",
  grossArea: 1000,
  zones: [],
  ...over,
});

describe("ANSI classification", () => {
  it("finished, above grade, connected, 7' ceiling -> GLA", () => {
    const r = classify(living());
    expect(r.bucket).toBe("gla");
    expect(r.counted).toBe(1000);
    expect(r.nonAnsi).toBe(false);
  });

  it("cape second floor: under-5' space excluded, passes the 50% test", () => {
    const r = classify(
      living({ grossArea: 600, zones: [{ band: "low", area: 100 }, { band: "reduced", area: 150 }] }),
    );
    expect(r.bucket).toBe("gla");
    expect(r.counted).toBe(500);
    expect(r.notCounted).toBe(100);
  });

  it("sloped ceiling with under half at 7' is non-standard finished area", () => {
    const r = classify(living({ grossArea: 600, ceiling: "reduced", zones: [{ band: "full", area: 200 }] }));
    expect(r.bucket).toBe("nonStandardAbove");
    expect(r.counted).toBe(600);
    expect(r.warnings.join()).toMatch(/less than half/);
  });

  it("flat ceiling under 7' is non-standard finished area, above or below grade", () => {
    expect(classify(living({ ceiling: "reduced" })).bucket).toBe("nonStandardAbove");
    expect(classify(living({ ceiling: "reduced", grade: "below" })).bucket).toBe("nonStandardBelow");
  });

  it("all under 5' is excluded", () => {
    const r = classify(living({ ceiling: "low" }));
    expect(r.bucket).toBe("excluded");
    expect(r.counted).toBe(0);
  });

  it("exactly half at 7' passes", () => {
    const r = classify(living({ ceiling: "reduced", zones: [{ band: "full", area: 500 }] }));
    expect(r.bucket).toBe("gla");
  });

  it("opening to the floor below is not counted", () => {
    const r = classify(living({ zones: [{ band: "opening", area: 120 }] }));
    expect(r.counted).toBe(880);
  });

  it("below grade finished and unfinished", () => {
    expect(classify(living({ grade: "below" })).bucket).toBe("finishedBelow");
    expect(classify(living({ grade: "below", finished: false })).bucket).toBe("unfinishedBelow");
  });

  it("not connected finished space is reported separately", () => {
    expect(classify(living({ connected: false })).bucket).toBe("finishedNotConnected");
  });

  it("unfinished above grade", () => {
    expect(classify(living({ finished: false })).bucket).toBe("unfinishedAbove");
  });

  it("non-living kinds go to their own bucket, whatever the flags", () => {
    expect(classify(living({ kind: "garage", grossArea: 576 }))).toMatchObject({ bucket: "garage", counted: 576 });
    expect(classify(living({ kind: "deck" })).bucket).toBe("deck");
  });

  it("override replaces the result and is flagged non-ANSI", () => {
    const r = classify(living({ ceiling: "reduced", override: { bucket: "gla", note: "6'10\" ceilings typical of 1850s capes" } }));
    expect(r).toMatchObject({ bucket: "gla", counted: 1000, nonAnsi: true });
    expect(r.warnings).toEqual([]);
  });

  it("override without a note warns", () => {
    const r = classify(living({ override: { bucket: "excluded", note: " " } }));
    expect(r.warnings.join()).toMatch(/no note/);
  });

  it("ANSI off counts low ceilings as finished", () => {
    expect(classify(living({ ceiling: "reduced" }), { ansi: false }).bucket).toBe("gla");
  });

  it("zones larger than the area warn", () => {
    const r = classify(living({ grossArea: 100, zones: [{ band: "low", area: 150 }] }));
    expect(r.warnings.join()).toMatch(/more than the area/);
  });

  it("totals round after summing", () => {
    const a = classify(living({ grossArea: 720.4 }));
    const b = classify(living({ grossArea: 527.4 }));
    const t = totalByBucket([a, b]);
    expect(t.gla).toBeCloseTo(1247.8, 9);
    expect(roundTotals(t).gla).toBe(1248);
  });
});

const area = (over: Partial<Area>): Area => ({
  id: "a",
  name: "Area",
  kind: "living",
  grade: "above",
  finished: true,
  level: "1",
  connected: true,
  ceiling: "full",
  origin: { x: 0, y: 0 },
  vectors: "",
  zones: [],
  ...over,
});

describe("model", () => {
  it("cape: computes zones from their own vectors", () => {
    // 24 x 30 upper floor; 4' strips along both long sides under 5'; 3' strips 5'-7'.
    const r = computeArea(
      area({
        name: "2nd floor",
        level: "2",
        vectors: "R24 U30 L24 D30",
        zones: [
          { id: "z1", band: "low", origin: { x: 0, y: 0 }, vectors: "R4 U30 L4 D30" },
          { id: "z2", band: "low", origin: { x: 20, y: 0 }, vectors: "R4 U30 L4 D30" },
          { id: "z3", band: "reduced", origin: { x: 4, y: 0 }, vectors: "R3 U30 L3 D30" },
          { id: "z4", band: "reduced", origin: { x: 17, y: 0 }, vectors: "R3 U30 L3 D30" },
        ],
      }),
    );
    expect(r.problems).toEqual([]);
    expect(r.ansi.bucket).toBe("gla");
    expect(r.ansi.counted).toBeCloseTo(720 - 240, 9); // 480: 300 at ≥7', 180 at 5'-7'
    expect(r.ansi.full).toBeCloseTo(300, 9);
  });

  it("flags a zone outside its area, an open outline and vector errors", () => {
    const r = computeArea(
      area({
        vectors: "R24 U30 L24 D29 Q",
        zones: [{ id: "z1", name: "knee wall", band: "low", origin: { x: 20, y: 0 }, vectors: "R6 U30 L6 D30" }],
      }),
    );
    expect(r.zones[0]!.inside).toBe(false);
    const text = r.problems.join("\n");
    expect(text).toMatch(/"Q": unknown move/);
    expect(text).toMatch(/does not close: misses the start by 1' \(D1' to close\)/);
    expect(text).toMatch(/knee wall: extends outside/);
  });

  it("whole sketch: house with garage and ADU", () => {
    const sketch: Sketch = {
      formatVersion: 1,
      meta: { ansi: true, subject: "123 Main St" },
      structures: [
        {
          id: "s1",
          name: "Main house",
          kind: "dwelling",
          areas: [
            area({ id: "a1", name: "1st floor", vectors: "R40 U24 L16 U12 L24 D36" }),
            area({ id: "a2", name: "Basement", grade: "below", finished: false, vectors: "R40 U24 L40 D24" }),
            area({ id: "a3", name: "Garage", kind: "garage", origin: { x: 40, y: 0 }, vectors: "R24 U24 L24 D24" }),
            area({ id: "a4", name: "Deck", kind: "deck", origin: { x: 0, y: 36 }, vectors: "R12'6\" U10 L12'6\" D10" }),
          ],
        },
        {
          id: "s2",
          name: "ADU",
          kind: "adu",
          areas: [area({ id: "b1", name: "ADU", vectors: "R20 U24 L20 D24" })],
        },
      ],
    };
    const r = computeSketch(sketch);
    const main = r.structures[0]!;
    expect(main.reported).toMatchObject({ gla: 1248, unfinishedBelow: 960, garage: 576, deck: 125 });
    expect(r.structures[1]!.reported.gla).toBe(480);
    expect(r.nonAnsi).toBe(false);
  });

  it("an override marks the sketch non-ANSI and lists the note", () => {
    const sketch: Sketch = {
      formatVersion: 1,
      meta: { ansi: true },
      structures: [
        {
          id: "s1",
          name: "Main",
          kind: "dwelling",
          areas: [area({ name: "Attic", vectors: "R10 U10 L10 D10", override: { bucket: "excluded", note: "no permanent stair" } })],
        },
      ],
    };
    const r = computeSketch(sketch);
    expect(r.nonAnsi).toBe(true);
    expect(r.structures[0]!.overrides).toEqual([{ area: "Attic", note: "no permanent stair" }]);
  });
});

describe("structure names follow the type", async () => {
  const { defaultStructureName, isDefaultStructureName } = await import("../src/geometry/index.js");
  it("names from the type, numbered when taken", () => {
    expect(defaultStructureName("barn", [])).toBe("Barn");
    expect(defaultStructureName("barn", ["Dwelling", "Barn"])).toBe("Barn 2");
    expect(defaultStructureName("garage", ["Detached garage", "Detached garage 2"])).toBe("Detached garage 3");
  });
  it("knows automatic names from typed ones", () => {
    for (const n of ["Dwelling", "Barn 2", "Main house", "Structure 3", ""]) expect(isDefaultStructureName(n)).toBe(true);
    for (const n of ["Smith barn", "Guest house", "Barn loft"]) expect(isDefaultStructureName(n)).toBe(false);
  });
});

describe("zone warnings", () => {
  it("call an unnamed zone by its number, never its internal id", () => {
    const area = {
      id: "a1", name: "Attic", kind: "living", grade: "above", finished: true, level: "2", connected: true, ceiling: "full",
      origin: { x: 0, y: 0 }, vectors: "R20 U10 L20 D10",
      zones: [
        { id: "zmh2x1", band: "low", origin: { x: 0, y: 0 }, vectors: "R20 U4 L20 D4" },
        { id: "zmh2x2", band: "low", origin: { x: 15, y: 6 }, vectors: "R10 U4 L10 D4" },
        { id: "zmh2x3", name: "Dormer", band: "reduced", origin: { x: 0, y: 8 }, vectors: "R5 U5 L5 D5" },
      ],
    } as const;
    const problems = computeArea(structuredClone(area) as unknown as Parameters<typeof computeArea>[0]).problems;
    expect(problems).toContain("zone 2: extends outside the area");
    expect(problems).toContain("zone Dormer: extends outside the area");
    expect(problems.join(" ")).not.toContain("zmh2x");
  });
});

import { describe, expect, it } from "vitest";
import { TEMPLATES, area, checkTemplate, closure, parseVectors, selfIntersects } from "../src/geometry/index.js";

const defaults = (id: string) => {
  const t = TEMPLATES.find((x) => x.id === id)!;
  return { t, p: Object.fromEntries(t.params.map((q) => [q.key, q.value])) as Record<string, number> };
};

function shapeOf(id: string, over: Record<string, number> = {}) {
  const { t, p } = defaults(id);
  const r = parseVectors(t.build({ ...p, ...over }));
  expect(r.errors).toEqual([]);
  expect(closure(r.path).closed).toBe(true);
  expect(selfIntersects(r.path)).toBe(false);
  return r.path;
}

/** Circular segment area, classic formula. */
const segment = (c: number, s: number) => {
  const r = (c * c) / (8 * s) + s / 2;
  return r * r * Math.acos((r - s) / r) - (r - s) * Math.sqrt(2 * r * s - s * s);
};

describe("templates", () => {
  it("rectangle", () => expect(area(shapeOf("rect"))).toBeCloseTo(720, 9));
  it("L-shape gives the 1,248 sf L", () => expect(area(shapeOf("l"))).toBeCloseTo(1248, 9));
  it("bump-out adds its rectangle", () => expect(area(shapeOf("bump"))).toBeCloseTo(720 + 40, 9));
  it("45° bay adds a trapezoid", () => expect(area(shapeOf("bay45"))).toBeCloseTo(720 + ((4 + 8) / 2) * 2, 9));
  it("bow window adds a circular segment", () => expect(area(shapeOf("bow"))).toBeCloseTo(720 + segment(10, 2), 9));
  it("garage and deck", () => {
    expect(area(shapeOf("garage"))).toBeCloseTo(576, 9);
    expect(area(shapeOf("deck"))).toBeCloseTo(192, 9);
    expect(TEMPLATES.find((t) => t.id === "garage")!.kind).toBe("garage");
  });
  it("feet-inches dimensions", () => expect(area(shapeOf("rect", { w: 24.5, d: 30 + 4 / 12 }))).toBeCloseTo(24.5 * (30 + 4 / 12), 9));

  it("rejects dimensions that don't fit", () => {
    const l = defaults("l");
    expect(checkTemplate(l.t, { ...l.p, ww: 40 })).toMatch(/narrower/);
    const bay = defaults("bay45");
    expect(checkTemplate(bay.t, { ...bay.p, off: 26 })).toMatch(/fit/);
    expect(checkTemplate(bay.t, { ...bay.p, d: 0 })).toMatch(/more than 0/);
    expect(checkTemplate(bay.t, bay.p)).toBeNull();
  });
});

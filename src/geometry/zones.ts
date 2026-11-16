/**
 * Helpers for ceiling-height zones and openings inside an area. A zone is an
 * ordinary outline (origin + vectors) tagged with a ceiling band or "opening";
 * see ansi.ts for how the bands are counted.
 */

import type { CeilingBand } from "./ansi.js";
import type { Bounds, Point } from "./path.js";
import { formatLength } from "./units.js";

export type ZoneBand = CeilingBand | "opening";

export const ZONE_BANDS: { value: ZoneBand; label: string; short: string }[] = [
  { value: "low", label: "Ceiling under 5' (not counted)", short: "under 5'" },
  { value: "reduced", label: "Ceiling 5' to 7'", short: "5'–7'" },
  { value: "full", label: "Ceiling 7' or more", short: "7'+" },
  { value: "opening", label: "Open to below (not counted)", short: "open" },
];

/** What a zone marks: one ceiling band, an opening, or a sloped ceiling (see `Slope`). */
export type ZoneKind = ZoneBand | "sloped";

/** Short text for a zone: "under 5'", "open", "slope 2'–7'6"". */
export function zoneShort(z: { band: ZoneKind; slope?: Slope | undefined }): string {
  if (z.band === "sloped") {
    return z.slope ? `slope ${formatLength(z.slope.fromHeight)}–${formatLength(z.slope.toHeight)}` : "slope";
  }
  return ZONE_BANDS.find((b) => b.value === z.band)?.short ?? z.band;
}

/** Long text for a zone, as in the band list. */
export function zoneLabel(z: { band: ZoneKind; slope?: Slope | undefined }): string {
  if (z.band === "sloped") return `Sloped ceiling (${zoneShort(z).replace(/^slope /, "")})`;
  return ZONE_BANDS.find((b) => b.value === z.band)?.label ?? z.band;
}

export type Side = "north" | "south" | "east" | "west";

/**
 * A strip of the given depth along one side of a bounding box, e.g. the
 * under-5' space behind a Cape's knee wall. Returns an outline for a zone.
 * `inset` starts the strip that far in from the side (for a 5'–7' band
 * next to an under-5' strip).
 */
export function stripZone(b: Bounds, side: Side, depth: number, inset = 0): { origin: Point; vectors: string } {
  const f = formatLength;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  switch (side) {
    case "south":
      return { origin: { x: b.minX, y: b.minY + inset }, vectors: `R${f(w)} U${f(depth)} L${f(w)} D${f(depth)}` };
    case "north":
      return { origin: { x: b.minX, y: b.maxY - inset - depth }, vectors: `R${f(w)} U${f(depth)} L${f(w)} D${f(depth)}` };
    case "west":
      return { origin: { x: b.minX + inset, y: b.minY }, vectors: `R${f(depth)} U${f(h)} L${f(depth)} D${f(h)}` };
    case "east":
      return { origin: { x: b.maxX - inset - depth, y: b.minY }, vectors: `R${f(depth)} U${f(h)} L${f(depth)} D${f(h)}` };
  }
}

/**
 * A sloped ceiling over a zone. The height runs straight from `fromHeight`
 * on the line through `from` to `toHeight` on the line through `to` (both
 * lines square to from→to), and stays level beyond them. Points are
 * relative to the zone's origin, so the slope moves with the zone.
 * Same idea as the sketchie format's ceiling zones.
 */
export interface Slope {
  from: Point;
  to: Point;
  fromHeight: number;
  toHeight: number;
}

/** Ceiling heights where the ANSI bands change. */
export const BAND_LIMITS = { low: 5, full: 7 } as const;

/** Keep the part of a polygon where dot(n, p) <= c (Sutherland–Hodgman, one edge). */
export function clipHalfPlane(poly: Point[], n: Point, c: number): Point[] {
  const out: Point[] = [];
  const f = (p: Point) => n.x * p.x + n.y * p.y - c;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const fa = f(a);
    const fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function polyArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export interface SlopeBand {
  band: CeilingBand;
  /** The band's part of the zone (world coordinates), for drawing. */
  outline: Point[];
  area: number;
}

/** Ceiling height at a world point under a slope whose zone starts at `origin`. */
export function slopeHeightAt(slope: Slope, origin: Point, p: Point): number {
  const fx = origin.x + slope.from.x;
  const fy = origin.y + slope.from.y;
  const dx = slope.to.x - slope.from.x;
  const dy = slope.to.y - slope.from.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return slope.toHeight;
  const t = Math.min(1, Math.max(0, ((p.x - fx) * dx + (p.y - fy) * dy) / len2));
  return slope.fromHeight + (slope.toHeight - slope.fromHeight) * t;
}

/**
 * Split a zone outline (world coordinates) into its under-5', 5'–7' and 7'+
 * parts under a sloped ceiling. `exactArea` (the zone's true area, arcs
 * included) scales the parts so they add up to it exactly. Empty bands are
 * left out.
 */
export function slopeBands(outline: Point[], origin: Point, slope: Slope, exactArea?: number): SlopeBand[] {
  if (outline.length < 3) return [];
  const f = { x: origin.x + slope.from.x, y: origin.y + slope.from.y };
  const dx = slope.to.x - slope.from.x;
  const dy = slope.to.y - slope.from.y;
  const len = Math.hypot(dx, dy);
  const h0 = slope.fromHeight;
  const h1 = slope.toHeight;
  const bandOf = (h: number): CeilingBand => (h < BAND_LIMITS.low ? "low" : h < BAND_LIMITS.full ? "reduced" : "full");
  const total = polyArea(outline);
  const scale = exactArea !== undefined && total > 1e-9 ? exactArea / total : 1;

  if (len < 1e-9 || Math.abs(h1 - h0) < 1e-9) {
    return [{ band: bandOf(len < 1e-9 ? h1 : h0), outline, area: total * scale }];
  }
  const u = { x: dx / len, y: dy / len };
  const base = u.x * f.x + u.y * f.y;
  const lo = Math.min(h0, h1);
  const hi = Math.max(h0, h1);
  // The line where the ceiling is exactly H: base + distance along from→to.
  const sAt = (h: number) => base + (len * (h - h0)) / (h1 - h0);
  // Part of `poly` with a ceiling under H, or of H and over.
  const under = (poly: Point[], h: number): Point[] => {
    if (h <= lo) return [];
    if (h > hi) return poly;
    return h1 > h0 ? clipHalfPlane(poly, u, sAt(h)) : clipHalfPlane(poly, { x: -u.x, y: -u.y }, -sAt(h));
  };
  const over = (poly: Point[], h: number): Point[] => {
    if (h <= lo) return poly;
    if (h > hi) return [];
    return h1 > h0 ? clipHalfPlane(poly, { x: -u.x, y: -u.y }, -sAt(h)) : clipHalfPlane(poly, u, sAt(h));
  };
  const low = under(outline, BAND_LIMITS.low);
  const full = over(outline, BAND_LIMITS.full);
  const reduced = under(over(outline, BAND_LIMITS.low), BAND_LIMITS.full);
  const parts: SlopeBand[] = [];
  for (const [band, o] of [["low", low], ["reduced", reduced], ["full", full]] as const) {
    const a = o.length >= 3 ? polyArea(o) : 0;
    if (a > 1e-9) parts.push({ band, outline: o, area: a * scale });
  }
  return parts;
}

/**
 * A sloped-ceiling strip along one side of a bounding box: `run` deep, the
 * ceiling `wallHeight` at the wall rising to `topHeight` at the strip's inner
 * edge (where a Cape's slope meets the flat ceiling).
 */
export function slopeStrip(
  b: Bounds,
  side: Side,
  run: number,
  wallHeight: number,
  topHeight: number,
): { origin: Point; vectors: string; slope: Slope } {
  const strip = stripZone(b, side, run);
  // from/to relative to the strip's origin (its lower-left corner).
  const ft: Record<Side, [Point, Point]> = {
    south: [{ x: 0, y: 0 }, { x: 0, y: run }],
    north: [{ x: 0, y: run }, { x: 0, y: 0 }],
    west: [{ x: 0, y: 0 }, { x: run, y: 0 }],
    east: [{ x: run, y: 0 }, { x: 0, y: 0 }],
  };
  const [from, to] = ft[side];
  return { ...strip, slope: { from, to, fromHeight: wallHeight, toHeight: topHeight } };
}

/**
 * Change how far a sloped strip runs from its wall. When the zone is still a
 * plain rectangle with the slope running across it (as `slopeStrip` makes it),
 * the strip is resized to match, keeping its wall side in place. Otherwise
 * only the slope changes, since the outline was drawn by hand.
 */
export function setSlopeRun(
  zone: { origin: Point; vectors: string; slope: Slope },
  outline: Point[],
  run: number,
): { origin: Point; vectors: string; slope: Slope } {
  const { from, to } = zone.slope;
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len < 1e-9 || run <= 0) return zone;
  const dir = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
  const slope: Slope = { ...zone.slope, to: { x: from.x + dir.x * run, y: from.y + dir.y * run } };
  const fallback = { ...zone, slope };

  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const b = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const eps = 1e-6;
  const isRect = outline.length === 4 && Math.abs(polyArea(outline) - w * h) < eps * Math.max(1, w * h);
  const startsAtCorner = Math.abs(zone.origin.x - b.minX) < eps && Math.abs(zone.origin.y - b.minY) < eps;
  if (!isRect || !startsAtCorner) return fallback;
  const f = formatLength;
  const fx = zone.origin.x + from.x;
  const fy = zone.origin.y + from.y;
  const near = (a: number, c: number) => Math.abs(a - c) < eps;
  // The slope starts on the strip's wall side and runs straight across it, the full depth.
  if (near(dir.x, 0) && near(dir.y, 1) && near(fy, b.minY) && near(len, h)) {
    return { origin: zone.origin, vectors: `R${f(w)} U${f(run)} L${f(w)} D${f(run)}`, slope };
  }
  if (near(dir.x, 0) && near(dir.y, -1) && near(fy, b.maxY) && near(len, h)) {
    return {
      origin: { x: b.minX, y: b.maxY - run },
      vectors: `R${f(w)} U${f(run)} L${f(w)} D${f(run)}`,
      slope: { ...slope, from: { x: from.x, y: run }, to: { x: from.x, y: 0 } },
    };
  }
  if (near(dir.x, 1) && near(dir.y, 0) && near(fx, b.minX) && near(len, w)) {
    return { origin: zone.origin, vectors: `R${f(run)} U${f(h)} L${f(run)} D${f(h)}`, slope };
  }
  if (near(dir.x, -1) && near(dir.y, 0) && near(fx, b.maxX) && near(len, w)) {
    return {
      origin: { x: b.maxX - run, y: b.minY },
      vectors: `R${f(run)} U${f(h)} L${f(run)} D${f(h)}`,
      slope: { ...slope, from: { x: run, y: from.y }, to: { x: 0, y: from.y } },
    };
  }
  return fallback;
}

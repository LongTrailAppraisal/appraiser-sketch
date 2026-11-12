/**
 * Sketch data model and the computation that turns typed vectors into
 * areas and report totals. The vector text is the source of truth; nothing
 * computed here is stored in the file.
 */

import {
  FINISHED_BUCKETS,
  classify,
  roundTotals,
  totalByBucket,
  type AnsiResult,
  type AreaKind,
  type BucketTotals,
  type CeilingBand,
  type Grade,
  type Override,
} from "./ansi.js";
import {
  area as pathArea,
  closure,
  flatten,
  perimeter,
  selfIntersects,
  type Closure,
  type Path,
  type Point,
} from "./path.js";
import { stairDrawing, type Stair } from "./stairs.js";
import { formatFeetInches } from "./units.js";
import { parseVectors, type VectorError } from "./vectors.js";

export const FORMAT_VERSION = 1;

export interface Zone {
  id: string;
  name?: string;
  band: CeilingBand | "opening";
  origin: Point;
  vectors: string;
}

export interface Area {
  id: string;
  name: string;
  kind: AreaKind;
  grade: Grade;
  finished: boolean;
  /** Free label: "1", "2", "attic", "basement" … */
  level: string;
  connected: boolean;
  ceiling: CeilingBand;
  origin: Point;
  vectors: string;
  zones: Zone[];
  /** Stair symbols drawn on this level. They never change the area (ANSI: they count on the floor above). */
  stairs?: Stair[];
  override?: Override;
}

export type StructureKind = "dwelling" | "adu" | "garage" | "outbuilding";

export interface Structure {
  id: string;
  name: string;
  kind: StructureKind;
  areas: Area[];
}

export interface SketchMeta {
  subject?: string;
  client?: string;
  borrower?: string;
  fileNumber?: string;
  appraiser?: string;
  date?: string;
  /** ANSI Z765 rules on (default) or off for private work. */
  ansi: boolean;
}

export interface Sketch {
  formatVersion: number;
  meta: SketchMeta;
  structures: Structure[];
}

export interface ShapeResult {
  path: Path;
  errors: VectorError[];
  area: number;
  perimeter: number;
  closure: Closure;
  selfIntersects: boolean;
}

export function computeShape(vectors: string, origin: Point): ShapeResult {
  const { path, errors } = parseVectors(vectors, origin);
  return {
    path,
    errors,
    area: pathArea(path),
    perimeter: perimeter(path),
    closure: closure(path),
    selfIntersects: selfIntersects(path),
  };
}

export interface ZoneResult extends ShapeResult {
  zone: Zone;
  /** False if some of the zone lies outside its area's outline. */
  inside: boolean;
}

export interface AreaResult {
  area: Area;
  shape: ShapeResult;
  zones: ZoneResult[];
  ansi: AnsiResult;
  /** Every problem with this area, for display: vector errors, closure, ANSI warnings. */
  problems: string[];
}

/** The move that would close an outline, e.g. "D1'2\"" or "R3' U1'". */
export function closingMove(dx: number, dy: number): string {
  const parts: string[] = [];
  const tol = 1 / 24; // under half an inch rounds to nothing
  if (Math.abs(dx) >= tol) parts.push(`${dx > 0 ? "R" : "L"}${formatFeetInches(Math.abs(dx))}`);
  if (Math.abs(dy) >= tol) parts.push(`${dy > 0 ? "U" : "D"}${formatFeetInches(Math.abs(dy))}`);
  return parts.join(" ") || "under 1/2\"";
}

const EDGE_TOL = 1e-6;

function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y) <= EDGE_TOL;
  if (Math.abs(cross) / len > EDGE_TOL) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  return dot >= -EDGE_TOL && dot <= len * len + EDGE_TOL;
}

/** Point inside a polygon or on its boundary. */
export function containsPoint(poly: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (onSegment(p, a, b)) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function computeArea(area: Area, opts: { ansi?: boolean } = {}): AreaResult {
  const shape = computeShape(area.vectors, area.origin);
  const outline = flatten(shape.path);
  const problems: string[] = [];

  for (const e of shape.errors) problems.push(`"${e.text}": ${e.message}`);
  if (!shape.closure.closed && shape.path.segments.length > 0) {
    problems.push(
      `outline does not close: misses the start by ${formatFeetInches(shape.closure.distance)} ` +
        `(${closingMove(shape.closure.dx, shape.closure.dy)} to close); area assumes a straight closing wall`,
    );
  }
  if (shape.selfIntersects) problems.push("outline crosses itself; area is not reliable");

  const zones: ZoneResult[] = area.zones.map((zone) => {
    const s = computeShape(zone.vectors, zone.origin);
    const inside = flatten(s.path).every((p) => containsPoint(outline, p));
    const label = zone.name ?? zone.id;
    for (const e of s.errors) problems.push(`zone ${label}: "${e.text}": ${e.message}`);
    if (!s.closure.closed && s.path.segments.length > 0) problems.push(`zone ${label}: outline does not close`);
    if (!inside) problems.push(`zone ${label}: extends outside the area`);
    return { ...s, zone, inside };
  });

  (area.stairs ?? []).forEach((st, i) => {
    if (outline.length < 3) return;
    const pts = stairDrawing(st).parts.flat();
    if (!pts.every((p) => containsPoint(outline, p))) problems.push(`stair ${i + 1}: drawn outside the area`);
  });

  const ansi = classify(
    {
      kind: area.kind,
      grade: area.grade,
      finished: area.finished,
      connected: area.connected,
      ceiling: area.ceiling,
      grossArea: shape.area,
      zones: zones.map((z) => ({ band: z.zone.band, area: z.area })),
      override: area.override,
    },
    opts,
  );
  problems.push(...ansi.warnings);

  return { area, shape, zones, ansi, problems };
}

/** Finished/unfinished living area on one level (UAD 3.6 LEVEL). Unrounded. */
export interface LevelTotal {
  level: string;
  grade: Grade;
  finished: number;
  unfinished: number;
}

export interface StructureResult {
  structure: Structure;
  areas: AreaResult[];
  levels: LevelTotal[];
  /** Unrounded bucket totals. */
  exact: BucketTotals;
  /** Whole-square-foot totals for the report. */
  reported: BucketTotals;
  overrides: { area: string; note: string }[];
}

export function computeStructure(structure: Structure, opts: { ansi?: boolean } = {}): StructureResult {
  const areas = structure.areas.map((a) => computeArea(a, opts));
  const exact = totalByBucket(areas.map((a) => a.ansi));
  const levels = new Map<string, LevelTotal>();
  for (const a of areas) {
    if (a.area.kind !== "living" || a.ansi.bucket === "excluded") continue;
    const key = `${a.area.grade}:${a.area.level}`;
    const t = levels.get(key) ?? { level: a.area.level, grade: a.area.grade, finished: 0, unfinished: 0 };
    if (FINISHED_BUCKETS.has(a.ansi.bucket)) t.finished += a.ansi.counted;
    else t.unfinished += a.ansi.counted;
    levels.set(key, t);
  }
  return {
    structure,
    areas,
    levels: [...levels.values()],
    exact,
    reported: roundTotals(exact),
    overrides: areas
      .filter((a) => a.ansi.nonAnsi)
      .map((a) => ({ area: a.area.name, note: a.area.override?.note ?? "" })),
  };
}

export interface SketchResult {
  sketch: Sketch;
  structures: StructureResult[];
  /** True if ANSI rules are off or any area is overridden. */
  nonAnsi: boolean;
}

export function computeSketch(sketch: Sketch): SketchResult {
  const opts = { ansi: sketch.meta.ansi };
  const structures = sketch.structures.map((s) => computeStructure(s, opts));
  return {
    sketch,
    structures,
    nonAnsi: !sketch.meta.ansi || structures.some((s) => s.overrides.length > 0),
  };
}

/** Interior angles at the corners of a closed outline. */

import { closure, flatten, orientation, type Path, type Point } from "./path.js";

export interface CornerAngle {
  /** The corner. */
  at: Point;
  /** Interior angle, degrees (0–360; over 180 at an inside, re-entrant corner). */
  angle: number;
  /** Unit vector from the corner into the shape, halfway between its walls. */
  bisector: Point;
}

/** Direction leaving and arriving along each wall (arcs use their tangents). */
function directions(path: Path, k: number, orient: 1 | -1): { out: Point; in: Point } {
  const s = path.segments[k]!;
  // Flatten just this wall, in the outline's orientation, so arcs bulge the right way.
  const pts = s.kind === "arc" ? flattenSegment(path, k, orient) : [s.from, s.to];
  const a = pts[0]!;
  const b = pts[1]!;
  const y = pts[pts.length - 2]!;
  const z = pts[pts.length - 1]!;
  return { out: unit({ x: b.x - a.x, y: b.y - a.y }), in: unit({ x: z.x - y.x, y: z.y - y.y }) };
}

function flattenSegment(path: Path, k: number, _orient: 1 | -1): Point[] {
  // flatten() works on a whole path; flatten the full outline and pick this wall's points.
  const all = flatten(path, Math.PI / 64);
  const start = path.segments[k]!.from;
  const end = path.segments[k]!.to;
  const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9;
  const i = all.findIndex((p) => near(p, start));
  let j = i + 1;
  while (j < all.length && !near(all[j]!, end)) j++;
  const out = all.slice(i, j + 1);
  if (j >= all.length) out.push(end);
  return out.length >= 2 ? out : [start, end];
}

function unit(v: Point): Point {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

export function cornerAngles(path: Path): CornerAngle[] {
  const n = path.segments.length;
  if (n < 3 || !closure(path).closed) return [];
  const orient = orientation(path);
  const dirs = path.segments.map((_, k) => directions(path, k, orient));
  const out: CornerAngle[] = [];
  for (let k = 0; k < n; k++) {
    const leaving = dirs[k]!.out;
    const arriving = dirs[(k - 1 + n) % n]!.in;
    const back = { x: -arriving.x, y: -arriving.y };
    // Turn from the wall leaving to the wall arriving, measured through the inside.
    let a = Math.atan2(back.y, back.x) - Math.atan2(leaving.y, leaving.x);
    if (orient < 0) a = -a;
    a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (a === 0) a = 2 * Math.PI;
    const half = (orient * a) / 2;
    const bis = {
      x: leaving.x * Math.cos(half) - leaving.y * Math.sin(half),
      y: leaving.x * Math.sin(half) + leaving.y * Math.cos(half),
    };
    out.push({ at: { ...path.segments[k]!.from }, angle: (a * 180) / Math.PI, bisector: bis });
  }
  return out;
}

/** "90°", "135°", "126.9°". */
export function formatAngle(deg: number): string {
  const r = Math.round(deg * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}°`;
}

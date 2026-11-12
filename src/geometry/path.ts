/**
 * Closed outlines made of straight walls and circular arcs: area, perimeter,
 * closure, self-intersection and bounds. Coordinates are feet, y up.
 */

export interface Point {
  x: number;
  y: number;
}

export interface LineSegment {
  kind: "line";
  from: Point;
  to: Point;
}

export interface ArcSegment {
  kind: "arc";
  from: Point;
  to: Point;
  /** Depth of the arc from its chord, feet. Positive bulges outward from the shape. */
  sagitta: number;
}

export type Segment = LineSegment | ArcSegment;

export interface Path {
  start: Point;
  segments: Segment[];
}

/** Closure tolerance: 1/8 inch. */
export const CLOSE_TOLERANCE_FT = 1 / 96;

export interface Closure {
  closed: boolean;
  dx: number;
  dy: number;
  distance: number;
}

export function endPoint(path: Path): Point {
  const last = path.segments[path.segments.length - 1];
  return last ? last.to : path.start;
}

/** How far the outline misses its start point. Open outlines are measured as if closed by a straight wall. */
export function closure(path: Path): Closure {
  const end = endPoint(path);
  const dx = path.start.x - end.x;
  const dy = path.start.y - end.y;
  const distance = Math.hypot(dx, dy);
  return { closed: distance <= CLOSE_TOLERANCE_FT, dx, dy, distance };
}

/** Vertices of the wall chords (arcs replaced by their chords), without the repeated start point. */
export function chordVertices(path: Path): Point[] {
  const pts = [path.start];
  for (const s of path.segments) pts.push(s.to);
  if (pts.length > 1 && closure(path).closed) pts.pop();
  return pts;
}

/** Signed shoelace area of a polygon. Positive = counter-clockwise (y up). */
export function signedPolygonArea(pts: Point[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** +1 if the outline runs counter-clockwise, -1 if clockwise. Degenerate outlines count as counter-clockwise. */
export function orientation(path: Path): 1 | -1 {
  return signedPolygonArea(chordVertices(path)) < 0 ? -1 : 1;
}

export interface ArcMetrics {
  chord: number;
  radius: number;
  /** Central angle, radians, in (0, 2π). */
  angle: number;
  length: number;
  /** Area between the arc and its chord. */
  segmentArea: number;
}

/** Circular-segment measurements from chord length and (unsigned) sagitta. */
export function arcMetrics(chord: number, sagitta: number): ArcMetrics {
  const s = Math.abs(sagitta);
  if (chord <= 0 || s === 0) {
    return { chord, radius: Infinity, angle: 0, length: chord, segmentArea: 0 };
  }
  const radius = (chord * chord) / 4 / (2 * s) + s / 2;
  const angle = 4 * Math.atan((2 * s) / chord);
  return {
    chord,
    radius,
    angle,
    length: radius * angle,
    segmentArea: ((radius * radius) / 2) * (angle - Math.sin(angle)),
  };
}

function segLength(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Enclosed area in square feet (always ≥ 0 for a simple outline). */
export function area(path: Path): number {
  const base = Math.abs(signedPolygonArea(chordVertices(path)));
  let arcs = 0;
  for (const s of path.segments) {
    if (s.kind !== "arc") continue;
    const m = arcMetrics(segLength(s.from, s.to), s.sagitta);
    arcs += Math.sign(s.sagitta) * m.segmentArea;
  }
  return base + arcs;
}

/** Total wall length including arcs and, for an open outline, the implied closing wall. */
export function perimeter(path: Path): number {
  let total = 0;
  for (const s of path.segments) {
    const c = segLength(s.from, s.to);
    total += s.kind === "arc" ? arcMetrics(c, s.sagitta).length : c;
  }
  const cl = closure(path);
  if (!cl.closed) total += cl.distance;
  return total;
}

export interface ArcGeometry {
  center: Point;
  radius: number;
  /** Angle from center to the start point, radians. */
  startAngle: number;
  /** Signed sweep, radians: positive = counter-clockwise. */
  sweep: number;
}

/** Center/angles of an arc segment, for drawing. `orient` is the outline's orientation. */
export function arcGeometry(seg: ArcSegment, orient: 1 | -1): ArcGeometry {
  const dx = seg.to.x - seg.from.x;
  const dy = seg.to.y - seg.from.y;
  const chord = Math.hypot(dx, dy);
  const m = arcMetrics(chord, seg.sagitta);
  // Outward for a CCW outline is the right-hand normal of travel; for CW, the left.
  const right = { x: dy / chord, y: -dx / chord };
  const outwardSign = orient === 1 ? 1 : -1;
  const side = outwardSign * Math.sign(seg.sagitta); // +1: apex on right of travel, -1: left
  const n = { x: right.x * side, y: right.y * side };
  const mid = { x: (seg.from.x + seg.to.x) / 2, y: (seg.from.y + seg.to.y) / 2 };
  const s = Math.abs(seg.sagitta);
  const center = { x: mid.x + n.x * (s - m.radius), y: mid.y + n.y * (s - m.radius) };
  const startAngle = Math.atan2(seg.from.y - center.y, seg.from.x - center.x);
  // Apex on the right of travel means the arc turns counter-clockwise around the center.
  const sweep = side * m.angle;
  return { center, radius: m.radius, startAngle, sweep };
}

/** Outline as a polyline, arcs split into pieces of at most `maxStepRad` radians. Ends at the last point (not repeated start). */
export function flatten(path: Path, maxStepRad = Math.PI / 32): Point[] {
  const orient = orientation(path);
  const pts: Point[] = [path.start];
  for (const s of path.segments) {
    if (s.kind === "arc" && s.sagitta !== 0) {
      const g = arcGeometry(s, orient);
      const n = Math.max(2, Math.ceil(Math.abs(g.sweep) / maxStepRad));
      for (let i = 1; i < n; i++) {
        const a = g.startAngle + (g.sweep * i) / n;
        pts.push({ x: g.center.x + g.radius * Math.cos(a), y: g.center.y + g.radius * Math.sin(a) });
      }
    }
    pts.push(s.to);
  }
  if (pts.length > 1 && closure(path).closed) pts.pop();
  return pts;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bounds(path: Path): Bounds {
  const pts = flatten(path);
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Proper crossing or touching of segments p1p2 and p3p4 (with a small tolerance). */
function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const eps = 1e-9;
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) {
    return true;
  }
  const onSeg = (p: Point, q: Point, r: Point) =>
    Math.min(p.x, q.x) - eps <= r.x && r.x <= Math.max(p.x, q.x) + eps &&
    Math.min(p.y, q.y) - eps <= r.y && r.y <= Math.max(p.y, q.y) + eps;
  if (Math.abs(d1) <= eps && onSeg(p3, p4, p1)) return true;
  if (Math.abs(d2) <= eps && onSeg(p3, p4, p2)) return true;
  if (Math.abs(d3) <= eps && onSeg(p1, p2, p3)) return true;
  if (Math.abs(d4) <= eps && onSeg(p1, p2, p4)) return true;
  return false;
}

/** True if any two non-adjacent walls cross or touch (arcs checked as polylines). */
export function selfIntersects(path: Path): boolean {
  const pts = flatten(path);
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i]!;
    const a2 = pts[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // first and last edges share the start point
      const b1 = pts[j]!;
      const b2 = pts[(j + 1) % n]!;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

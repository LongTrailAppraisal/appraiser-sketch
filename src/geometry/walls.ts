/**
 * Interior walls: open runs of walls inside an area, typed like an outline
 * ("U12 R8") from a start point. They are drawn on the floor plan only and
 * never change any area (ANSI Z765 measures to the exterior).
 *
 * This module holds the pure geometry for drawing them with the mouse:
 * where a click lands once it is snapped to corners, walls and the grid.
 */

import type { Point } from "./path.js";

/** What a wall point can snap to. */
export interface SnapTargets {
  /** Corners: outline corners and interior wall ends and bends. */
  points: Point[];
  /** Wall lines: outline walls (arcs as short chords) and interior walls. */
  lines: [Point, Point][];
}

export interface SnapOptions {
  /** How close (feet) the cursor must be to snap to a corner or a wall. */
  tol: number;
  /** Grid step (feet); 0 for no grid. */
  step: number;
  /** Alt held: no snapping and no angle lock. */
  free: boolean;
  /**
   * With no previous point (a free move): points to line up with. On the grid,
   * an x or y within reach of one of these is taken from it, so a dragged
   * corner stays square with its neighbours.
   */
  align?: Point[];
}

export interface SnapResult {
  at: Point;
  /** What it snapped to, for the on-screen marker and status line. */
  kind: "corner" | "wall" | "grid" | "free";
}

const EPS = 1e-9;

function roundStep(v: number, step: number): number {
  return step > 0 ? Math.round(Math.round(v / step) * step * 1e6) / 1e6 : v;
}

/** Nearest point on segment a–b to p. */
function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return { ...a };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Distance t along the ray from `o` in unit direction `u` to segment a–b, or null if it misses. */
function rayHit(o: Point, u: Point, a: Point, b: Point): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = u.x * ey - u.y * ex;
  if (Math.abs(den) < EPS) return null; // parallel
  const wx = a.x - o.x;
  const wy = a.y - o.y;
  const t = (wx * ey - wy * ex) / den;
  const s = (wx * u.y - wy * u.x) / den;
  if (t <= 1e-6 || s < -1e-6 || s > 1 + 1e-6) return null;
  return t;
}

/** The nearest of the eight directions (every 45°) from `from` towards `to`, as a unit vector. */
export function lockedDirection(from: Point, to: Point): Point {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const k = Math.round(ang / (Math.PI / 4));
  const a = (k * Math.PI) / 4;
  const snapZero = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  return { x: snapZero(Math.cos(a)), y: snapZero(Math.sin(a)) };
}

/**
 * Where a click for an interior wall lands.
 *
 * The first point snaps to a corner, then onto a wall (sliding along it), then
 * to the grid. Later points keep the new wall square or at 45° to the last
 * point, and stop exactly where that line meets a corner or a wall near the
 * cursor; otherwise the length snaps to the grid. A corner near the cursor but
 * off the locked line is taken last, so a wall can still be run to any corner.
 */
export function snapWallPoint(cursor: Point, prev: Point | null, t: SnapTargets, o: SnapOptions): SnapResult {
  if (o.free) return { at: { ...cursor }, kind: "free" };
  const near = (p: Point) => Math.hypot(p.x - cursor.x, p.y - cursor.y);

  let corner: Point | null = null;
  for (const p of t.points) if (near(p) < o.tol && (!corner || near(p) < near(corner))) corner = p;

  if (!prev) {
    if (corner) return { at: { ...corner }, kind: "corner" };
    let best: Point | null = null;
    let line: [Point, Point] | null = null;
    for (const l of t.lines) {
      const q = nearestOnSegment(cursor, l[0], l[1]);
      if (near(q) < o.tol && (!best || near(q) < near(best))) {
        best = q;
        line = l;
      }
    }
    if (best && line) {
      // Slide along the wall to the grid where it runs square, so starts land on whole inches.
      if (o.step > 0) {
        const [a, b] = line;
        if (Math.abs(a.y - b.y) < EPS) {
          const x = roundStep(best.x, o.step);
          if (x >= Math.min(a.x, b.x) - EPS && x <= Math.max(a.x, b.x) + EPS) best = { x, y: a.y };
        } else if (Math.abs(a.x - b.x) < EPS) {
          const y = roundStep(best.y, o.step);
          if (y >= Math.min(a.y, b.y) - EPS && y <= Math.max(a.y, b.y) + EPS) best = { x: a.x, y };
        }
      }
      return { at: best, kind: "wall" };
    }
    const at = { x: roundStep(cursor.x, o.step), y: roundStep(cursor.y, o.step) };
    for (const q of o.align ?? []) {
      if (Math.abs(q.x - cursor.x) < o.tol) at.x = q.x;
      if (Math.abs(q.y - cursor.y) < o.tol) at.y = q.y;
    }
    return { at, kind: o.step > 0 ? "grid" : "free" };
  }

  const u = lockedDirection(prev, cursor);
  const dist = (cursor.x - prev.x) * u.x + (cursor.y - prev.y) * u.y;
  if (dist > 0) {
    const onRay = (len: number): Point => ({ x: prev.x + u.x * len, y: prev.y + u.y * len });
    let hit: { len: number; kind: "corner" | "wall" } | null = null;
    const consider = (len: number, kind: "corner" | "wall") => {
      if (Math.abs(len - dist) >= o.tol) return;
      // Prefer a corner over a wall at the same spot, then whatever is nearest the cursor.
      if (!hit || Math.abs(len - dist) < Math.abs(hit.len - dist) - 1e-6 || (kind === "corner" && Math.abs(len - hit.len) < 1e-6)) hit = { len, kind };
    };
    for (const p of t.points) {
      const along = (p.x - prev.x) * u.x + (p.y - prev.y) * u.y;
      const off = Math.abs((p.x - prev.x) * u.y - (p.y - prev.y) * u.x);
      if (along > 1e-6 && off < 1e-6) consider(along, "corner");
    }
    for (const [a, b] of t.lines) {
      const len = rayHit(prev, u, a, b);
      if (len !== null) consider(len, "wall");
    }
    if (hit) {
      const h = hit as { len: number; kind: "corner" | "wall" };
      return { at: onRay(h.len), kind: h.kind };
    }
  }
  if (corner) return { at: { ...corner }, kind: "corner" };
  if (dist <= 0) return { at: { ...prev }, kind: "grid" };
  // Snap the run (and rise, on a 45° wall) to the grid, so ends stay on whole inches.
  const diag = u.x !== 0 && u.y !== 0;
  const comp = roundStep(diag ? dist / Math.SQRT2 : dist, o.step);
  const len = diag ? comp * Math.SQRT2 : comp;
  return { at: { x: prev.x + u.x * len, y: prev.y + u.y * len }, kind: o.step > 0 ? "grid" : "free" };
}

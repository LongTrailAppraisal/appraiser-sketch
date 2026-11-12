/**
 * Editing helpers that rewrite an area's vector text: opening an outline at
 * a corner, closing it, and turning "length + arrow key" into a wall.
 */

import { closure, type Point } from "./path.js";
import { formatFeetInches } from "./units.js";
import { parseVectors } from "./vectors.js";

/** A move token for a wall of (dx, dy) feet, e.g. "R24'", "U30'6\"" or "R10'U5'". */
export function moveToken(dx: number, dy: number): string {
  const tol = 1 / 96;
  const h = Math.abs(dx) > tol ? `${dx > 0 ? "R" : "L"}${formatFeetInches(Math.abs(dx))}` : "";
  const v = Math.abs(dy) > tol ? `${dy > 0 ? "U" : "D"}${formatFeetInches(Math.abs(dy))}` : "";
  return h + v;
}

export interface Rewritten {
  vectors: string;
  origin: Point;
}

/** Corners of an outline in drawing order (start first). */
export function corners(vectors: string, origin: Point): Point[] {
  const { path } = parseVectors(vectors, origin);
  const pts = [path.start, ...path.segments.map((s) => s.to)];
  if (pts.length > 1 && closure(path).closed) pts.pop();
  return pts;
}

/**
 * Open a closed outline at corner `i`: the wall leaving that corner is
 * removed and the walls are reordered so the outline now ends at that corner
 * (where you carry on drawing) and starts at the far end of the removed wall.
 * Typing walls back to the start closes it again. Returns null if the outline
 * isn't closed or the corner doesn't exist.
 *
 * Bad tokens and comments are dropped; a wall made by CL becomes an explicit move.
 */
export function openAtCorner(vectors: string, origin: Point, i: number): Rewritten | null {
  const { path, sources } = parseVectors(vectors, origin);
  const n = path.segments.length;
  if (n < 3 || !closure(path).closed || i < 0 || i >= n) return null;
  const tokens = path.segments.map((s, k) => sources[k] ?? moveToken(s.to.x - s.from.x, s.to.y - s.from.y));
  const order = [...tokens.slice(i + 1), ...tokens.slice(0, i)];
  return { vectors: order.join(" "), origin: { ...path.segments[i]!.to } };
}

/**
 * Delete a wall, stepping the pen back. On an open outline the last wall goes
 * and the pen moves back to the corner before it (press again to keep going
 * back). On a closed outline, `corner` picks where to open it: the wall
 * leaving that corner goes and the pen sits on the corner. A closing CL/A is
 * removed first, leaving the outline open where it ended.
 */
export function deleteWall(vectors: string, origin: Point, corner: number | null): Rewritten | null {
  const { path, sources } = parseVectors(vectors, origin);
  const n = path.segments.length;
  if (n === 0) return null;
  if (closure(path).closed && n >= 3) {
    if (corner !== null) return openAtCorner(vectors, origin, corner);
    // No corner picked: open at the end (remove the closing wall).
    return openAtCorner(vectors, origin, n - 1);
  }
  const tokens = path.segments.map((s, k) => sources[k] ?? moveToken(s.to.x - s.from.x, s.to.y - s.from.y));
  tokens.pop();
  return { vectors: tokens.join(" "), origin: { ...path.start } };
}

/** Close an open outline with a straight wall back to the start. */
export function closeOutline(vectors: string): string {
  const t = vectors.replace(/\s+$/, "");
  return t === "" ? t : `${t} CL`;
}

/**
 * If the text before the caret ends with a bare length ("30", "24'6\""),
 * replace it with a move in the arrow's direction and a trailing space.
 * Returns the new text and caret position, or null to let the arrow key do
 * its normal job.
 */
export function applyArrow(text: string, caret: number, dir: "up" | "down" | "left" | "right"): { text: string; caret: number } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s,])([0-9][0-9.'"\-/]*)$/.exec(before);
  if (!m) return null;
  const len = m[2]!;
  const letter = { up: "U", down: "D", left: "L", right: "R" }[dir];
  const start = before.length - len.length;
  const insert = `${letter}${len} `;
  const after = text.slice(caret).replace(/^ /, "");
  return { text: text.slice(0, start) + insert + after, caret: start + insert.length };
}

/**
 * Move corners of an outline by (dx, dy) and rewrite the walls to match: the
 * wall arriving at a moved corner and the wall leaving it change; everything
 * else keeps its typed text. Moving both ends of one wall slides that wall.
 * Corner k is the start of wall k (corner 0 is the start point; on an open
 * outline the last corner is the pen). Arcs keep their depth. A wall that
 * shrinks to nothing is dropped. Comments are dropped.
 */
export function moveCorners(vectors: string, origin: Point, cornerIdx: number[], d: Point): Rewritten | null {
  const { path, sources } = parseVectors(vectors, origin);
  const segs = path.segments;
  const n = segs.length;
  if (n === 0) return null;
  const closed = closure(path).closed;
  const count = closed ? n : n + 1;
  const moved = new Set(cornerIdx.filter((c) => c >= 0 && c < count));
  if (moved.size === 0) return null;

  const delta = segs.map((s) => ({ x: s.to.x - s.from.x, y: s.to.y - s.from.y }));
  const changed = new Set<number>();
  const bump = (k: number, sign: 1 | -1) => {
    delta[k]!.x += sign * d.x;
    delta[k]!.y += sign * d.y;
    changed.add(k);
  };
  for (const c of moved) {
    const arriving = c > 0 ? c - 1 : closed ? n - 1 : -1;
    if (arriving >= 0) bump(arriving, 1);
    if (c < n) bump(c, -1);
  }
  // Moving the start point moves the whole outline's anchor.
  const newOrigin = moved.has(0) ? { x: origin.x + d.x, y: origin.y + d.y } : { ...origin };

  const tokens: string[] = [];
  segs.forEach((s, k) => {
    const src = sources[k] ?? null;
    if (src === null) {
      // A wall made by CL/A: keep closing (it follows the corners by itself).
      tokens.push(k === n - 1 ? "CL" : moveToken(delta[k]!.x, delta[k]!.y));
      return;
    }
    const same = Math.abs(delta[k]!.x - (s.to.x - s.from.x)) < 1e-9 && Math.abs(delta[k]!.y - (s.to.y - s.from.y)) < 1e-9;
    if (!changed.has(k) || same) {
      tokens.push(src);
      return;
    }
    const t = moveToken(delta[k]!.x, delta[k]!.y);
    if (t === "") return; // wall shrank to nothing
    const arc = s.kind === "arc" ? /\^.*$/.exec(src)?.[0] ?? "" : "";
    tokens.push(t + arc);
  });
  return { vectors: tokens.join(" "), origin: newOrigin };
}

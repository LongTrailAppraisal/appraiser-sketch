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

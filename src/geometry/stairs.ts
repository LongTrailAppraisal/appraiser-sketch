/**
 * Stair symbols. Stairs never change an area figure: under ANSI Z765 they
 * count on the floor above (the level they descend from), and they sit
 * inside that floor's outline. This module only builds the drawing.
 *
 * Local frame: the first flight starts at the origin and runs along +y,
 * covering x 0..width. `rotation` turns the whole stair counter-clockwise
 * about the origin (0 = first flight runs up the screen / north).
 */

import type { Point } from "./path.js";

export type StairType = "straight" | "landing" | "l" | "u" | "winder";

export const STAIR_TYPES: { value: StairType; label: string }[] = [
  { value: "straight", label: "Straight" },
  { value: "landing", label: "Straight, middle landing" },
  { value: "l", label: "L (right angle) with landing" },
  { value: "winder", label: "L with winders" },
  { value: "u", label: "U with landing" },
];

export interface Stair {
  id: string;
  type: StairType;
  /** World position of the first flight's starting corner. */
  origin: Point;
  /** Degrees counter-clockwise; 0 = first flight runs north. */
  rotation: number;
  width: number;
  /** Length of the first flight. */
  run1: number;
  /** Length of the second flight (landing, L, U, winder). */
  run2: number;
  turn: "left" | "right";
  /** Arrow label as seen from this floor. */
  direction: "up" | "down";
}

export const TREAD_DEPTH = 10 / 12; // 10" treads for the symbol

export function defaultStair(over: Partial<Stair> = {}): Stair {
  return {
    id: "",
    type: "straight",
    origin: { x: 0, y: 0 },
    rotation: 0,
    width: 3,
    run1: 12,
    run2: 4,
    turn: "right",
    direction: "up",
    ...over,
  };
}

export interface StairDrawing {
  /** Flights and landings, each a closed polygon. */
  parts: Point[][];
  /** Tread and winder lines. */
  lines: [Point, Point][];
  /** Travel arrow along the walking line, ending at the head. */
  arrow: Point[];
  /** Total plan footprint, sq ft (for information; never added to an area). */
  footprint: number;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Tread lines across a flight from (x0,y0)-(x1,y1), travelling along the given axis. */
function treads(x0: number, y0: number, x1: number, y1: number, axis: "x" | "y"): [Point, Point][] {
  const out: [Point, Point][] = [];
  const len = axis === "y" ? Math.abs(y1 - y0) : Math.abs(x1 - x0);
  const n = Math.max(1, Math.round(len / TREAD_DEPTH));
  const step = len / n;
  for (let i = 1; i < n; i++) {
    if (axis === "y") {
      const y = Math.min(y0, y1) + i * step;
      out.push([{ x: x0, y }, { x: x1, y }]);
    } else {
      const x = Math.min(x0, x1) + i * step;
      out.push([{ x, y: y0 }, { x, y: y1 }]);
    }
  }
  return out;
}

/** Drawing in the local frame, for a right turn. */
function localDrawing(s: Stair): StairDrawing {
  const w = Math.max(0.5, s.width);
  const r1 = Math.max(0.5, s.run1);
  const r2 = Math.max(0.5, s.run2);
  const parts: Point[][] = [rect(0, 0, w, r1)];
  const lines = treads(0, 0, w, r1, "y");
  const inset = Math.min(0.5, r1 / 4);
  let arrow: Point[];

  switch (s.type) {
    case "straight":
      arrow = [{ x: w / 2, y: inset }, { x: w / 2, y: r1 - inset }];
      break;
    case "landing":
      parts.push(rect(0, r1, w, r1 + w), rect(0, r1 + w, w, r1 + w + r2));
      lines.push(...treads(0, r1 + w, w, r1 + w + r2, "y"));
      arrow = [{ x: w / 2, y: inset }, { x: w / 2, y: r1 + w + r2 - inset }];
      break;
    case "l":
    case "winder": {
      parts.push(rect(0, r1, w, r1 + w), rect(w, r1, w + r2, r1 + w));
      lines.push(...treads(w, r1, w + r2, r1 + w, "x"));
      if (s.type === "winder") {
        const c = { x: w, y: r1 }; // inner corner
        lines.push([c, { x: 0, y: r1 + w * 0.45 }], [c, { x: 0, y: r1 + w }], [c, { x: w * 0.55, y: r1 + w }]);
      }
      arrow = [{ x: w / 2, y: inset }, { x: w / 2, y: r1 + w / 2 }, { x: w + r2 - inset, y: r1 + w / 2 }];
      break;
    }
    case "u":
      parts.push(rect(0, r1, 2 * w, r1 + w), rect(w, r1 - r2, 2 * w, r1));
      lines.push(...treads(w, r1 - r2, 2 * w, r1, "y"));
      arrow = [
        { x: w / 2, y: inset },
        { x: w / 2, y: r1 + w / 2 },
        { x: 1.5 * w, y: r1 + w / 2 },
        { x: 1.5 * w, y: r1 - r2 + inset },
      ];
      break;
  }

  const footprint = parts.reduce((sum, p) => sum + Math.abs((p[2]!.x - p[0]!.x) * (p[2]!.y - p[0]!.y)), 0);
  return { parts, lines, arrow, footprint };
}

/** The stair drawing in world coordinates. */
export function stairDrawing(s: Stair): StairDrawing {
  const local = localDrawing(s);
  const w = Math.max(0.5, s.width);
  const rad = (s.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // A left turn mirrors the drawing about the first flight's centre line.
  const mirror = s.turn === "left" && s.type !== "straight" && s.type !== "landing";
  const tf = (p: Point): Point => {
    const x = mirror ? w - p.x : p.x;
    return { x: s.origin.x + x * cos - p.y * sin, y: s.origin.y + x * sin + p.y * cos };
  };
  return {
    parts: local.parts.map((poly) => poly.map(tf)),
    lines: local.lines.map(([a, b]) => [tf(a), tf(b)]),
    arrow: local.arrow.map(tf),
    footprint: local.footprint,
  };
}

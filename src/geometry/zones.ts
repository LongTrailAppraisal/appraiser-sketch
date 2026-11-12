/**
 * Helpers for ceiling-height zones and openings inside an area. A zone is an
 * ordinary outline (origin + vectors) tagged with a ceiling band or "opening";
 * see ansi.ts for how the bands are counted.
 */

import type { CeilingBand } from "./ansi.js";
import type { Bounds, Point } from "./path.js";
import { formatFeetInches } from "./units.js";

export type ZoneBand = CeilingBand | "opening";

export const ZONE_BANDS: { value: ZoneBand; label: string; short: string }[] = [
  { value: "low", label: "Ceiling under 5' (not counted)", short: "under 5'" },
  { value: "reduced", label: "Ceiling 5' to 7'", short: "5'–7'" },
  { value: "full", label: "Ceiling 7' or more", short: "7'+" },
  { value: "opening", label: "Open to below (not counted)", short: "open" },
];

export type Side = "north" | "south" | "east" | "west";

/**
 * A strip of the given depth along one side of a bounding box, e.g. the
 * under-5' space behind a Cape's knee wall. Returns an outline for a zone.
 * `inset` starts the strip that far in from the side (for a 5'–7' band
 * next to an under-5' strip).
 */
export function stripZone(b: Bounds, side: Side, depth: number, inset = 0): { origin: Point; vectors: string } {
  const f = formatFeetInches;
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

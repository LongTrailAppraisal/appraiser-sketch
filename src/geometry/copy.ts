/** Copying areas and stairs between floors. */

import type { Area } from "./model.js";
import type { Point } from "./path.js";
import type { Stair } from "./stairs.js";

/** Order of levels from the bottom: basement, 1, 2, … then attic. */
export function levelRank(level: string): number {
  const l = level.trim().toLowerCase();
  if (l.startsWith("base") || l === "b" || l === "lower") return -1;
  if (l.startsWith("attic")) return 99;
  const n = Number.parseFloat(l);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A copy of an area placed with its start point at `origin`. Its stairs and
 * ceiling zones come along (new ids, same place relative to the outline);
 * `over` then sets the new area's name, type, level and so on.
 */
export function copyArea(src: Area, origin: Point, newId: (prefix: string) => string, over: Partial<Area> = {}): Area {
  const dx = origin.x - src.origin.x;
  const dy = origin.y - src.origin.y;
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const copy: Area = structuredClone(src);
  copy.id = newId("a");
  copy.name = `${src.name} (copy)`;
  copy.origin = { ...origin };
  copy.zones = copy.zones.map((z) => ({ ...z, id: newId("z"), origin: shift(z.origin) }));
  copy.stairs = (copy.stairs ?? []).map((s) => ({ ...s, id: newId("st"), origin: shift(s.origin) }));
  return { ...copy, ...over, id: copy.id };
}

/**
 * A copy of a stair for another area: same place relative to that area's start
 * point (so floors drawn from the same corner line up), and the arrow pointing
 * the way you'd go from that floor (down from a floor above, up from below).
 */
export function copyStairTo(st: Stair, from: Area, to: Area, id: string): Stair {
  const rel = { x: st.origin.x - from.origin.x, y: st.origin.y - from.origin.y };
  const a = levelRank(from.level);
  const b = levelRank(to.level);
  const direction = to.id === from.id || a === b ? st.direction : b > a ? "down" : "up";
  return { ...structuredClone(st), id, origin: { x: to.origin.x + rel.x, y: to.origin.y + rel.y }, direction };
}

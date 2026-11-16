/**
 * Paste-ready area totals: plain text, no markdown, so it pastes cleanly
 * into report form fields and comment boxes.
 */

import { BUCKET_LABELS, isBelowGrade, levelRank, type Bucket, type Grade, type SketchResult, type StructureResult } from "../geometry/index.js";

const sf = (v: number) => `${Math.round(v).toLocaleString("en-US")} sf`;

const LEVEL_NAMES: Record<string, string> = {
  "1": "Level 1",
  "2": "Level 2",
  "3": "Level 3",
  attic: "Attic",
  basement: "Basement",
  lower: "Lower level",
  main: "Main level",
  upper: "Upper level",
};

export function levelName(level: string): string {
  return LEVEL_NAMES[level] ?? (level.trim() === "" ? "Unassigned level" : level);
}

/** Area groups, in report order: finished above grade first (first floor up), then unfinished above, below grade, garages, amenities. */
export const PRINT_GROUPS: { name: string; buckets: Bucket[]; levels?: { grade: "above" | "below"; finished: boolean } }[] = [
  { name: "Finished above grade", buckets: ["gla", "nonStandardAbove", "finishedNotConnected"], levels: { grade: "above", finished: true } },
  { name: "Unfinished above grade", buckets: ["unfinishedAbove"], levels: { grade: "above", finished: false } },
  { name: "Finished below grade", buckets: ["finishedBelow", "nonStandardBelow"], levels: { grade: "below", finished: true } },
  { name: "Unfinished below grade", buckets: ["unfinishedBelow"], levels: { grade: "below", finished: false } },
  { name: "Garages & carports", buckets: ["garage", "carport"] },
  { name: "Amenities", buckets: ["porch", "deck", "patio", "breezeway", "other"] },
  { name: "Not counted", buckets: ["excluded"] },
];

export interface TotalGroup {
  name: string;
  /** Reported (rounded) totals in this group, non-zero only. */
  rows: { bucket: Bucket; label: string; sf: number }[];
  /** The group's square feet by level, lowest floor first. */
  levels: { level: string; grade: Grade; sf: number }[];
}

/** A structure's reported totals grouped the same way as the printed area list. Empty groups are left out. */
export function totalGroups(s: StructureResult): TotalGroup[] {
  return PRINT_GROUPS.filter((g) => !g.buckets.includes("excluded"))
    .map((g) => ({
      name: g.name,
      rows: g.buckets.filter((b) => s.reported[b] > 0).map((b) => ({ bucket: b, label: BUCKET_LABELS[b], sf: s.reported[b] })),
      levels: g.levels
        ? s.levels
            .filter((l) => (isBelowGrade(l.grade) ? "below" : "above") === g.levels!.grade)
            .map((l) => ({ level: l.level, grade: l.grade, sf: Math.round(g.levels!.finished ? l.finished : l.unfinished) }))
            .filter((l) => l.sf > 0)
            .sort((a, b) => levelRank(a.level) - levelRank(b.level))
        : [],
    }))
    .filter((g) => g.rows.length > 0);
}

export function structureLines(s: StructureResult): string[] {
  const lines = [s.structure.name];
  for (const g of totalGroups(s)) {
    // A group holding one total with the group's own name needs no heading.
    const single = g.rows.length === 1 && g.rows[0]!.label === g.name;
    if (single) lines.push(`  ${g.name}: ${sf(g.rows[0]!.sf)}`);
    else {
      lines.push(`  ${g.name}`);
      for (const r of g.rows) lines.push(`    ${r.label}: ${sf(r.sf)}`);
    }
    const pad = single ? "    " : "      ";
    for (const l of g.levels) lines.push(`${pad}${levelName(l.level)}: ${sf(l.sf)}`);
  }
  return lines;
}

export function totalsText(result: SketchResult): string {
  const lines: string[] = [];
  for (const s of result.structures) {
    if (s.areas.length === 0) continue;
    lines.push(...structureLines(s), "");
  }
  lines.push(`Measurement standard: ${result.sketch.meta.ansi ? "ANSI Z765-2021" : "Not ANSI Z765"}`);
  const overrides = result.structures.flatMap((s) => s.overrides.map((o) => `${s.structure.name}, ${o.area}: ${o.note}`));
  if (overrides.length) {
    lines.push("Areas not measured to ANSI Z765:");
    for (const o of overrides) lines.push(`  ${o}`);
  }
  return lines.join("\n") + "\n";
}

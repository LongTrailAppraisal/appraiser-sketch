/**
 * Paste-ready area totals: plain text, no markdown, so it pastes cleanly
 * into report form fields and comment boxes.
 */

import { BUCKETS, BUCKET_LABELS, type SketchResult, type StructureResult } from "../geometry/index.js";

const sf = (v: number) => `${Math.round(v).toLocaleString("en-US")} sf`;

const LEVEL_NAMES: Record<string, string> = {
  "1": "Level 1",
  "2": "Level 2",
  "3": "Level 3",
  attic: "Attic",
  basement: "Basement",
};

export function levelName(level: string): string {
  return LEVEL_NAMES[level] ?? (level.trim() === "" ? "Unassigned level" : level);
}

export function structureLines(s: StructureResult): string[] {
  const lines = [s.structure.name];
  for (const b of BUCKETS) {
    if (b === "excluded" || s.reported[b] === 0) continue;
    lines.push(`  ${BUCKET_LABELS[b]}: ${sf(s.reported[b])}`);
  }
  if (s.levels.length > 0) {
    lines.push("  By level:");
    for (const l of s.levels) {
      const parts = [];
      if (Math.round(l.finished) > 0) parts.push(`finished ${sf(l.finished)}`);
      if (Math.round(l.unfinished) > 0) parts.push(`unfinished ${sf(l.unfinished)}`);
      if (parts.length) lines.push(`    ${levelName(l.level)} (${l.grade} grade): ${parts.join(", ")}`);
    }
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

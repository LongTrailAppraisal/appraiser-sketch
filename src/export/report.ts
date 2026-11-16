/**
 * Report export: one JSON file a report program can read without redoing the
 * geometry. It holds the same totals as the area table and the paste-ready
 * block, plus the drawing as SVG. Format: docs/REPORT_EXPORT.md.
 */

import { STRUCTURE_KINDS, type Bucket, type Grade, type SketchResult } from "../geometry/index.js";
import { standaloneSvg } from "./svg.js";
import { levelName, totalGroups } from "./text.js";

export const REPORT_FORMAT_VERSION = 1;

export interface ReportRow {
  /** Display label: a bucket label ("Gross living area") or a level name under it ("Level 1"). */
  label: string;
  /** Whole square feet. */
  area: number;
  /** Group heading this row belongs to, e.g. "Finished above grade". */
  group: string;
  /** Set on total rows. */
  bucket?: Bucket;
  /** Set on per-level rows, which break down the group above them. */
  level?: string;
  /** Per-level rows: above, partial (partly below grade) or below. */
  grade?: Grade;
}

export interface ReportStructure {
  name: string;
  kind: string;
  kindLabel: string;
  /** Non-zero reported totals by bucket. */
  buckets: Partial<Record<Bucket, number>>;
  totals: ReportRow[];
}

export interface ReportExport {
  formatVersion: number;
  generator: string;
  ansi: boolean;
  standard: string | null;
  meta: { subject?: string | undefined; fileNumber?: string | undefined; date?: string | undefined };
  /** Sum of GLA over dwelling structures. */
  gla: number;
  structures: ReportStructure[];
  overrides: { structure: string; area: string; note: string }[];
  svg: string;
}

export function reportExport(result: SketchResult, screenScale?: number): ReportExport {
  const m = result.sketch.meta;
  const structures: ReportStructure[] = result.structures
    .filter((s) => s.areas.length > 0)
    .map((s) => {
      const totals: ReportRow[] = [];
      for (const g of totalGroups(s)) {
        for (const r of g.rows) totals.push({ label: r.label, area: r.sf, group: g.name, bucket: r.bucket });
        for (const l of g.levels) totals.push({ label: levelName(l.level), area: l.sf, group: g.name, level: l.level, grade: l.grade });
      }
      const buckets: Partial<Record<Bucket, number>> = {};
      for (const [b, v] of Object.entries(s.reported) as [Bucket, number][]) if (v > 0 && b !== "excluded") buckets[b] = v;
      return {
        name: s.structure.name,
        kind: s.structure.kind,
        kindLabel: STRUCTURE_KINDS.find((k) => k.value === s.structure.kind)?.label ?? s.structure.kind,
        buckets,
        totals,
      };
    });
  return {
    formatVersion: REPORT_FORMAT_VERSION,
    generator: "Appraiser Sketch",
    ansi: m.ansi,
    standard: m.ansi ? "ANSI Z765-2021" : null,
    meta: { subject: m.subject, fileNumber: m.fileNumber, date: m.date },
    gla: structures.filter((s) => s.kind === "dwelling").reduce((t, s) => t + (s.buckets.gla ?? 0), 0),
    structures,
    overrides: result.structures.flatMap((s) => s.overrides.map((o) => ({ structure: s.structure.name, area: o.area, note: o.note }))),
    svg: standaloneSvg(result, 960, 720, screenScale),
  };
}

export function reportExportJson(result: SketchResult, screenScale?: number): string {
  return JSON.stringify(reportExport(result, screenScale), null, 2) + "\n";
}

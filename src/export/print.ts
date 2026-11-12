/**
 * The printed sketch page (browser print → paper or PDF): report header,
 * the sketch scaled to fit, and the area table with each area's figures and
 * the reported totals.
 */

import {
  BUCKETS,
  BUCKET_LABELS,
  formatLength,
  formatSqFt,
  levelRank,
  type AreaResult,
  type Bucket,
  type SketchResult,
} from "../geometry/index.js";
import { standaloneSvg } from "./svg.js";
import { levelName } from "./text.js";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** "24' × 30'" for a plain rectangle, otherwise "" (the area is still exact; it just has no one-line formula). */
export function areaFormula(r: AreaResult): string {
  const segs = r.shape.path.segments;
  if (segs.length !== 4 || !r.shape.closure.closed || segs.some((s) => s.kind !== "line")) return "";
  const d = segs.map((s) => ({ x: s.to.x - s.from.x, y: s.to.y - s.from.y }));
  const axis = d.every((v) => Math.abs(v.x) < 1e-9 || Math.abs(v.y) < 1e-9);
  if (!axis) return "";
  const w = Math.max(...d.map((v) => Math.abs(v.x)));
  const h = Math.max(...d.map((v) => Math.abs(v.y)));
  return `${formatLength(w)} × ${formatLength(h)}`;
}

const KIND_LABELS: Record<string, string> = {
  living: "Living",
  garage: "Garage",
  porch: "Porch",
  deck: "Deck",
  patio: "Patio",
  carport: "Carport",
  breezeway: "Breezeway",
  other: "Other",
};

function areaKindLabel(r: AreaResult): string {
  if (r.area.kind !== "living") return KIND_LABELS[r.area.kind] ?? r.area.kind;
  return BUCKET_LABELS[r.ansi.bucket];
}

/** The printed area list's groups, in order, by ANSI bucket. */
export const PRINT_GROUPS: { name: string; buckets: Bucket[] }[] = [
  { name: "Finished above grade", buckets: ["gla", "nonStandardAbove", "finishedNotConnected"] },
  { name: "Unfinished above grade", buckets: ["unfinishedAbove"] },
  { name: "Finished below grade", buckets: ["finishedBelow", "nonStandardBelow"] },
  { name: "Unfinished below grade", buckets: ["unfinishedBelow"] },
  { name: "Garages & carports", buckets: ["garage", "carport"] },
  { name: "Amenities", buckets: ["porch", "deck", "patio", "breezeway", "other"] },
  { name: "Not counted", buckets: ["excluded"] },
];

/**
 * A structure's drawn areas grouped for the print: finished above grade
 * (first floor first, then up), unfinished above, finished below, unfinished
 * below, garages, amenities. Empty groups are left out.
 */
export function groupAreasForPrint(areas: AreaResult[]): { name: string; areas: AreaResult[] }[] {
  const drawn = areas.filter((a) => a.shape.path.segments.length > 0);
  return PRINT_GROUPS.map((g) => ({
    name: g.name,
    areas: drawn
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => g.buckets.includes(a.ansi.bucket))
      .sort((x, y) => (x.a.area.kind === "living" && y.a.area.kind === "living" ? levelRank(x.a.area.level) - levelRank(y.a.area.level) : 0) || x.i - y.i)
      .map(({ a }) => a),
  })).filter((g) => g.areas.length > 0);
}

export function printPageHtml(result: SketchResult, screenScale?: number): string {
  const m = result.sketch.meta;
  const svg = standaloneSvg(result, 720, 560, screenScale);
  const img = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const header = [
    ["Property address", m.subject ?? ""],
    ["Borrower", m.borrower ?? ""],
    ["Lender/Client", m.client ?? ""],
    ["File number", m.fileNumber ?? ""],
    ["Appraiser", m.appraiser ?? ""],
    ["Date", m.date ?? ""],
  ]
    .filter(([k, v]) => k === "Property address" || v !== "")
    .map(([k, v]) => `<tr><th>${esc(k!)}</th><td>${esc(v!)}</td></tr>`)
    .join("");

  const structures = result.structures
    .filter((s) => s.areas.length > 0)
    .map((s) => {
      const rows = groupAreasForPrint(s.areas)
        .map(
          (g) =>
            `<tr class="group"><th colspan="4">${esc(g.name)}</th></tr>` +
            g.areas
              .map(
                (a) =>
                  `<tr><td>${esc(a.area.name)}</td><td>${esc(areaKindLabel(a))}${a.area.kind === "living" ? ` · ${esc(levelName(a.area.level))}` : ""}</td>` +
                  `<td>${esc(areaFormula(a))}</td><td class="num">${formatSqFt(a.ansi.counted)}</td></tr>`,
              )
              .join(""),
        )
        .join("");
      const totals = BUCKETS.filter((b) => b !== "excluded" && s.reported[b] > 0)
        .map((b) => `<tr class="${b === "gla" ? "gla" : ""}"><td colspan="3">${esc(BUCKET_LABELS[b])}</td><td class="num">${s.reported[b].toLocaleString("en-US")}</td></tr>`)
        .join("");
      const overrides = s.overrides.length
        ? `<p class="print-note">Not measured to ANSI Z765: ${s.overrides.map((o) => esc(`${o.area}: ${o.note}`)).join("; ")}</p>`
        : "";
      return (
        `<h2>${esc(s.structure.name)}</h2>` +
        `<table class="print-areas"><thead><tr><th>Area</th><th>Type</th><th>Dimensions</th><th class="num">Sq ft</th></tr></thead>` +
        `<tbody>${rows}</tbody><tbody class="sum">${totals}</tbody></table>${overrides}`
      );
    })
    .join("");

  const standard = m.ansi
    ? "Measured to ANSI Z765-2021. Totals are rounded to whole square feet after adding."
    : "Not measured to ANSI Z765. Totals are rounded to whole square feet after adding.";

  return (
    `<div class="print-page">` +
    `<h1>Building Sketch</h1>` +
    `<table class="print-header">${header}</table>` +
    `<img class="print-sketch" alt="Building sketch" src="${img}"/>` +
    `<div class="print-tables">${structures}</div>` +
    `<p class="print-note">${standard} Dimensions and symbols are for illustration; the sketch is not to scale.</p>` +
    `</div>`
  );
}

/** Render the standalone SVG to a PNG blob at the given pixel size (2× for sharp text). */
export async function sketchPng(result: SketchResult, width = 1600, height = 1200, screenScale?: number): Promise<Blob> {
  const svg = standaloneSvg(result, width / 2, height / 2, screenScale);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG failed"))), "image/png"));
}

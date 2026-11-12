/**
 * Sketch → SVG markup. Pure: takes computed results and a view transform,
 * returns a string. Styling is by CSS class (see style.css) so it follows the theme.
 */

import {
  arcGeometry,
  flatten,
  formatFeetInches,
  formatSqFt,
  orientation,
  signedPolygonArea,
  type AreaResult,
  type Point,
  type SketchResult,
} from "../geometry/index.js";
import type { Selection } from "./store.js";

/** Screen = (x·scale + ox, −y·scale + oy). Feet in, pixels out. */
export interface View {
  scale: number;
  ox: number;
  oy: number;
}

export const toScreen = (v: View, p: Point): Point => ({ x: p.x * v.scale + v.ox, y: -p.y * v.scale + v.oy });
export const toWorld = (v: View, p: Point): Point => ({ x: (p.x - v.ox) / v.scale, y: -(p.y - v.oy) / v.scale });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const n = (v: number) => v.toFixed(1);

/** Area-weighted centroid of a polygon; bounding-box center if degenerate. */
export function centroid(pts: Point[]): Point {
  const a = signedPolygonArea(pts);
  if (Math.abs(a) < 1e-9) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function gridMarkup(v: View, width: number, height: number): string {
  // Pick a step that keeps lines at least 10px apart: 1, 5, 10, 50 ft …
  const steps = [1, 5, 10, 50, 100];
  const minor = steps.find((s) => s * v.scale >= 18) ?? 100;
  const major = minor * (minor === 1 ? 5 : minor === 5 ? 2 : 5);
  const tl = toWorld(v, { x: 0, y: 0 });
  const br = toWorld(v, { x: width, y: height });
  const lines: string[] = [];
  for (let x = Math.floor(tl.x / minor) * minor; x <= br.x; x += minor) {
    const sx = x * v.scale + v.ox;
    lines.push(`<line class="${Math.round(x) % major === 0 ? "grid-major" : "grid"}" x1="${n(sx)}" y1="0" x2="${n(sx)}" y2="${height}"/>`);
  }
  for (let y = Math.floor(br.y / minor) * minor; y <= tl.y; y += minor) {
    const sy = -y * v.scale + v.oy;
    lines.push(`<line class="${Math.round(y) % major === 0 ? "grid-major" : "grid"}" x1="0" y1="${n(sy)}" x2="${width}" y2="${n(sy)}"/>`);
  }
  return `<g class="grid-layer">${lines.join("")}</g>`;
}

function dimensionLabels(r: AreaResult, v: View): string {
  const path = r.shape.path;
  if (path.segments.length === 0) return "";
  const orient = orientation(path);
  const out: string[] = [];
  const fontPx = 11;
  for (const seg of path.segments) {
    const a = toScreen(v, seg.from);
    const b = toScreen(v, seg.to);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 24) continue; // too short to label legibly
    const dx = seg.to.x - seg.from.x;
    const dy = seg.to.y - seg.from.y;
    const wl = Math.hypot(dx, dy);
    // Outward normal in world space: right-hand for a CCW outline.
    const nx = (orient * dy) / wl;
    const ny = (-orient * dx) / wl;
    let mid = { x: (seg.from.x + seg.to.x) / 2, y: (seg.from.y + seg.to.y) / 2 };
    if (seg.kind === "arc") {
      const g = arcGeometry(seg, orient);
      const ang = g.startAngle + g.sweep / 2;
      mid = { x: g.center.x + g.radius * Math.cos(ang), y: g.center.y + g.radius * Math.sin(ang) };
    }
    const off = 9 / v.scale;
    const p = toScreen(v, { x: mid.x + nx * off, y: mid.y + ny * off });
    let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    const text = formatFeetInches(wl) + (seg.kind === "arc" ? ` ⌒${formatFeetInches(Math.abs(seg.sagitta))}` : "");
    out.push(
      `<text class="dim" font-size="${fontPx}" x="${n(p.x)}" y="${n(p.y)}" transform="rotate(${deg.toFixed(1)} ${n(p.x)} ${n(p.y)})">${esc(text)}</text>`,
    );
  }
  return out.join("");
}

export interface RenderOptions {
  width: number;
  height: number;
  view: View;
  selection: Selection | null;
}

export function renderSketch(result: SketchResult, opts: RenderOptions): string {
  const { view: v, width, height, selection } = opts;
  const parts: string[] = [gridMarkup(v, width, height)];
  const labels: string[] = [];

  for (const s of result.structures) {
    for (const r of s.areas) {
      const pts = flatten(r.shape.path, Math.PI / 48);
      const selected = selection?.structure === s.structure.id && selection.area === r.area.id;
      const cls = ["area", `kind-${r.area.kind}`, `bucket-${r.ansi.bucket}`, selected ? "selected" : "", r.problems.length ? "has-problems" : ""]
        .filter(Boolean)
        .join(" ");
      const data = `data-structure="${esc(s.structure.id)}" data-area="${esc(r.area.id)}"`;
      const scr = pts.map((p) => toScreen(v, p));

      if (pts.length >= 3) {
        const d = `M${scr.map((p) => `${n(p.x)},${n(p.y)}`).join("L")}Z`;
        parts.push(`<path class="${cls}" ${data} d="${d}"/>`);
      } else if (pts.length === 2) {
        parts.push(`<path class="${cls}" ${data} d="M${n(scr[0]!.x)},${n(scr[0]!.y)}L${n(scr[1]!.x)},${n(scr[1]!.y)}"/>`);
      }

      // Zones (ceiling bands, openings) inside the area.
      for (const z of r.zones) {
        const zp = flatten(z.path).map((p) => toScreen(v, p));
        if (zp.length >= 3) {
          parts.push(
            `<path class="zone zone-${z.zone.band}" ${data} d="M${zp.map((p) => `${n(p.x)},${n(p.y)}`).join("L")}Z"/>`,
          );
        }
      }

      // Open outline: show the implied closing wall and the pen position.
      if (!r.shape.closure.closed && r.shape.path.segments.length > 0) {
        const end = toScreen(v, r.shape.path.segments[r.shape.path.segments.length - 1]!.to);
        const start = toScreen(v, r.shape.path.start);
        parts.push(`<line class="misclosure" x1="${n(end.x)}" y1="${n(end.y)}" x2="${n(start.x)}" y2="${n(start.y)}"/>`);
      }
      if (selected) {
        const pen = toScreen(v, r.shape.path.segments.at(-1)?.to ?? r.shape.path.start);
        const start = toScreen(v, r.shape.path.start);
        parts.push(`<circle class="start-mark" cx="${n(start.x)}" cy="${n(start.y)}" r="4"/>`);
        parts.push(`<circle class="pen-mark" cx="${n(pen.x)}" cy="${n(pen.y)}" r="5"/>`);
      }

      if (pts.length >= 3) {
        labels.push(dimensionLabels(r, v));
        const c = toScreen(v, centroid(pts));
        labels.push(
          `<text class="area-name" x="${n(c.x)}" y="${n(c.y - 2)}">${esc(r.area.name)}</text>` +
            `<text class="area-size" x="${n(c.x)}" y="${n(c.y + 12)}">${formatSqFt(r.shape.area)} sf</text>`,
        );
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}<g class="labels">${labels.join("")}</g></svg>`;
}

/// <reference types="vite/client" />
import {
  BUCKETS,
  BUCKET_LABELS,
  bounds,
  closingMove,
  computeSketch,
  flatten,
  formatFeetInches,
  formatSqFt,
  parseLength,
  type AreaKind,
  type Bucket,
  type CeilingBand,
  type Grade,
  type Point,
  type SketchResult,
  type StructureKind,
  STAIR_TYPES,
  defaultStair,
  stairDrawing,
  type Stair,
  type StairHandleKey,
  dragStairHandle,
  TEMPLATES,
  checkTemplate,
  ZONE_BANDS,
  LABEL_GROUPS,
  COMMON_LABELS,
  stripZone,
  applyArrow,
  closeOutline,
  deleteWall,
  type AreaResult,
  type Area,
  type Side,
  type ZoneBand,
} from "../geometry/index.js";
import { levelName, totalsText } from "../export/text.js";
import { printPageHtml, sketchPng } from "../export/print.js";
import { FileManager, SketchFileError, download, loadDraft, saveDraft } from "./files.js";
import { exportLabels, mergeLabels, parseLabelsFile } from "./labels.js";
import { centroid, renderSketch, toWorld, type View } from "./render.js";
import { Store, findArea, newArea, newId, newSketch, newStructure, type Selection } from "./store.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const store = new Store(loadDraft() ?? newSketch());
const files = new FileManager();
let result: SketchResult = computeSketch(store.state.sketch);
let view: View = { scale: 12, ox: 80, oy: 400 };
let savedRevision = store.revision;
/** True while applying undo/redo/open, so focused inputs are refreshed too. */
let external = true;

// ---------- canvas ----------

const canvas = $<HTMLDivElement>("canvas");

function size() {
  const r = canvas.getBoundingClientRect();
  return { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
}

/** Corner of the selected area picked for Open here (UI state, not saved). */
let activeCorner: { area: string; index: number } | null = null;

let showGrid = true;
try {
  showGrid = localStorage.getItem("sketch:grid") !== "off";
} catch {
  /* storage unavailable */
}

function drawCanvas() {
  const { width, height } = size();
  const sel = store.state.selection;
  const corner = activeCorner && sel?.area === activeCorner.area && !sel.stair && !sel.zone ? activeCorner.index : null;
  canvas.innerHTML = renderSketch(result, { width, height, view, selection: sel, grid: showGrid, activeCorner: corner, selectedText });
}

function sketchBounds() {
  let b: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const s of result.structures) {
    for (const a of s.areas) {
      if (a.shape.path.segments.length === 0) continue;
      const ab = bounds(a.shape.path);
      b = b
        ? { minX: Math.min(b.minX, ab.minX), minY: Math.min(b.minY, ab.minY), maxX: Math.max(b.maxX, ab.maxX), maxY: Math.max(b.maxY, ab.maxY) }
        : ab;
    }
  }
  // Only stretch for labels when there is a drawing, so a lone label doesn't zoom in on itself.
  if (b) {
    for (const t of store.state.sketch.texts ?? []) {
      b = { minX: Math.min(b.minX, t.at.x), minY: Math.min(b.minY, t.at.y), maxX: Math.max(b.maxX, t.at.x), maxY: Math.max(b.maxY, t.at.y) };
    }
  }
  return b;
}

let autoFit = true;
try {
  autoFit = localStorage.getItem("sketch:autofit") !== "off";
} catch {
  /* storage unavailable */
}
const autoFitToggle = document.getElementById("auto-fit") as HTMLInputElement;
autoFitToggle.checked = autoFit;

function setAutoFit(on: boolean) {
  if (autoFit === on) return;
  autoFit = on;
  autoFitToggle.checked = on;
  try {
    localStorage.setItem("sketch:autofit", on ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
}

/** Zoomed or panned by hand: stop auto fitting so the view stays put. */
function manualView() {
  if (!autoFit) return;
  setAutoFit(false);
  say("Auto fit off — F or Fit to fit again");
}

function fit() {
  const b = sketchBounds();
  const { width, height } = size();
  if (!b) {
    view = { scale: 12, ox: width / 2, oy: height / 2 };
  } else {
    const pad = 60;
    const w = Math.max(b.maxX - b.minX, 10);
    const h = Math.max(b.maxY - b.minY, 10);
    const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h, 40);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    view = { scale, ox: width / 2 - cx * scale, oy: height / 2 + cy * scale };
  }
  drawCanvas();
}

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const w = toWorld(view, p);
    const scale = Math.min(200, Math.max(1, view.scale * Math.exp(-e.deltaY * 0.0015)));
    view = { scale, ox: p.x - w.x * scale, oy: p.y + w.y * scale };
    manualView();
    drawCanvas();
  },
  { passive: false },
);

type Drag =
  | { kind: "pan"; startX: number; startY: number; ox: number; oy: number; at: Point; moved: boolean }
  | { kind: "move"; sel: Selection; start: Point; origin: Point; key: string }
  | { kind: "handle"; sel: Selection; handle: StairHandleKey; key: string }
  | { kind: "label"; sel: Selection; start: Point; offset: Point; key: string }
  | { kind: "text"; id: string; start: Point; at: Point; key: string };

let drag: Drag | null = null;
let dragSeq = 0;
const GRID_SNAP = 0.5; // feet
const VERTEX_SNAP_PX = 10;

/** Corners of every area outline, optionally leaving one area out. */
function areaVertices(skipArea?: string): Point[] {
  const pts: Point[] = [];
  for (const s of result.structures) {
    for (const a of s.areas) {
      if (a.area.id === skipArea) continue;
      pts.push(...flatten(a.shape.path, Math.PI / 8));
    }
  }
  return pts;
}

/**
 * Snap a move of `mine` (points at the original position) by the proposed
 * offset: onto a target corner if one is within a few pixels, otherwise to
 * the half-foot grid. Returns the new origin.
 */
function snapMove(mine: Point[], targets: Point[], origin: Point, proposed: Point, free: boolean): Point {
  if (free) return proposed;
  const dx = proposed.x - origin.x;
  const dy = proposed.y - origin.y;
  let best: { d: number; ox: number; oy: number } | null = null;
  for (const m of mine) {
    const mx = m.x + dx;
    const my = m.y + dy;
    for (const o of targets) {
      const d = Math.hypot(o.x - mx, o.y - my) * view.scale;
      if (d < VERTEX_SNAP_PX && (!best || d < best.d)) best = { d, ox: o.x - mx, oy: o.y - my };
    }
  }
  if (best) return { x: proposed.x + best.ox, y: proposed.y + best.oy };
  return { x: Math.round(proposed.x / GRID_SNAP) * GRID_SNAP, y: Math.round(proposed.y / GRID_SNAP) * GRID_SNAP };
}

function dragOrigin(sel: Selection): Point | null {
  const f = findArea(store.state.sketch, sel);
  if (!f) return null;
  if (sel.stair) return (f.area.stairs ?? []).find((st) => st.id === sel.stair)?.origin ?? null;
  if (sel.zone) return f.area.zones.find((z) => z.id === sel.zone)?.origin ?? null;
  return f.area.origin;
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.focus();
  const el = e.target as Element;
  const stairEl = el.closest("[data-stair]");
  const areaEl = el.closest("[data-area]");
  const r = canvas.getBoundingClientRect();
  const p = { x: e.clientX - r.left, y: e.clientY - r.top };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic or already-released pointer */
  }
  const cornerEl = el.closest("[data-corner]");
  if (cornerEl && e.button === 0) {
    const area = cornerEl.getAttribute("data-area")!;
    const index = Number(cornerEl.getAttribute("data-corner"));
    activeCorner = activeCorner?.area === area && activeCorner.index === index ? null : { area, index };
    drawCanvas();
    drawVectorBar();
    return;
  }
  const textEl = el.closest("[data-text]");
  if (textEl && e.button === 0) {
    const id = textEl.getAttribute("data-text")!;
    const t = (store.state.sketch.texts ?? []).find((x) => x.id === id);
    if (!t) return;
    selectText(id);
    dragSeq += 1;
    drag = { kind: "text", id, start: toWorld(view, p), at: { ...t.at }, key: `text:${id}:${dragSeq}` };
    return;
  }
  if (selectedText) selectText(null);
  const handleEl = el.closest("[data-handle]");
  const labelEl = el.closest("[data-label]");
  if (handleEl && e.button === 0) {
    const sel: Selection = {
      structure: handleEl.getAttribute("data-structure")!,
      area: handleEl.getAttribute("data-area")!,
      stair: handleEl.getAttribute("data-stair")!,
    };
    dragSeq += 1;
    drag = { kind: "handle", sel, handle: handleEl.getAttribute("data-handle") as StairHandleKey, key: `handle:${sel.stair}:${dragSeq}` };
    return;
  }
  if (labelEl && e.button === 0) {
    const sel: Selection = { structure: labelEl.getAttribute("data-structure")!, area: labelEl.getAttribute("data-area")! };
    store.select(sel);
    const f = findArea(store.state.sketch, sel);
    dragSeq += 1;
    drag = { kind: "label", sel, start: toWorld(view, p), offset: { ...(f?.area.label ?? { x: 0, y: 0 }) }, key: `label:${sel.area}:${dragSeq}` };
    return;
  }
  const zoneEl = stairEl ? null : el.closest("[data-zone]");
  if ((stairEl || zoneEl || areaEl) && e.button === 0) {
    const t = (stairEl ?? zoneEl ?? areaEl)!;
    const sel: Selection = { structure: t.getAttribute("data-structure")!, area: t.getAttribute("data-area")! };
    if (stairEl) sel.stair = stairEl.getAttribute("data-stair")!;
    if (zoneEl) sel.zone = zoneEl.getAttribute("data-zone")!;
    store.select(sel);
    const origin = dragOrigin(sel);
    if (origin) {
      dragSeq += 1;
      drag = { kind: "move", sel, start: toWorld(view, p), origin: { ...origin }, key: `move:${sel.stair ?? sel.area}:${dragSeq}` };
    }
  } else {
    drag = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: view.ox, oy: view.oy, at: toWorld(view, p), moved: false };
    canvas.classList.add("panning");
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (drag.kind === "pan") {
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3) {
      drag.moved = true;
      manualView();
    }
    view = { ...view, ox: drag.ox + e.clientX - drag.startX, oy: drag.oy + e.clientY - drag.startY };
    drawCanvas();
    return;
  }
  const r = canvas.getBoundingClientRect();
  const w = toWorld(view, { x: e.clientX - r.left, y: e.clientY - r.top });
  if (drag.kind === "handle") {
    const d = drag;
    const f = findArea(store.state.sketch, d.sel);
    const st = (f?.area.stairs ?? []).find((x) => x.id === d.sel.stair);
    if (!st) return;
    const next = dragStairHandle(st, d.handle, w);
    if (next.width !== st.width || next.run1 !== st.run1 || next.run2 !== st.run2) {
      store.update(
        (draft) => {
          const t = (findArea(draft, d.sel)?.area.stairs ?? []).find((x) => x.id === d.sel.stair);
          if (t) Object.assign(t, next);
        },
        { coalesce: d.key },
      );
    }
    return;
  }
  if (drag.kind === "text") {
    const d = drag;
    const inch = (v: number) => Math.round(v * 12) / 12;
    const next = { x: inch(d.at.x + w.x - d.start.x), y: inch(d.at.y + w.y - d.start.y) };
    store.update(
      (draft) => {
        const t = (draft.texts ?? []).find((x) => x.id === d.id);
        if (t) t.at = next;
      },
      { coalesce: d.key },
    );
    return;
  }
  if (drag.kind === "label") {
    const d = drag;
    const inch = (v: number) => Math.round(v * 12) / 12;
    const next = { x: inch(d.offset.x + w.x - d.start.x), y: inch(d.offset.y + w.y - d.start.y) };
    store.update(
      (draft) => {
        const f = findArea(draft, d.sel);
        if (f) f.area.label = next;
      },
      { coalesce: d.key },
    );
    return;
  }
  const d = drag;
  const proposed = { x: d.origin.x + w.x - d.start.x, y: d.origin.y + w.y - d.start.y };
  const found = findArea(store.state.sketch, d.sel);
  if (!found) return;
  let next: Point;
  if (d.sel.stair) {
    const st = (found.area.stairs ?? []).find((x) => x.id === d.sel.stair);
    if (!st) return;
    const mine = stairDrawing({ ...st, origin: d.origin }).parts.flat();
    next = snapMove(mine, areaVertices(), d.origin, proposed, e.altKey);
  } else if (d.sel.zone) {
    const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === d.sel.area);
    const zr = ar?.zones.find((z) => z.zone.id === d.sel.zone);
    if (!ar || !zr) return;
    const cur = zr.zone.origin;
    const mine = flatten(zr.path, Math.PI / 8).map((q) => ({ x: q.x - cur.x + d.origin.x, y: q.y - cur.y + d.origin.y }));
    // Snap to the area's corners and to the other zones' corners.
    const targets = [
      ...flatten(ar.shape.path, Math.PI / 8),
      ...ar.zones.filter((z) => z.zone.id !== d.sel.zone).flatMap((z) => flatten(z.path, Math.PI / 8)),
    ];
    next = snapMove(mine, targets, d.origin, proposed, e.altKey);
  } else {
    const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === d.sel.area);
    if (!ar) return;
    const cur = ar.area.origin;
    // Outline points as they were at drag start (the outline moves with the origin).
    const pts = (ar.shape.path.segments.length ? flatten(ar.shape.path, Math.PI / 8) : [ar.shape.path.start]).map((q) => ({
      x: q.x - cur.x + d.origin.x,
      y: q.y - cur.y + d.origin.y,
    }));
    next = snapMove(pts, areaVertices(d.sel.area), d.origin, proposed, e.altKey);
  }
  const cur = dragOrigin(d.sel);
  if (cur && (cur.x !== next.x || cur.y !== next.y)) {
    store.update(
      (draft) => {
        const f = findArea(draft, d.sel);
        if (!f) return;
        if (d.sel.stair) {
          const st = (f.area.stairs ?? []).find((x) => x.id === d.sel.stair);
          if (st) st.origin = next;
        } else if (d.sel.zone) {
          const z = f.area.zones.find((x) => x.id === d.sel.zone);
          if (z) z.origin = next;
        } else {
          f.area.origin = next;
        }
      },
      { coalesce: d.key },
    );
  }
});

function endDrag() {
  // A click (not a pan) on empty space places the start point of an area that has no walls yet.
  if (drag?.kind === "pan" && !drag.moved) {
    const f = findArea(store.state.sketch, store.state.selection);
    if (f && f.area.vectors.trim() === "" && !store.state.selection?.zone) {
      const at = drag.at;
      const targets = areaVertices(f.area.id);
      const origin = snapMove([at], targets, at, at, false);
      editArea((a) => (a.origin = origin));
      vectors.focus();
    }
  }
  const wasEdit = drag !== null && drag.kind !== "pan";
  drag = null;
  canvas.classList.remove("panning");
  if (wasEdit && autoFit) fit();
  store.breakCoalesce();
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("dblclick", (e) => {
  const labelEl = (e.target as Element).closest("[data-label]");
  if (!labelEl) return;
  const sel: Selection = { structure: labelEl.getAttribute("data-structure")!, area: labelEl.getAttribute("data-area")! };
  store.update((draft) => {
    const f = findArea(draft, sel);
    if (f) delete f.area.label;
  });
});
canvas.addEventListener("pointercancel", endDrag);

new ResizeObserver(() => drawCanvas()).observe(canvas);

// ---------- tree ----------

const tree = $<HTMLDivElement>("tree");

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function drawTree() {
  const sel = store.state.selection;
  const html = result.structures
    .map((s) => {
      const items = s.areas
        .map((a) => {
          const selected = sel?.area === a.area.id ? " selected" : "";
          const warn = a.problems.length ? ` <span class="warn" title="${esc(a.problems.join("\n"))}">⚠</span>` : "";
          return `<li class="area-item${selected}" data-structure="${s.structure.id}" data-area="${a.area.id}"><span>${esc(a.area.name)}${warn}</span><span class="sf" title="${a.area.kind === "living" ? "Counted under ANSI" : "Area"}">${formatSqFt(a.area.kind === "living" ? a.ansi.counted : a.shape.area, 0)}</span></li>`;
        })
        .join("");
      const current = sel?.structure === s.structure.id ? " current" : "";
      return `<li><div class="structure${current}" data-structure="${s.structure.id}">${esc(s.structure.name)}</div><ul>${items}</ul></li>`;
    })
    .join("");
  tree.innerHTML = `<ul>${html}</ul>`;
}

tree.addEventListener("click", (e) => {
  const li = (e.target as Element).closest("[data-structure]");
  if (!li) return;
  const structure = li.getAttribute("data-structure")!;
  const area = li.getAttribute("data-area");
  if (area) {
    store.select({ structure, area });
  } else {
    const s = store.state.sketch.structures.find((x) => x.id === structure);
    const first = s?.areas[0];
    if (first) store.select({ structure, area: first.id });
  }
});

// ---------- properties ----------

const props = {
  panel: $<HTMLElement>("props"),
  form: $<HTMLElement>("props").querySelector(".form") as HTMLElement,
  name: $<HTMLInputElement>("p-name"),
  kind: $<HTMLSelectElement>("p-kind"),
  level: $<HTMLInputElement>("p-level"),
  grade: $<HTMLSelectElement>("p-grade"),
  ceiling: $<HTMLSelectElement>("p-ceiling"),
  finished: $<HTMLInputElement>("p-finished"),
  connected: $<HTMLInputElement>("p-connected"),
  ox: $<HTMLInputElement>("p-ox"),
  oy: $<HTMLInputElement>("p-oy"),
  override: $<HTMLInputElement>("p-override"),
  overrideBucket: $<HTMLSelectElement>("p-override-bucket"),
  overrideNote: $<HTMLTextAreaElement>("p-override-note"),
  overrideBox: $<HTMLDetailsElement>("override-box"),
  showLabel: $<HTMLInputElement>("p-show-label"),
  showDims: $<HTMLInputElement>("p-show-dims"),
  resetLabel: $<HTMLButtonElement>("btn-reset-label"),
};
const sprops = {
  panel: $<HTMLElement>("structure-props"),
  name: $<HTMLInputElement>("s-name"),
  kind: $<HTMLSelectElement>("s-kind"),
};

props.overrideBucket.innerHTML = BUCKETS.map((b) => `<option value="${b}">${esc(BUCKET_LABELS[b])}</option>`).join("");

/** Set an input's value from state unless the user is typing in it (or the change is an undo/open). */
function sync(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  if (el.value === value) return;
  if (!external && document.activeElement === el) return;
  el.value = value;
}
function syncCheck(el: HTMLInputElement, value: boolean) {
  if (el.checked !== value) el.checked = value;
}

const fmtCoord = (v: number) => (v < 0 ? `-${formatFeetInches(-v)}` : formatFeetInches(v));

function drawProps() {
  const found = findArea(store.state.sketch, store.state.selection);
  props.panel.classList.toggle("disabled", !found);
  sprops.panel.classList.toggle("disabled", !found);
  if (!found) return;
  const { area, structure } = found;
  sync(props.name, area.name);
  sync(props.kind, area.kind);
  sync(props.level, area.level);
  sync(props.grade, area.grade);
  sync(props.ceiling, area.ceiling);
  syncCheck(props.finished, area.finished);
  syncCheck(props.connected, area.connected);
  sync(props.ox, fmtCoord(area.origin.x));
  sync(props.oy, fmtCoord(area.origin.y));
  syncCheck(props.override, !!area.override);
  props.overrideBucket.disabled = !area.override;
  props.overrideNote.disabled = !area.override;
  sync(props.overrideBucket, area.override?.bucket ?? "gla");
  sync(props.overrideNote, area.override?.note ?? "");
  if (area.override && external) props.overrideBox.open = true;
  props.form.classList.toggle("non-living", area.kind !== "living");
  syncCheck(props.showLabel, !area.hideLabel);
  syncCheck(props.showDims, !area.hideDims);
  props.resetLabel.disabled = !area.label || !!area.hideLabel;
  sync(sprops.name, structure.name);
  sync(sprops.kind, structure.kind);
}

function editArea(fn: (a: ReturnType<typeof newArea>) => void, coalesce?: string) {
  const sel = store.state.selection;
  if (!sel) return;
  store.update(
    (draft) => {
      const f = findArea(draft, sel);
      if (f) fn(f.area);
    },
    coalesce ? { coalesce: `${coalesce}:${sel.area}` } : {},
  );
}

props.name.addEventListener("input", () => editArea((a) => (a.name = props.name.value), "name"));
props.level.addEventListener("input", () => editArea((a) => (a.level = props.level.value.trim()), "level"));
props.kind.addEventListener("change", () => editArea((a) => (a.kind = props.kind.value as AreaKind)));
props.grade.addEventListener("change", () => editArea((a) => (a.grade = props.grade.value as Grade)));
props.ceiling.addEventListener("change", () => editArea((a) => (a.ceiling = props.ceiling.value as CeilingBand)));
props.finished.addEventListener("change", () => editArea((a) => (a.finished = props.finished.checked)));
props.connected.addEventListener("change", () => editArea((a) => (a.connected = props.connected.checked)));

function coordInput(el: HTMLInputElement, axis: "x" | "y") {
  el.addEventListener("input", () => {
    const t = el.value.trim();
    const neg = t.startsWith("-");
    const v = parseLength(neg ? t.slice(1) : t);
    el.classList.toggle("invalid", v === null);
    if (v !== null) editArea((a) => (a.origin = { ...a.origin, [axis]: neg ? -v : v }), `origin-${axis}`);
  });
  el.addEventListener("blur", () => {
    external = true;
    drawProps();
    external = false;
  });
}
coordInput(props.ox, "x");
coordInput(props.oy, "y");

props.showLabel.addEventListener("change", () =>
  editArea((a) => {
    if (props.showLabel.checked) delete a.hideLabel;
    else a.hideLabel = true;
  }),
);
props.showDims.addEventListener("change", () =>
  editArea((a) => {
    if (props.showDims.checked) delete a.hideDims;
    else a.hideDims = true;
  }),
);
props.resetLabel.addEventListener("click", () => editArea((a) => delete a.label));

props.override.addEventListener("change", () =>
  editArea((a) => {
    if (props.override.checked) a.override = { bucket: props.overrideBucket.value as Bucket, note: props.overrideNote.value };
    else delete a.override;
  }),
);
props.overrideBucket.addEventListener("change", () =>
  editArea((a) => {
    if (a.override) a.override.bucket = props.overrideBucket.value as Bucket;
  }),
);
props.overrideNote.addEventListener("input", () =>
  editArea((a) => {
    if (a.override) a.override.note = props.overrideNote.value;
  }, "override-note"),
);

function editStructure(fn: (s: ReturnType<typeof newStructure>) => void, coalesce?: string) {
  const sel = store.state.selection;
  if (!sel) return;
  store.update(
    (draft) => {
      const s = draft.structures.find((x) => x.id === sel.structure);
      if (s) fn(s);
    },
    coalesce ? { coalesce: `${coalesce}:${sel.structure}` } : {},
  );
}
sprops.name.addEventListener("input", () => editStructure((s) => (s.name = sprops.name.value), "sname"));
sprops.kind.addEventListener("change", () => editStructure((s) => (s.kind = sprops.kind.value as StructureKind)));

// ---------- stairs ----------

const stairs = {
  panel: $<HTMLElement>("stairs-panel"),
  list: $<HTMLDivElement>("stair-list"),
  form: $<HTMLDivElement>("stair-form"),
  type: $<HTMLSelectElement>("st-type"),
  width: $<HTMLInputElement>("st-width"),
  dir: $<HTMLSelectElement>("st-dir"),
  run1: $<HTMLInputElement>("st-run1"),
  run2: $<HTMLInputElement>("st-run2"),
  turn: $<HTMLSelectElement>("st-turn"),
  rot: $<HTMLSelectElement>("st-rot"),
  x: $<HTMLInputElement>("st-x"),
  y: $<HTMLInputElement>("st-y"),
};
stairs.type.innerHTML = STAIR_TYPES.map((t) => `<option value="${t.value}">${esc(t.label)}</option>`).join("");

const STAIR_TYPE_SHORT: Record<string, string> = { straight: "Straight", landing: "Landing", l: "L", winder: "Winder", u: "U" };

function selectedStair(): Stair | null {
  const sel = store.state.selection;
  const f = findArea(store.state.sketch, sel);
  return f && sel?.stair ? ((f.area.stairs ?? []).find((s) => s.id === sel.stair) ?? null) : null;
}

function drawStairs() {
  const sel = store.state.selection;
  const f = findArea(store.state.sketch, sel);
  // Only shown when the selected area has stairs; "+ Stair" in the Area panel adds one.
  stairs.panel.classList.toggle("hidden", !f || (f.area.stairs ?? []).length === 0);
  const list = f?.area.stairs ?? [];
  stairs.list.innerHTML = list.length
    ? list
        .map((st, i) => `<button data-stair="${esc(st.id)}" class="${sel?.stair === st.id ? "selected" : ""}">${i + 1}. ${STAIR_TYPE_SHORT[st.type]}</button>`)
        .join("")
    : `<span class="empty">None on this area</span>`;
  const st = selectedStair();
  stairs.form.classList.toggle("hidden", !st);
  if (!st) return;
  stairs.form.classList.toggle("one-flight", st.type === "straight");
  stairs.form.classList.toggle("no-turn", st.type === "straight" || st.type === "landing");
  sync(stairs.type, st.type);
  sync(stairs.width, formatFeetInches(st.width));
  sync(stairs.dir, st.direction);
  sync(stairs.run1, formatFeetInches(st.run1));
  sync(stairs.run2, formatFeetInches(st.run2));
  sync(stairs.turn, st.turn);
  sync(stairs.rot, String(((st.rotation % 360) + 360) % 360));
  sync(stairs.x, fmtCoord(st.origin.x));
  sync(stairs.y, fmtCoord(st.origin.y));
}

function editStair(fn: (s: Stair) => void, coalesce?: string) {
  const sel = store.state.selection;
  if (!sel?.stair) return;
  store.update(
    (draft) => {
      const f = findArea(draft, sel);
      const st = (f?.area.stairs ?? []).find((x) => x.id === sel.stair);
      if (st) fn(st);
    },
    coalesce ? { coalesce: `${coalesce}:${sel.stair}` } : {},
  );
}

stairs.list.addEventListener("click", (e) => {
  const b = (e.target as Element).closest("[data-stair]");
  const sel = store.state.selection;
  if (b && sel) store.select({ structure: sel.structure, area: sel.area, stair: b.getAttribute("data-stair")! });
});

$("btn-add-stair-2").addEventListener("click", () => $("btn-add-stair").click());

$("btn-add-stair").addEventListener("click", () => {
  setCollapsed(stairs.panel, false);
  const sel = store.state.selection;
  const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === sel?.area);
  if (!sel || !ar) return;
  // Start just inside the area's lower-left corner, sized to fit.
  const b = ar.shape.path.segments.length ? bounds(ar.shape.path) : { minX: ar.area.origin.x, minY: ar.area.origin.y, maxX: ar.area.origin.x + 14, maxY: ar.area.origin.y + 14 };
  const run1 = Math.max(3, Math.min(12, Math.floor(b.maxY - b.minY - 2)));
  const st = defaultStair({ id: newId("t"), origin: { x: Math.ceil(b.minX + 1), y: Math.ceil(b.minY + 1) }, run1 });
  store.update((draft) => {
    const f = findArea(draft, sel);
    if (!f) return;
    (f.area.stairs ??= []).push(st);
    return { structure: sel.structure, area: sel.area, stair: st.id };
  });
});

$("btn-delete-stair").addEventListener("click", () => {
  const sel = store.state.selection;
  if (!sel?.stair) return;
  store.update((draft) => {
    const f = findArea(draft, sel);
    if (f) f.area.stairs = (f.area.stairs ?? []).filter((x) => x.id !== sel.stair);
    return { structure: sel.structure, area: sel.area };
  });
  say("Stair deleted (Ctrl+Z to undo)");
});

function rotateStair() {
  editStair((st) => (st.rotation = (st.rotation + 270) % 360)); // clockwise on screen
}
$("btn-rotate-stair").addEventListener("click", rotateStair);

stairs.type.addEventListener("change", () => editStair((st) => (st.type = stairs.type.value as Stair["type"])));
stairs.dir.addEventListener("change", () => editStair((st) => (st.direction = stairs.dir.value as Stair["direction"])));
stairs.turn.addEventListener("change", () => editStair((st) => (st.turn = stairs.turn.value as Stair["turn"])));
stairs.rot.addEventListener("change", () => editStair((st) => (st.rotation = Number(stairs.rot.value))));

function lengthField(el: HTMLInputElement, apply: (st: Stair, v: number) => void, key: string, allowNegative = false) {
  el.addEventListener("input", () => {
    const t = el.value.trim();
    const neg = allowNegative && t.startsWith("-");
    const v = parseLength(neg ? t.slice(1) : t);
    const ok = v !== null && (allowNegative || v > 0);
    el.classList.toggle("invalid", !ok);
    if (ok) editStair((st) => apply(st, neg ? -v! : v!), key);
  });
  el.addEventListener("blur", () => {
    el.classList.remove("invalid");
    external = true;
    drawStairs();
    external = false;
  });
}
lengthField(stairs.width, (st, v) => (st.width = v), "st-width");
lengthField(stairs.run1, (st, v) => (st.run1 = v), "st-run1");
lengthField(stairs.run2, (st, v) => (st.run2 = v), "st-run2");
lengthField(stairs.x, (st, v) => (st.origin = { ...st.origin, x: v }), "st-x", true);
lengthField(stairs.y, (st, v) => (st.origin = { ...st.origin, y: v }), "st-y", true);

// ---------- collapsible panels (remembered in this browser) ----------

const COLLAPSED_KEY = "sketch:collapsed";
let collapsed = new Set<string>();
try {
  collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as string[]);
} catch {
  /* storage unavailable or bad */
}

function panelKey(panel: Element): string {
  return panel.id || (panel.querySelector("h2")?.textContent ?? "").trim().toLowerCase();
}

function setCollapsed(panel: Element, on: boolean) {
  panel.classList.toggle("collapsed", on);
  const key = panelKey(panel);
  if (on) collapsed.add(key);
  else collapsed.delete(key);
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    /* storage unavailable */
  }
}

for (const panel of document.querySelectorAll(".panel")) {
  const h2 = panel.querySelector("h2");
  if (!h2) continue;
  h2.title = "Click to collapse or expand";
  if (collapsed.has(panelKey(panel))) panel.classList.add("collapsed");
  h2.addEventListener("click", () => setCollapsed(panel, !panel.classList.contains("collapsed")));
}

// ---------- ceiling zones and openings ----------

const zones = {
  panel: $<HTMLElement>("zones-panel"),
  list: $<HTMLDivElement>("zone-list"),
  form: $<HTMLDivElement>("zone-form"),
  name: $<HTMLInputElement>("z-name"),
  band: $<HTMLSelectElement>("z-band"),
  side: $<HTMLSelectElement>("z-side"),
  bandNew: $<HTMLSelectElement>("z-band-new"),
  depth: $<HTMLInputElement>("z-depth"),
  inset: $<HTMLInputElement>("z-inset"),
};
const bandOptions = ZONE_BANDS.map((b) => `<option value="${b.value}">${esc(b.label)}</option>`).join("");
zones.band.innerHTML = bandOptions;
zones.bandNew.innerHTML = bandOptions;

/** Area whose (empty) zones panel was opened with "+ Ceiling / opening". */
let zonesOpenFor: string | null = null;

$("btn-show-zones").addEventListener("click", () => {
  const f = findArea(store.state.sketch, store.state.selection);
  if (!f) return;
  zonesOpenFor = f.area.id;
  setCollapsed(zones.panel, false);
  drawZones();
  zones.panel.scrollIntoView({ block: "nearest" });
});
$("btn-hide-zones").addEventListener("click", () => {
  zonesOpenFor = null;
  drawZones();
});

function drawZones() {
  const sel = store.state.selection;
  const f = findArea(store.state.sketch, sel);
  // Only shown when the selected area has zones, or "+ Ceiling / opening" was just pressed.
  if (zonesOpenFor && zonesOpenFor !== f?.area.id) zonesOpenFor = null;
  const show = !!f && f.area.kind === "living" && (f.area.zones.length > 0 || zonesOpenFor === f.area.id);
  zones.panel.classList.toggle("hidden", !show);
  $("btn-hide-zones").classList.toggle("hidden", !f || f.area.zones.length > 0);
  $("btn-show-zones").classList.toggle("hidden", !f || f.area.kind !== "living" || show);
  if (!f) return;
  const list = f.area.zones;
  zones.list.innerHTML = list.length
    ? list
        .map((z, i) => {
          const short = ZONE_BANDS.find((b) => b.value === z.band)?.short ?? z.band;
          return `<button data-zone="${esc(z.id)}" class="${sel?.zone === z.id ? "selected" : ""}">${i + 1}. ${esc(z.name ? `${z.name} (${short})` : short)}</button>`;
        })
        .join("")
    : `<span class="empty">None — the whole area has the ceiling set above</span>`;
  const z = sel?.zone ? list.find((x) => x.id === sel.zone) : undefined;
  zones.form.classList.toggle("hidden", !z);
  if (!z) return;
  sync(zones.name, z.name ?? "");
  sync(zones.band, z.band);
}

function editZone(fn: (z: Area["zones"][number]) => void, coalesce?: string) {
  const zoneId = store.state.selection?.zone;
  if (!zoneId) return;
  editArea((a) => {
    const z = a.zones.find((x) => x.id === zoneId);
    if (z) fn(z);
  }, coalesce ? `${coalesce}-${zoneId}` : undefined);
}

zones.list.addEventListener("click", (e) => {
  const b = (e.target as Element).closest("[data-zone]");
  const sel = store.state.selection;
  if (b && sel) store.select({ structure: sel.structure, area: sel.area, zone: b.getAttribute("data-zone")! });
});
zones.name.addEventListener("input", () =>
  editZone((z) => {
    const v = zones.name.value.trim();
    if (v) z.name = v;
    else delete z.name;
  }, "zone-name"),
);
zones.band.addEventListener("change", () => editZone((z) => (z.band = zones.band.value as ZoneBand)));

function addZone(z: Omit<Area["zones"][number], "id">) {
  setCollapsed(zones.panel, false);
  const sel = store.state.selection;
  if (!sel) return;
  const id = newId("z");
  store.update((draft) => {
    const f = findArea(draft, sel);
    if (!f) return;
    f.area.zones.push({ id, ...z });
    return { structure: sel.structure, area: sel.area, zone: id };
  });
}

$("btn-add-strip").addEventListener("click", () => {
  const sel = store.state.selection;
  const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === sel?.area);
  if (!ar || ar.shape.path.segments.length === 0) {
    say("Draw the area's walls first");
    return;
  }
  const depth = parseLength(zones.depth.value);
  const inset = parseLength(zones.inset.value) ?? 0;
  if (depth === null || depth <= 0) {
    zones.depth.classList.add("invalid");
    say("Enter a depth like 4' or 3'6\"");
    return;
  }
  zones.depth.classList.remove("invalid");
  const strip = stripZone(bounds(ar.shape.path), zones.side.value as Side, depth, inset);
  addZone({ band: zones.bandNew.value as ZoneBand, ...strip });
});

$("btn-add-zone").addEventListener("click", () => {
  const f = findArea(store.state.sketch, store.state.selection);
  if (!f) return;
  addZone({ band: zones.bandNew.value as ZoneBand, origin: { ...f.area.origin }, vectors: "" });
  vectors.focus();
});

$("btn-delete-zone").addEventListener("click", () => {
  const sel = store.state.selection;
  if (!sel?.zone) return;
  store.update((draft) => {
    const f = findArea(draft, sel);
    if (f) f.area.zones = f.area.zones.filter((z) => z.id !== sel.zone);
    return { structure: sel.structure, area: sel.area };
  });
  say("Zone deleted (Ctrl+Z to undo)");
});

// ---------- vector bar ----------

/** Put a typed character at the end of the walls box and carry on typing there. */
function typeIntoWalls(ch: string) {
  if (vectors.disabled) return;
  vectors.focus();
  const end = vectors.value.length;
  vectors.setRangeText(ch, end, end, "end");
  vectors.dispatchEvent(new Event("input"));
}

const vectors = $<HTMLTextAreaElement>("vectors");
const vstatus = $<HTMLDivElement>("vector-status");

vectors.addEventListener("input", () => {
  const zoneId = store.state.selection?.zone;
  if (zoneId) {
    editArea((a) => {
      const z = a.zones.find((x) => x.id === zoneId);
      if (z) z.vectors = vectors.value;
    }, `zone-vectors-${zoneId}`);
  } else {
    editArea((a) => (a.vectors = vectors.value), "vectors");
  }
});

const ARROWS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** "30" then an arrow key → "U30 ". Returns true if it handled the key. */
function arrowIntoWalls(key: string, atEnd: boolean): boolean {
  const dir = ARROWS[key];
  if (!dir || vectors.disabled) return false;
  const caret = atEnd ? vectors.value.length : (vectors.selectionStart ?? vectors.value.length);
  if (!atEnd && vectors.selectionStart !== vectors.selectionEnd) return false;
  const r = applyArrow(vectors.value, caret, dir);
  if (!r) return false;
  vectors.value = r.text;
  vectors.setSelectionRange(r.caret, r.caret);
  vectors.dispatchEvent(new Event("input"));
  return true;
}

/** "L24" then a → "L24 A": A closes the outline even typed straight after a wall. */
function closeKeyIntoWalls(atEnd: boolean): boolean {
  if (vectors.disabled) return false;
  const caret = atEnd ? vectors.value.length : (vectors.selectionStart ?? vectors.value.length);
  if (!atEnd && vectors.selectionStart !== vectors.selectionEnd) return false;
  const before = vectors.value.slice(0, caret);
  if (before === "" || /[\s,]$/.test(before)) return false; // a token start: A may begin a polar move (A30:12)
  vectors.setRangeText(" A", caret, caret, "end");
  vectors.dispatchEvent(new Event("input"));
  return true;
}

vectors.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!e.shiftKey && arrowIntoWalls(e.key, false)) e.preventDefault();
  else if (e.key.toLowerCase() === "a" && closeKeyIntoWalls(false)) e.preventDefault();
});

const vectorLabel = document.querySelector<HTMLLabelElement>(".vector-label")!;

/** One line on how the area's ceiling zones and openings are counted. */
function zoneBreakdown(r: AreaResult): string {
  if (r.zones.length === 0 || r.area.kind !== "living") return "";
  const a = r.ansi;
  const bits = [
    a.full > 0.05 ? `7'+ ${formatSqFt(a.full)}` : "",
    a.reduced > 0.05 ? `5'–7' ${formatSqFt(a.reduced)}` : "",
    a.low > 0.05 ? `under 5' ${formatSqFt(a.low)} (not counted)` : "",
    a.opening > 0.05 ? `open ${formatSqFt(a.opening)} (not counted)` : "",
  ].filter(Boolean);
  return `<div>Ceilings: ${bits.join(" · ")}</div>`;
}

function drawVectorBar() {
  const sel = store.state.selection;
  const found = findArea(store.state.sketch, sel);
  vectors.disabled = !found;
  if (!found) {
    vectors.value = "";
    vstatus.textContent = "Select or add an area.";
    return;
  }
  const r = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === found.area.id);
  if (!r) return;
  const zr = sel?.zone ? r.zones.find((z) => z.zone.id === sel.zone) : undefined;
  vectorLabel.textContent = zr ? "Zone" : "Walls";
  sync(vectors, zr ? zr.zone.vectors : found.area.vectors);
  if (zr) {
    const band = ZONE_BANDS.find((b) => b.value === zr.zone.band)?.label ?? zr.zone.band;
    const bits = [
      zr.path.segments.length === 0
        ? "Type the zone outline from its start point"
        : zr.closure.closed
          ? `<span class="ok">✓ closed</span>`
          : `<span class="bad">open (${closingMove(zr.closure.dx, zr.closure.dy)} to close)</span>`,
      `${formatSqFt(zr.area)} sf`,
      esc(band),
      zr.inside ? "" : `<span class="bad">extends outside ${esc(found.area.name)}</span>`,
    ].filter(Boolean);
    vstatus.innerHTML = bits.join(" · ") + zoneBreakdown(r);
    return;
  }
  const sh = r.shape;
  if (sh.path.segments.length === 0) {
    vstatus.innerHTML = "Type walls from the start point, e.g. <b>R24 U30 L24 D30</b>.";
    return;
  }
  const parts: string[] = [];
  if (sh.closure.closed) parts.push(`<span class="ok">✓ closed</span>`);
  else
    parts.push(
      `<span class="bad">open: misses the start by ${formatFeetInches(sh.closure.distance)} ` +
        `(${closingMove(sh.closure.dx, sh.closure.dy)} to close)</span>`,
    );
  parts.push(`${formatSqFt(sh.area)} sf`, `perimeter ${formatFeetInches(sh.perimeter)}`);
  if (r.ansi.bucket !== "excluded" || r.ansi.counted > 0) parts.push(`→ ${BUCKET_LABELS[r.ansi.bucket]} ${formatSqFt(r.ansi.counted)} sf`);
  const actions: string[] = [];
  const cornerHere = activeCorner?.area === r.area.id ? activeCorner.index : null;
  if (sh.closure.closed && cornerHere !== null) {
    actions.push(`Corner ${cornerHere + 1}: <button class="inline" data-action="delete">Delete wall</button> leaving this corner (opens the outline here; press again to keep going back)`);
  } else if (sh.closure.closed) {
    actions.push(`<span class="hint">Click a corner to delete the wall leaving it, or Backspace on the drawing removes the last wall.</span>`);
  } else if (sh.path.segments.length > 0) {
    actions.push(
      `<button class="inline" data-action="delete">Delete last wall</button> <button class="inline" data-action="close">Close (A)</button> <span class="hint">or keep typing back to the start.</span>`,
    );
  }
  const problems = r.problems.filter((p) => !p.startsWith("outline does not close"));
  vstatus.innerHTML =
    parts.join(" · ") +
    zoneBreakdown(r) +
    `<div class="actions">${actions.join(" ")}</div>` +
    (problems.length ? `<ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "");
}

/** Delete the wall leaving the picked corner (closed outline) or the last wall, stepping the pen back. */
function deleteWallAction(): boolean {
  const f = findArea(store.state.sketch, store.state.selection);
  if (!f || store.state.selection?.zone || store.state.selection?.stair) return false;
  const corner = activeCorner?.area === f.area.id ? activeCorner.index : null;
  const r = deleteWall(f.area.vectors, f.area.origin, corner);
  if (!r) return false;
  const wasClosed = corner !== null;
  activeCorner = null;
  editArea((a) => {
    a.vectors = r.vectors;
    a.origin = r.origin;
  });
  external = true;
  drawVectorBar();
  external = false;
  if (wasClosed) say("Wall deleted: type walls from the corner, back to the start (or A) to close");
  return true;
}

vstatus.addEventListener("click", (e) => {
  const action = (e.target as Element).closest("[data-action]")?.getAttribute("data-action");
  const f = findArea(store.state.sketch, store.state.selection);
  if (!action || !f) return;
  if (action === "delete") {
    deleteWallAction();
    vectors.focus();
    vectors.setSelectionRange(vectors.value.length, vectors.value.length);
  } else if (action === "close") {
    editArea((a) => (a.vectors = closeOutline(a.vectors)));
    vectors.focus();
  }
});

// ---------- templates ----------

const tpl = {
  box: $<HTMLDetailsElement>("tpl"),
  select: $<HTMLSelectElement>("tpl-select"),
  params: $<HTMLDivElement>("tpl-params"),
  msg: $<HTMLDivElement>("tpl-msg"),
};
tpl.select.innerHTML = TEMPLATES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join("");

function drawTemplateParams() {
  const t = TEMPLATES.find((x) => x.id === tpl.select.value) ?? TEMPLATES[0]!;
  tpl.params.innerHTML = t.params
    .map((p) => `<label>${esc(p.label)} <input type="text" inputmode="decimal" data-key="${p.key}" value="${esc(formatFeetInches(p.value))}"/></label>`)
    .join("");
  tpl.msg.textContent = "";
}
tpl.select.addEventListener("change", drawTemplateParams);
drawTemplateParams();

/** Read the template form; returns vectors (and kind) or shows why not. */
function templateResult(): { vectors: string; kind?: AreaKind; label: string } | null {
  const t = TEMPLATES.find((x) => x.id === tpl.select.value);
  if (!t) return null;
  const values: Record<string, number> = {};
  for (const input of tpl.params.querySelectorAll<HTMLInputElement>("input[data-key]")) {
    const v = parseLength(input.value);
    input.classList.toggle("invalid", v === null);
    if (v === null) {
      tpl.msg.textContent = "Enter lengths like 24, 24.5 or 24'6\"";
      return null;
    }
    values[input.dataset.key!] = v;
  }
  const problem = checkTemplate(t, values);
  tpl.msg.textContent = problem ?? "";
  if (problem) return null;
  return t.kind ? { vectors: t.build(values), kind: t.kind, label: t.label } : { vectors: t.build(values), label: t.label };
}

$("tpl-apply").addEventListener("click", () => {
  const r = templateResult();
  if (!r) return;
  editArea((a) => {
    a.vectors = r.vectors;
    if (r.kind) a.kind = r.kind;
  });
  tpl.box.open = false;
  fit();
});

$("tpl-new").addEventListener("click", () => {
  const r = templateResult();
  const sel = store.state.selection;
  if (!r) return;
  const origin = nextFreeOrigin();
  store.update((draft) => {
    const s = draft.structures.find((x) => x.id === sel?.structure) ?? draft.structures[0];
    if (!s) return null;
    const a = newArea({ name: r.label, origin, vectors: r.vectors, ...(r.kind ? { kind: r.kind } : {}) });
    s.areas.push(a);
    return { structure: s.id, area: a.id };
  });
  tpl.box.open = false;
  fit();
});

// ---------- report header ----------

type MetaKey = "subject";
const metaFields: [string, MetaKey][] = [["m-subject", "subject"]];
for (const [id, key] of metaFields) {
  const el = $<HTMLInputElement>(id);
  el.addEventListener("input", () =>
    store.update(
      (draft) => {
        const v = el.value;
        if (v.trim() === "") delete draft.meta[key];
        else draft.meta[key] = v;
      },
      { coalesce: `meta-${key}` },
    ),
  );
}
function drawMeta() {
  for (const [id, key] of metaFields) sync($<HTMLInputElement>(id), store.state.sketch.meta[key] ?? "");
}

// ---------- room labels ----------

let selectedText: string | null = null;
const labelText = $<HTMLInputElement>("label-text");
const labelCustom = $<HTMLInputElement>("label-custom");
const labelGroups = $("label-groups");

// "My labels": custom names the user chose to keep, saved in this browser.
const MY_LABELS_KEY = "sketch:my-labels";
const OPEN_GROUPS_KEY = "sketch:label-groups-open";
function loadList(key: string, fallback: string[]): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : fallback;
  } catch {
    return fallback;
  }
}
function saveList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}
let myLabels = loadList(MY_LABELS_KEY, []);
const openGroups = new Set(loadList(OPEN_GROUPS_KEY, ["My labels", "Rooms"]));

function drawLabelGroups() {
  const chip = (t: string, mine = false) =>
    `<button data-label-text="${esc(t)}">${esc(t)}${mine ? `<span class="x" data-forget="${esc(t)}" title="Remove from My labels">×</span>` : ""}</button>`;
  const groups = [
    ...(myLabels.length ? [{ name: "My labels", labels: myLabels, mine: true }] : []),
    ...LABEL_GROUPS.map((g) => ({ ...g, mine: false })),
  ];
  labelGroups.innerHTML = groups
    .map(
      (g) =>
        `<details data-group="${esc(g.name)}"${openGroups.has(g.name) ? " open" : ""} class="${g.mine ? "mine" : ""}"><summary>${esc(g.name)}</summary>` +
        `<div class="chips">${g.labels.map((t) => chip(t, g.mine)).join("")}</div></details>`,
    )
    .join("");
  updateLabelCount();
}
drawLabelGroups();

labelGroups.addEventListener(
  "toggle",
  (e) => {
    const d = e.target as HTMLDetailsElement;
    const name = d.getAttribute("data-group");
    if (!name) return;
    if (d.open) openGroups.add(name);
    else openGroups.delete(name);
    saveList(OPEN_GROUPS_KEY, [...openGroups]);
  },
  true,
);

function keepLabel(text: string) {
  const name = text.trim();
  if (!name) return;
  if (COMMON_LABELS.some((t) => t.toLowerCase() === name.toLowerCase())) {
    say(`"${name}" is already a common label`);
    return;
  }
  if (myLabels.some((t) => t.toLowerCase() === name.toLowerCase())) {
    say(`"${name}" is already in My labels`);
    return;
  }
  myLabels = [...myLabels, name].sort((a, b) => a.localeCompare(b));
  saveList(MY_LABELS_KEY, myLabels);
  openGroups.add("My labels");
  drawLabelGroups();
  say(`Saved "${name}" to My labels`);
}

function updateLabelCount() {
  $("my-label-count").textContent = myLabels.length ? `(${myLabels.length})` : "(none yet)";
  ($("btn-export-labels") as HTMLButtonElement).disabled = myLabels.length === 0;
}

$("btn-export-labels").addEventListener("click", () => {
  download(exportLabels(myLabels), "my-labels.json");
  say(`Exported ${myLabels.length} label${myLabels.length === 1 ? "" : "s"}`);
});
const importLabelsFile = $<HTMLInputElement>("import-labels-file");
$("btn-import-labels").addEventListener("click", () => importLabelsFile.click());
importLabelsFile.addEventListener("change", async () => {
  const file = importLabelsFile.files?.[0];
  importLabelsFile.value = "";
  if (!file) return;
  try {
    const builtIn = new Set(COMMON_LABELS.map((x) => x.toLowerCase()));
    const r = mergeLabels(myLabels, parseLabelsFile(await file.text()).filter((n) => !builtIn.has(n.toLowerCase())));
    myLabels = r.labels;
    saveList(MY_LABELS_KEY, myLabels);
    openGroups.add("My labels");
    drawLabelGroups();
    say(r.added ? `Added ${r.added} label${r.added === 1 ? "" : "s"} to My labels` : "No new labels in that file");
  } catch (err) {
    say(err instanceof Error ? err.message : "Couldn't read that file");
  }
});

// Close the settings menu when clicking elsewhere.
document.addEventListener("pointerdown", (e) => {
  const st = $<HTMLDetailsElement>("settings");
  if (st.open && !st.contains(e.target as Node)) st.open = false;
});

function forgetLabel(name: string) {
  myLabels = myLabels.filter((t) => t !== name);
  saveList(MY_LABELS_KEY, myLabels);
  drawLabelGroups();
  say(`Removed "${name}" from My labels`);
}

function selectText(id: string | null) {
  selectedText = id;
  drawLabels();
  drawCanvas();
}

function drawLabels() {
  const texts = store.state.sketch.texts ?? [];
  if (selectedText && !texts.some((t) => t.id === selectedText)) selectedText = null;
  const t = texts.find((x) => x.id === selectedText);
  $("label-edit").classList.toggle("hidden", !t);
  if (t) sync(labelText, t.text);
}

/** Put a label on the sketch: in the selected area if it has walls, else the middle of the view. */
function addText(text: string) {
  const name = text.trim();
  if (!name) return;
  const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === store.state.selection?.area);
  const { width, height } = size();
  const base = ar && flatten(ar.shape.path).length >= 3 ? centroid(flatten(ar.shape.path)) : toWorld(view, { x: width / 2, y: height / 2 });
  // Stagger labels dropped on the same spot so they don't stack.
  const near = (store.state.sketch.texts ?? []).filter((t) => Math.hypot(t.at.x - base.x, t.at.y - base.y - 0) < 20).length;
  const inch = (v: number) => Math.round(v * 12) / 12;
  const at = { x: inch(base.x), y: inch(base.y - 2 - (near % 6) * 1.5) };
  const id = newId("t");
  store.update((draft) => {
    (draft.texts ??= []).push({ id, text: name, at });
  });
  selectText(id);
  canvas.focus();
}

function deleteText() {
  const id = selectedText;
  if (!id) return;
  store.update((draft) => {
    draft.texts = (draft.texts ?? []).filter((t) => t.id !== id);
  });
  selectText(null);
  say("Label deleted (Ctrl+Z to undo)");
}

labelGroups.addEventListener("click", (e) => {
  const forget = (e.target as Element).closest("[data-forget]");
  if (forget) {
    forgetLabel(forget.getAttribute("data-forget")!);
    return;
  }
  const b = (e.target as Element).closest("[data-label-text]");
  if (b) addText(b.getAttribute("data-label-text")!);
});
$("btn-save-label").addEventListener("click", () => {
  keepLabel(labelCustom.value);
  addText(labelCustom.value);
  labelCustom.value = "";
});
$("btn-keep-label").addEventListener("click", () => {
  const t = (store.state.sketch.texts ?? []).find((x) => x.id === selectedText);
  if (t) keepLabel(t.text);
});
$("btn-add-label").addEventListener("click", () => {
  addText(labelCustom.value);
  labelCustom.value = "";
});
labelCustom.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addText(labelCustom.value);
    labelCustom.value = "";
  }
});
labelText.addEventListener("input", () => {
  const id = selectedText;
  if (!id) return;
  store.update(
    (draft) => {
      const t = (draft.texts ?? []).find((x) => x.id === id);
      if (t) t.text = labelText.value;
    },
    { coalesce: `text-edit-${id}` },
  );
});
$("btn-delete-label").addEventListener("click", deleteText);

// ---------- print and PNG ----------

function printSketch() {
  $("print-root").innerHTML = printPageHtml(result);
  const img = $("print-root").querySelector("img");
  const go = () => window.print();
  if (img && !img.complete) img.addEventListener("load", go, { once: true });
  else go();
}
$("btn-print").addEventListener("click", printSketch);

function exportName(ext: string): string {
  const m = store.state.sketch.meta;
  const base = (files.name?.replace(/\.sketch\.json$|\.json$/i, "") || m.fileNumber || m.subject || "sketch").replace(/[^\w .-]+/g, "_").trim();
  return `${base || "sketch"}.${ext}`;
}

$("btn-png").addEventListener("click", async () => {
  try {
    const blob = await sketchPng(result);
    download(blob, exportName("png"));
    say("PNG downloaded");
  } catch {
    say("Could not make the PNG");
  }
});

// ---------- area table ----------

const table = $<HTMLDivElement>("table");

function drawTable() {
  const blocks: string[] = [];
  if (result.nonAnsi) {
    blocks.push(`<div class="nonansi">${result.sketch.meta.ansi ? "Contains non-ANSI overrides" : "ANSI rules off"}</div>`);
  }
  for (const s of result.structures) {
    if (s.areas.length === 0) continue;
    const rows: string[] = [];
    for (const b of BUCKETS) {
      if (b === "excluded" || s.reported[b] === 0) continue;
      rows.push(`<tr class="${b === "gla" ? "gla" : ""}"><td>${esc(BUCKET_LABELS[b])}</td><td class="num">${s.reported[b].toLocaleString("en-US")} sf</td></tr>`);
      if (b === "gla" || b === "finishedBelow" || b === "unfinishedBelow") {
        for (const l of s.levels) {
          const above = l.grade === "above";
          const v = b === "unfinishedBelow" ? l.unfinished : l.finished;
          if ((b === "gla") !== above || Math.round(v) === 0) continue;
          rows.push(`<tr class="sub"><td>${esc(levelName(l.level))}</td><td class="num">${Math.round(v).toLocaleString("en-US")} sf</td></tr>`);
        }
      }
    }
    if (rows.length === 0) rows.push(`<tr><td class="note" colspan="2">No areas yet</td></tr>`);
    const problems = s.areas.flatMap((a) => a.problems.map((p) => `${a.area.name}: ${p}`));
    blocks.push(
      `<table><tr><th colspan="2">${esc(s.structure.name)}</th></tr>${rows.join("")}</table>` +
        (s.overrides.length ? `<div class="note">Overrides: ${s.overrides.map((o) => esc(`${o.area} — ${o.note || "(no reason)"}`)).join("; ")}</div>` : "") +
        (problems.length ? `<ul class="problems">${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""),
    );
  }
  blocks.push(`<div class="note">Totals are rounded to whole square feet after adding (ANSI Z765).</div>`);
  table.innerHTML = blocks.join("");
}

// ---------- toolbar ----------

const toast = $<HTMLDivElement>("toast");
let toastTimer = 0;
function say(msg: string) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function drawToolbar() {
  $<HTMLButtonElement>("btn-undo").disabled = !store.canUndo;
  $<HTMLButtonElement>("btn-redo").disabled = !store.canRedo;
  syncCheck($<HTMLInputElement>("show-dims"), store.state.sketch.meta.showDims !== false);
  syncCheck($<HTMLInputElement>("show-labels"), store.state.sketch.meta.showLabels !== false);
  const ansi = $<HTMLInputElement>("ansi-mode");
  if (ansi.checked !== store.state.sketch.meta.ansi) ansi.checked = store.state.sketch.meta.ansi;
  const dirty = store.revision !== savedRevision;
  $("file-status").textContent = `${files.name ?? "Unsaved sketch"}${dirty ? " •" : ""}`;
  document.title = `${dirty ? "• " : ""}${files.name ?? "Sketch"}`;
}

function nextFreeOrigin(): Point {
  const b = sketchBounds();
  return b ? { x: Math.ceil(b.maxX) + 6, y: Math.floor(b.minY) } : { x: 0, y: 0 };
}

$("btn-add-area").addEventListener("click", () => {
  const sel = store.state.selection;
  const origin = nextFreeOrigin();
  store.update((draft) => {
    const s = draft.structures.find((x) => x.id === sel?.structure) ?? draft.structures[0];
    if (!s) return null;
    const a = newArea({ origin });
    s.areas.push(a);
    return { structure: s.id, area: a.id };
  });
  vectors.focus();
});

$("btn-add-structure").addEventListener("click", () => {
  const origin = nextFreeOrigin();
  store.update((draft) => {
    const a = newArea({ name: "First floor", origin });
    const s = newStructure({ name: `Structure ${draft.structures.length + 1}`, kind: "outbuilding", areas: [a] });
    draft.structures.push(s);
    return { structure: s.id, area: a.id };
  });
  sprops.name.focus();
  sprops.name.select();
});

$("btn-delete-area").addEventListener("click", () => {
  const sel = store.state.selection;
  if (!sel) return;
  store.update((draft) => {
    const s = draft.structures.find((x) => x.id === sel.structure);
    if (!s) return null;
    const i = s.areas.findIndex((a) => a.id === sel.area);
    s.areas.splice(i, 1);
    const next = s.areas[Math.min(i, s.areas.length - 1)];
    return next ? { structure: s.id, area: next.id } : null;
  });
  say("Area deleted (Ctrl+Z to undo)");
});

$("btn-delete-structure").addEventListener("click", () => {
  const sel = store.state.selection;
  if (!sel) return;
  store.update((draft) => {
    draft.structures = draft.structures.filter((s) => s.id !== sel.structure);
    const s = draft.structures[0];
    const a = s?.areas[0];
    return s && a ? { structure: s.id, area: a.id } : null;
  });
  say("Structure deleted (Ctrl+Z to undo)");
});

$<HTMLInputElement>("show-dims").addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  store.update((draft) => {
    if (on) delete draft.meta.showDims;
    else draft.meta.showDims = false;
  });
});
$<HTMLInputElement>("show-labels").addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  store.update((draft) => {
    if (on) delete draft.meta.showLabels;
    else draft.meta.showLabels = false;
  });
});

$<HTMLInputElement>("ansi-mode").addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  store.update((draft) => {
    draft.meta.ansi = on;
  });
});

function confirmDiscard(): boolean {
  // An in-page check, not a browser dialog: a second click within 4 s confirms.
  if (store.revision === savedRevision) return true;
  const now = Date.now();
  if (now - lastDiscardWarn < 4000) return true;
  lastDiscardWarn = now;
  say("Unsaved changes — click again to discard them");
  return false;
}
let lastDiscardWarn = 0;

function loadSketch(sk: ReturnType<typeof newSketch>) {
  external = true;
  store.load(sk);
  savedRevision = store.revision;
  fit();
}

$("btn-new").addEventListener("click", () => {
  if (!confirmDiscard()) return;
  files.reset();
  loadSketch(newSketch());
  vectors.focus();
});

async function doOpen() {
  if (!confirmDiscard()) return;
  try {
    const sk = await files.open();
    if (sk) {
      loadSketch(sk);
      say(`Opened ${files.name}`);
    }
  } catch (e) {
    say(e instanceof SketchFileError ? e.message : "Could not open the file");
  }
}

async function doSave(saveAs: boolean) {
  try {
    if (await files.save(store.state.sketch, saveAs)) {
      savedRevision = store.revision;
      drawToolbar();
      say(`Saved ${files.name}`);
    }
  } catch {
    say("Could not save the file");
  }
}

$("btn-open").addEventListener("click", () => void doOpen());
$("btn-save").addEventListener("click", () => void doSave(false));
$("btn-save-as").addEventListener("click", () => void doSave(true));
$("btn-undo").addEventListener("click", () => undo());
$("btn-redo").addEventListener("click", () => redo());
$("btn-fit").addEventListener("click", () => {
  setAutoFit(true);
  fit();
});

$("btn-copy").addEventListener("click", async () => {
  const text = totalsText(result);
  try {
    await navigator.clipboard.writeText(text);
    say("Totals copied");
  } catch {
    say("Clipboard not available");
  }
});

function undo() {
  external = true;
  store.undo();
}
function redo() {
  external = true;
  store.redo();
}

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (mod && (k === "y" || (k === "z" && e.shiftKey))) {
    e.preventDefault();
    redo();
  } else if (mod && k === "s") {
    e.preventDefault();
    void doSave(e.shiftKey);
  } else if (mod && k === "p") {
    e.preventDefault();
    printSketch();
  } else if (mod && k === "o") {
    e.preventDefault();
    void doOpen();
  } else if (!mod && k === "f" && document.activeElement === canvas) {
    setAutoFit(true);
    fit();
  } else if (!mod && !e.altKey && k === "t" && document.activeElement === canvas && store.state.selection?.stair) {
    rotateStair();
  } else if (!mod && !e.altKey && !e.shiftKey && document.activeElement === canvas && e.key in ARROWS) {
    if (arrowIntoWalls(e.key, true)) {
      e.preventDefault();
      vectors.focus();
    }
  } else if (!mod && document.activeElement === canvas && selectedText && (e.key === "Delete" || e.key === "Backspace")) {
    e.preventDefault();
    deleteText();
  } else if (!mod && !e.altKey && document.activeElement === canvas && e.key === "Backspace") {
    e.preventDefault();
    deleteWallAction();
  } else if (!mod && !e.altKey && document.activeElement === canvas && k === "a" && closeKeyIntoWalls(true)) {
    e.preventDefault();
    vectors.focus();
  } else if (!mod && !e.altKey && e.key.length === 1 && document.activeElement === canvas && k !== "f") {
    // Typing on the drawing goes into the walls box, as in other sketch programs.
    e.preventDefault();
    typeIntoWalls(e.key);
  }
});

// Warn before closing with unsaved changes (not in development, where the
// dev server reloads the page on every code change; the draft covers that).
if (!import.meta.env.DEV) {
  window.addEventListener("beforeunload", (e) => {
    if (store.revision !== savedRevision) e.preventDefault();
  });
}

const gridToggle = $<HTMLInputElement>("show-grid");
gridToggle.checked = showGrid;
autoFitToggle.addEventListener("change", () => {
  setAutoFit(autoFitToggle.checked);
  if (autoFit) fit();
});

gridToggle.addEventListener("change", () => {
  showGrid = gridToggle.checked;
  try {
    localStorage.setItem("sketch:grid", showGrid ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
  drawCanvas();
});

// ---------- theme (a per-viewer preference, kept in this browser only) ----------

const themeSelect = $<HTMLSelectElement>("theme");
themeSelect.value = document.documentElement.dataset.theme ?? "auto";
themeSelect.addEventListener("change", () => {
  const t = themeSelect.value;
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("sketch:theme", t);
  } catch {
    /* storage unavailable; the choice lasts for this visit */
  }
  drawCanvas();
});

// ---------- wiring ----------

let draftTimer = 0;
function redraw() {
  result = computeSketch(store.state.sketch);
  // Keep the whole sketch in view as walls are added (not mid-drag, which would make things jump).
  if (autoFit && !drag) fit();
  else drawCanvas();
  drawTree();
  drawProps();
  drawMeta();
  drawLabels();
  drawStairs();
  drawZones();
  drawVectorBar();
  drawTable();
  drawToolbar();
  external = false;
  clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => saveDraft(store.state.sketch), 400);
}

const SELECTION_KEY = "sketch:selection";
try {
  const saved = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? "null") as Selection | null;
  if (findArea(store.state.sketch, saved)) store.select(saved);
} catch {
  /* no saved selection */
}

store.subscribe(redraw);
// Save the draft at once when the page goes away, so a quick reload or close
// doesn't lose the last change (drafts are otherwise saved 0.4 s after edits).
window.addEventListener("pagehide", () => saveDraft(store.state.sketch));
store.subscribe((st) => {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(st.selection));
  } catch {
    /* storage unavailable */
  }
});
redraw();
requestAnimationFrame(() => fit());

// Exposed for debugging and automated checks.
(window as unknown as { sketchApp: unknown }).sketchApp = { store, get result() { return result; }, printHtml: () => printPageHtml(result) };

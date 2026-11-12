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
} from "../geometry/index.js";
import { levelName, totalsText } from "../export/text.js";
import { FileManager, SketchFileError, loadDraft, saveDraft } from "./files.js";
import { renderSketch, toWorld, type View } from "./render.js";
import { Store, findArea, newArea, newSketch, newStructure, type Selection } from "./store.js";

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

function drawCanvas() {
  const { width, height } = size();
  canvas.innerHTML = renderSketch(result, { width, height, view, selection: store.state.selection });
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
  return b;
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
    drawCanvas();
  },
  { passive: false },
);

type Drag =
  | { kind: "pan"; startX: number; startY: number; ox: number; oy: number }
  | { kind: "move"; sel: Selection; start: Point; origin: Point; key: string; moved: boolean };

let drag: Drag | null = null;
let dragSeq = 0;
const GRID_SNAP = 0.5; // feet
const VERTEX_SNAP_PX = 10;

function otherVertices(sel: Selection): Point[] {
  const pts: Point[] = [];
  for (const s of result.structures) {
    for (const a of s.areas) {
      if (s.structure.id === sel.structure && a.area.id === sel.area) continue;
      pts.push(...flatten(a.shape.path, Math.PI / 8));
    }
  }
  return pts;
}

/** Snap an area move: to another area's corner if one is near, otherwise to the half-foot grid. */
function snapOrigin(sel: Selection, origin: Point, proposed: Point, free: boolean): Point {
  if (free) return proposed;
  const found = findArea(store.state.sketch, sel);
  const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === sel.area);
  if (found && ar) {
    const dx = proposed.x - origin.x;
    const dy = proposed.y - origin.y;
    const mine = ar.shape.path.segments.length ? flatten(ar.shape.path, Math.PI / 8) : [ar.shape.path.start];
    const others = otherVertices(sel);
    let best: { d: number; ox: number; oy: number } | null = null;
    for (const m of mine) {
      const mx = m.x + dx;
      const my = m.y + dy;
      for (const o of others) {
        const d = Math.hypot(o.x - mx, o.y - my) * view.scale;
        if (d < VERTEX_SNAP_PX && (!best || d < best.d)) best = { d, ox: o.x - mx, oy: o.y - my };
      }
    }
    if (best) return { x: proposed.x + best.ox, y: proposed.y + best.oy };
  }
  return { x: Math.round(proposed.x / GRID_SNAP) * GRID_SNAP, y: Math.round(proposed.y / GRID_SNAP) * GRID_SNAP };
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.focus();
  const target = (e.target as Element).closest("[data-area]");
  const r = canvas.getBoundingClientRect();
  const p = { x: e.clientX - r.left, y: e.clientY - r.top };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic or already-released pointer */
  }
  if (target && e.button === 0) {
    const sel = { structure: target.getAttribute("data-structure")!, area: target.getAttribute("data-area")! };
    store.select(sel);
    const found = findArea(store.state.sketch, sel);
    if (found) {
      dragSeq += 1;
      drag = { kind: "move", sel, start: toWorld(view, p), origin: { ...found.area.origin }, key: `move:${sel.area}:${dragSeq}`, moved: false };
    }
  } else {
    drag = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: view.ox, oy: view.oy };
    canvas.classList.add("panning");
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (drag.kind === "pan") {
    view = { ...view, ox: drag.ox + e.clientX - drag.startX, oy: drag.oy + e.clientY - drag.startY };
    drawCanvas();
    return;
  }
  const r = canvas.getBoundingClientRect();
  const w = toWorld(view, { x: e.clientX - r.left, y: e.clientY - r.top });
  const d = drag;
  const proposed = { x: d.origin.x + w.x - d.start.x, y: d.origin.y + w.y - d.start.y };
  const next = snapOrigin(d.sel, d.origin, proposed, e.altKey);
  const cur = findArea(store.state.sketch, d.sel)?.area.origin;
  if (cur && (cur.x !== next.x || cur.y !== next.y)) {
    d.moved = true;
    store.update(
      (draft) => {
        const f = findArea(draft, d.sel);
        if (f) f.area.origin = next;
      },
      { coalesce: d.key },
    );
  }
});

function endDrag() {
  drag = null;
  canvas.classList.remove("panning");
  store.breakCoalesce();
}
canvas.addEventListener("pointerup", endDrag);
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
          return `<li class="area-item${selected}" data-structure="${s.structure.id}" data-area="${a.area.id}"><span>${esc(a.area.name)}${warn}</span><span class="sf">${formatSqFt(a.shape.area, 0)}</span></li>`;
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

// ---------- vector bar ----------

const vectors = $<HTMLTextAreaElement>("vectors");
const vstatus = $<HTMLDivElement>("vector-status");

vectors.addEventListener("input", () => editArea((a) => (a.vectors = vectors.value), "vectors"));

function drawVectorBar() {
  const sel = store.state.selection;
  const found = findArea(store.state.sketch, sel);
  vectors.disabled = !found;
  if (!found) {
    vectors.value = "";
    vstatus.textContent = "Select or add an area.";
    return;
  }
  sync(vectors, found.area.vectors);
  const r = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === found.area.id);
  if (!r) return;
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
  const problems = r.problems.filter((p) => !p.startsWith("outline does not close"));
  vstatus.innerHTML =
    parts.join(" · ") + (problems.length ? `<ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "");
}

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
$("btn-fit").addEventListener("click", () => fit());

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
  } else if (mod && k === "o") {
    e.preventDefault();
    void doOpen();
  } else if (!mod && k === "f" && document.activeElement === canvas) {
    fit();
  }
});

window.addEventListener("beforeunload", (e) => {
  if (store.revision !== savedRevision) e.preventDefault();
});

// ---------- wiring ----------

let draftTimer = 0;
function redraw() {
  result = computeSketch(store.state.sketch);
  drawCanvas();
  drawTree();
  drawProps();
  drawVectorBar();
  drawTable();
  drawToolbar();
  external = false;
  clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => saveDraft(store.state.sketch), 400);
}

store.subscribe(redraw);
redraw();
requestAnimationFrame(() => fit());

// Exposed for debugging and automated checks.
(window as unknown as { sketchApp: unknown }).sketchApp = { store, get result() { return result; } };

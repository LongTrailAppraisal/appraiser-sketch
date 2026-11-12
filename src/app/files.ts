/**
 * Open/save .sketch.json files. Uses the File System Access API where the
 * browser has it (Chrome, Edge) so Save writes back to the same file, and
 * falls back to download/upload elsewhere. Also keeps a crash-recovery draft
 * in localStorage (best effort; may be unavailable).
 */

import { FORMAT_VERSION, type Area, type Sketch, type Structure } from "../geometry/index.js";
import { newArea, newId } from "./store.js";

const DRAFT_KEY = "sketch:draft";

interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
}

type PickerWindow = Window & {
  showOpenFilePicker?: (opts: unknown) => Promise<FileHandle[]>;
  showSaveFilePicker?: (opts: unknown) => Promise<FileHandle>;
};

const PICKER_TYPES = [{ description: "Sketch", accept: { "application/json": [".sketch.json", ".json"] } }];

export class SketchFileError extends Error {}

/** Parse and normalize a sketch file; throws SketchFileError with a readable message. */
export function parseSketchFile(text: string): Sketch {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SketchFileError("This file is not a sketch (not valid JSON).");
  }
  const o = raw as Partial<Sketch>;
  if (typeof o !== "object" || o === null || !Array.isArray(o.structures)) {
    throw new SketchFileError("This file is not a sketch (no structures).");
  }
  if (typeof o.formatVersion !== "number" || o.formatVersion > FORMAT_VERSION) {
    throw new SketchFileError(`This sketch was saved by a newer version (format ${String(o.formatVersion)}).`);
  }
  const structures: Structure[] = o.structures.map((s: Partial<Structure>) => ({
    id: typeof s.id === "string" ? s.id : newId("s"),
    name: typeof s.name === "string" ? s.name : "Structure",
    kind: s.kind ?? "dwelling",
    areas: Array.isArray(s.areas) ? s.areas.map((a: Partial<Area>) => newArea({ ...a, id: a.id ?? newId("a") })) : [],
  }));
  return { formatVersion: FORMAT_VERSION, meta: { ansi: true, ...(o.meta ?? {}) }, structures };
}

export function serialize(sketch: Sketch): string {
  return JSON.stringify(sketch, null, 2) + "\n";
}

function suggestedName(sketch: Sketch): string {
  const base = sketch.meta.fileNumber || sketch.meta.subject || "sketch";
  return `${base.replace(/[^\w .-]+/g, "_").trim() || "sketch"}.sketch.json`;
}

export class FileManager {
  private handle: FileHandle | null = null;
  name: string | null = null;

  get hasPicker(): boolean {
    return typeof (window as PickerWindow).showSaveFilePicker === "function";
  }

  /** Ask for a file and return its sketch, or null if the user cancelled. */
  async open(): Promise<Sketch | null> {
    const w = window as PickerWindow;
    if (w.showOpenFilePicker) {
      try {
        const [h] = await w.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
        if (!h) return null;
        const sketch = parseSketchFile(await (await h.getFile()).text());
        this.handle = h;
        this.name = h.name;
        return sketch;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return null;
        throw e;
      }
    }
    const file = await pickFileFallback();
    if (!file) return null;
    const sketch = parseSketchFile(await file.text());
    this.handle = null;
    this.name = file.name;
    return sketch;
  }

  /** Save to the current file, or ask where (Save As) if there is none. Returns false if cancelled. */
  async save(sketch: Sketch, saveAs = false): Promise<boolean> {
    const w = window as PickerWindow;
    const data = serialize(sketch);
    if (w.showSaveFilePicker) {
      try {
        if (!this.handle || saveAs) {
          this.handle = await w.showSaveFilePicker({ types: PICKER_TYPES, suggestedName: this.name ?? suggestedName(sketch) });
        }
        const out = await this.handle.createWritable();
        await out.write(data);
        await out.close();
        this.name = this.handle.name;
        return true;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return false;
        throw e;
      }
    }
    download(data, this.name ?? suggestedName(sketch));
    this.name ??= suggestedName(sketch);
    return true;
  }

  reset(): void {
    this.handle = null;
    this.name = null;
  }
}

function pickFileFallback(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

export function download(data: string | Blob, name: string, type = "application/json"): void {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveDraft(sketch: Sketch): void {
  try {
    localStorage.setItem(DRAFT_KEY, serialize(sketch));
  } catch {
    /* storage unavailable; drafts are best effort */
  }
}

export function loadDraft(): Sketch | null {
  try {
    const text = localStorage.getItem(DRAFT_KEY);
    return text ? parseSketchFile(text) : null;
  } catch {
    return null;
  }
}

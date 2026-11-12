/** My labels file format: export, import and merge. */

export const LABELS_FILE_TYPE = "sketch-labels";

export function exportLabels(labels: string[]): string {
  return JSON.stringify({ type: LABELS_FILE_TYPE, version: 1, labels }, null, 2) + "\n";
}

/**
 * Read a labels file: one exported from here, a plain JSON list of names, or a
 * text file with one name per line. Throws with a readable message otherwise.
 */
export function parseLabelsFile(text: string): string[] {
  const t = text.trim();
  if (t === "") return [];
  let names: unknown;
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const v = JSON.parse(t) as unknown;
      names = Array.isArray(v) ? v : (v as { labels?: unknown }).labels;
    } catch {
      throw new Error("This file isn't a labels file (not valid JSON).");
    }
    if (!Array.isArray(names)) throw new Error("This file has no list of labels.");
  } else {
    names = t.split(/\r?\n/);
  }
  return (names as unknown[])
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().slice(0, 60))
    .filter((x) => x !== "");
}

/** Add new names to a list, ignoring case-insensitive duplicates; sorted. */
export function mergeLabels(have: string[], add: string[]): { labels: string[]; added: number } {
  const seen = new Set(have.map((x) => x.toLowerCase()));
  const out = [...have];
  for (const n of add) {
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return { labels: out.sort((a, b) => a.localeCompare(b)), added: out.length - have.length };
}

/**
 * ANSI Z765 classification of one area into report buckets (docs/SPEC.md §7).
 * Works on square-foot figures only; geometry is computed in model.ts.
 */

export type CeilingBand = "full" | "reduced" | "low"; // ≥7', 5'–7', <5'

export type AreaKind = "living" | "garage" | "porch" | "deck" | "patio" | "carport" | "breezeway" | "other";

export type Grade = "above" | "below";

export type Bucket =
  | "gla"
  | "finishedNotConnected"
  | "unfinishedAbove"
  | "finishedBelow"
  | "unfinishedBelow"
  | "garage"
  | "porch"
  | "deck"
  | "patio"
  | "carport"
  | "breezeway"
  | "other"
  | "excluded";

export const BUCKETS: readonly Bucket[] = [
  "gla",
  "finishedNotConnected",
  "unfinishedAbove",
  "finishedBelow",
  "unfinishedBelow",
  "garage",
  "porch",
  "deck",
  "patio",
  "carport",
  "breezeway",
  "other",
  "excluded",
];

export const BUCKET_LABELS: Record<Bucket, string> = {
  gla: "Finished above grade (GLA)",
  finishedNotConnected: "Finished above grade, not connected",
  unfinishedAbove: "Unfinished above grade",
  finishedBelow: "Finished below grade",
  unfinishedBelow: "Unfinished below grade",
  garage: "Garage",
  porch: "Porch",
  deck: "Deck",
  patio: "Patio",
  carport: "Carport",
  breezeway: "Breezeway",
  other: "Other",
  excluded: "Excluded",
};

export interface ZoneArea {
  band: CeilingBand | "opening";
  area: number;
}

export interface Override {
  /** Bucket the appraiser puts this area in, instead of the ANSI result. */
  bucket: Bucket;
  /** Required explanation; carried into the report. */
  note: string;
}

export interface AnsiInput {
  kind: AreaKind;
  grade: Grade;
  finished: boolean;
  /** Reachable through finished space (hall or stair). */
  connected: boolean;
  /** Ceiling band for the part of the area not covered by zones. */
  ceiling: CeilingBand;
  grossArea: number;
  zones: ZoneArea[];
  override?: Override | undefined;
}

export interface AnsiResult {
  bucket: Bucket;
  /** Square feet that go into `bucket`. */
  counted: number;
  gross: number;
  full: number;
  reduced: number;
  low: number;
  opening: number;
  /** Gross area not counted in any bucket (openings, ceilings under 5'). */
  notCounted: number;
  /** True when an override replaced the ANSI result. */
  nonAnsi: boolean;
  warnings: string[];
}

const TOL = 0.05; // sq ft

export interface ClassifyOptions {
  /** Apply ANSI ceiling rules (default true). Off for private, non-ANSI work. */
  ansi?: boolean;
}

export function classify(input: AnsiInput, opts: ClassifyOptions = {}): AnsiResult {
  const ansi = opts.ansi ?? true;
  const warnings: string[] = [];
  const gross = input.grossArea;

  let zoneTotal = 0;
  const band = { full: 0, reduced: 0, low: 0, opening: 0 };
  for (const z of input.zones) {
    if (z.area < 0) continue;
    band[z.band] += z.area;
    zoneTotal += z.area;
  }
  if (zoneTotal > gross + TOL) {
    warnings.push(
      `zones total ${zoneTotal.toFixed(1)} sf, more than the area's ${gross.toFixed(1)} sf; check the zone outlines`,
    );
  }
  band[input.ceiling] += Math.max(0, gross - zoneTotal);

  const base = {
    gross,
    full: band.full,
    reduced: band.reduced,
    low: band.low,
    opening: band.opening,
  };
  const withoutOpenings = Math.max(0, gross - band.opening);

  const result = (bucket: Bucket, counted: number, nonAnsi = false): AnsiResult => ({
    ...base,
    bucket,
    counted,
    notCounted: Math.max(0, gross - counted),
    nonAnsi,
    warnings,
  });

  if (input.override) {
    if (input.override.note.trim() === "") warnings.push("override has no note; a reason is required");
    return result(input.override.bucket, withoutOpenings, true);
  }

  if (input.kind !== "living") {
    return result(input.kind, gross);
  }

  const above = input.grade === "above";

  if (!input.finished) {
    return result(above ? "unfinishedAbove" : "unfinishedBelow", withoutOpenings);
  }

  const finishedBucket: Bucket = above ? (input.connected ? "gla" : "finishedNotConnected") : "finishedBelow";
  if (!above && !input.connected) {
    warnings.push("below-grade area marked not connected; reported as finished below grade");
  }

  if (!ansi) {
    return result(finishedBucket, withoutOpenings);
  }

  // ANSI: ceilings under 5' never count; at least half of the counted (≥5') area must be ≥7'.
  const countable = band.full + band.reduced;
  if (countable <= TOL) {
    warnings.push("no part of this area has a ceiling of 5' or more; not counted as finished");
    return result("excluded", 0);
  }
  if (band.full + TOL < countable / 2) {
    warnings.push(
      `less than half of the area (${band.full.toFixed(1)} of ${countable.toFixed(1)} sf) has a 7' ceiling; ` +
        "ANSI does not count it as finished",
    );
    return result(above ? "unfinishedAbove" : "unfinishedBelow", countable);
  }
  return result(finishedBucket, countable);
}

export type BucketTotals = Record<Bucket, number>;

export function emptyTotals(): BucketTotals {
  return Object.fromEntries(BUCKETS.map((b) => [b, 0])) as BucketTotals;
}

/** Sum results by bucket, unrounded. */
export function totalByBucket(results: Iterable<AnsiResult>): BucketTotals {
  const t = emptyTotals();
  for (const r of results) t[r.bucket] += r.counted;
  return t;
}

/** Reported totals: whole square feet (ANSI), rounded after summing. */
export function roundTotals(t: BucketTotals): BucketTotals {
  const out = emptyTotals();
  for (const b of BUCKETS) out[b] = Math.round(t[b] + Number.EPSILON);
  return out;
}

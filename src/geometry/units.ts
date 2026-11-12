/**
 * Length parsing and formatting. Internal unit: decimal feet.
 *
 * Accepted input forms:
 *   24        24.5      decimal feet
 *   24'       24'6"     24'6      feet-inches
 *   6"        6-1/2"    inches, with optional fraction
 *   24'6-1/2" 24'6.5"   feet + fractional/decimal inches
 */

const FEET_INCHES = /^(?:(\d+(?:\.\d+)?)')?(?:(\d+(?:\.\d+)?)(?:-(\d+)\/(\d+))?("?))?$/;

/** Parse a length token to decimal feet, or return null if it is not a valid length. */
export function parseLength(raw: string): number | null {
  const text = raw.trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (text === "") return null;

  // Plain decimal feet (no unit marks).
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);

  const m = FEET_INCHES.exec(text);
  if (!m) return null;
  const [, feetStr, inchStr, num, den, inchMark] = m;
  const hasFeetMark = feetStr !== undefined;

  // Without a feet mark, the number must carry an inch mark ("6\"", "6-1/2\"").
  if (!hasFeetMark && inchMark !== '"') return null;
  if (!hasFeetMark && inchStr === undefined) return null;

  let inches = inchStr !== undefined ? Number(inchStr) : 0;
  if (num !== undefined && den !== undefined) {
    const d = Number(den);
    if (d === 0) return null;
    inches += Number(num) / d;
  }
  const feet = hasFeetMark ? Number(feetStr) : 0;
  if (hasFeetMark && inches >= 12) return null; // 24'14" is a typo
  return feet + inches / 12;
}

/**
 * Format decimal feet as feet-inches rounded to the nearest inch (ANSI precision),
 * e.g. 24.5 -> 24'6".
 */
export function formatFeetInches(feet: number): string {
  const sign = feet < 0 ? "-" : "";
  let totalInches = Math.round(Math.abs(feet) * 12);
  const ft = Math.floor(totalInches / 12);
  totalInches -= ft * 12;
  return totalInches === 0 ? `${sign}${ft}'` : `${sign}${ft}'${totalInches}"`;
}

/** Round to a number of decimal places without binary-float artifacts in typical sizes. */
export function roundTo(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Format square feet with thousands separators, e.g. 1248.04 -> "1,248.0". */
export function formatSqFt(sqft: number, places = 1): string {
  return roundTo(sqft, places).toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

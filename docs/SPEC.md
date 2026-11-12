# Sketch — specification

Working name: **sketch** (final name TBD — must be generic and not trademarked).
Status: draft 1, 2026-11-12. Phase 1 geometry module built and tested; first
drawing screen working (see README). Stairs, templates and a theme
selector done. Still to do in phase 1: zones editor (ceiling heights,
openings), per-wall dimension control, workfile folder memory. Print/PDF
page and PNG done.

## 1. Purpose

A free, open-source floor-sketch program for residential appraisers, similar in
scope to Total Sketch: draw the building from field measurements, compute gross
living area (GLA) and other areas under ANSI Z765, and export a sketch exhibit
and area figures to Reggora and other report software.

Goals:

- Fast keyboard entry from field notes, with the mouse for adjustments.
- Correct, auditable area math. Every number in the report can be traced to a
  wall length the appraiser typed.
- Usable for GSE (UAD 3.6) work and private work. ANSI rules are on by default
  and can be overridden with a stated reason.
- Professional enough to share: clean output, documented file format, tests.

Non-goals for now: mobile/tablet (planned later), cloud accounts, photo
integration, cost approach.

## 2. Platform

- Browser app, static files only, no server. Hosted on GitHub Pages; also runs
  from a local copy.
- Sketches are saved as files on the user's computer (`.sketch.json`). Open/Save
  As uses the browser File System Access API where available (Chrome/Edge) with
  a download/upload fallback (Firefox/Safari).
- A remembered default folder per job (workfile folder) where the browser allows
  it (File System Access handles kept in IndexedDB).
- Later: installable offline app (PWA), which also covers tablets.
- TypeScript, SVG rendering, minimal dependencies. License: MIT.

## 3. Phases

| Phase | Scope |
|---|---|
| **1 — Simple sketch (MVP)** | Vector entry, angles, arcs, feet-inches; multiple areas and structures; ANSI GLA with overrides; stairs (straight, L / right-angle, middle landing, U, winder) with direction arrow; area table; undo/redo; templates; print page; PNG/PDF; paste-ready area block; save/open. |
| **2 — Floor plan** | Interior walls, doors, windows, room labels, bed/bath counts; simple/detailed toggle per sketch. |
| **3 — Integration** | Reggora autofill (after a sample Reggora report shows the fields); UAD 3.6 / MISMO XML area data if needed; `appr` reads area totals for the report package. |

## 4. Concepts and data model

```
Sketch
 ├─ meta: subject address, borrower/client, file #, appraiser, date, ansiMode
 └─ structures[]          main dwelling, ADU, detached garage, barn …
     └─ areas[]           1st floor, 2nd floor, basement, garage, porch …
         ├─ origin        start point (feet, sketch coordinates)
         ├─ vectors       the typed vector text — the source of truth
         ├─ kind          living | garage | porch | deck | patio | carport | breezeway | other
         ├─ grade         above | below
         ├─ finished      true / false
         ├─ level         label: "1", "2", "3", "attic", "basement"
         ├─ connected     reachable through finished space (default true)
         ├─ ceiling       default band for the area: full (≥7'), reduced (5'–7'), low (<5')
         ├─ zones[]       sub-areas with another ceiling band, or an opening to below
         └─ override?     { treatAs: gla | not-gla, note }  — non-ANSI, note required
```

The typed vector text is stored, not just the computed points, so an area can
always be re-derived and audited. Computed values are never saved as the
source of truth.

Coordinates: feet, x to the right, y up (north). The renderer flips y.

## 5. Vector entry language

One area is typed as a sequence of moves separated by spaces, commas or new
lines. Case-insensitive.

| Input | Meaning |
|---|---|
| `R24` `L24` `U30` `D30` | Right/left/up/down (also `E W N S`). |
| `R24'6"` `R24'6` `R24.5` `R6"` `R24'6-1/2"` | Lengths: decimal feet, feet-inches, inches, fractional inches. |
| `UR10` `UL10` `DR10` `DL10` | 45° diagonal, 10' measured along the wall (also `NE NW SE SW`). |
| `R10U5` | One diagonal wall with run 10 and rise 5 (two perpendicular directions). |
| `A30:12` | Polar: 12' at 30°, angles counter-clockwise from right (east). |
| `<move>^3` | Make that wall an arc bulging 3' **outward** from the shape (sagitta, the depth of the bay). `^-3` bulges inward. |
| `CL` | Close back to the start point. |

Closing: a shape whose last point lands on its start (within 1/8") is closed. If
it misses, the area is still computed as if closed, and the misclosure (dx, dy,
distance) is shown so the appraiser can find the typo or measurement error —
like a survey traverse.

Errors are reported per token (position and text) without stopping the parse.

## 6. Area math

- Polygon area by the shoelace formula over the wall vertices.
- Arcs add (outward) or subtract (inward) a circular segment:
  central angle θ = 4·atan(2s/c), radius r = (c²/4 + s²)/(2s),
  segment area = r²/2 · (θ − sin θ), arc length = r·θ.
- Perimeter is reported (walls plus arc lengths).
- Self-intersecting outlines are flagged as an error (the area would be wrong).
- Internal values are full precision. Per-area figures show 0.1 sq ft; reported
  totals are rounded to whole square feet (ANSI). Totals are computed from
  unrounded values, so the table can differ from the sum of displayed rows by 1.

## 7. ANSI Z765 rules

Applied when `ansiMode` is on (default). Each rule has a test.

1. **Measured to the exterior.** Vectors are exterior dimensions. (Interior
   measurements + wall thickness is a phase 2 helper.)
2. **Precision.** Lengths to the nearest inch or 0.1 ft; finished totals
   reported to the nearest whole square foot.
3. **Above vs below grade.** If any part of a level is below grade, the whole
   level is below grade. The appraiser sets `grade`; below-grade area never
   counts as GLA.
4. **Ceiling height.** Finished area needs a ceiling of at least 7'. Areas under
   5' are not counted. For sloped ceilings, at least half of the counted area
   (≥5') must have ≥7'; if not, the space is not finished area. Beams, ducts and
   similar obstructions may be lower (6'4") — use an override with a note.
   Applied per area; split rooms into separate areas when a room-by-room test
   matters.
5. **Openings to the floor below** (two-story foyers, open stairwells) are not
   counted. Modelled as `opening` zones.
6. **Garages and unfinished space** are never finished area; reported
   separately.
7. **Non-connected finished area** (e.g. over a garage reached by an outside
   stair) is reported separately, not in GLA.
8. **Stairs** count as area on the floor above (the level they descend from).
   The stairwell on the upper floor is not an opening; only open space with
   no stair (two-story foyer, balcony over a great room) is. A stair drawn on
   the lower floor adds nothing and subtracts nothing.

Override: an area may be put in any bucket with a required note; it then
counts its whole area less openings (ceiling tests skipped). The
summary marks the sketch as non-ANSI and lists every override, so the
appraiser can carry the explanation into the report (Fannie Mae requires one
for non-ANSI GLA; exact comment code to verify).

### Report buckets (per structure)

The living buckets follow the six UAD 3.6 area fields, as found in the user's
own UAD 3.6 MISMO XML (`PROPERTY_UNIT_AREA`):

| Bucket | UAD 3.6 field |
|---|---|
| Standard finished above grade (GLA) | `UnitStandardAboveGradeFinishedAreaMeasure` |
| Non-standard finished above grade | `UnitNonStandardAboveGradeFinishedAreaMeasure` |
| Unfinished above grade | `UnitAboveGradeUnfinishedAreaMeasure` |
| Standard finished below grade | `UnitStandardBelowGradeFinishedAreaMeasure` |
| Non-standard finished below grade | `UnitNonStandardBelowGradeFinishedAreaMeasure` |
| Unfinished below grade | `UnitBelowGradeUnfinishedAreaMeasure` |
| Finished above grade, not connected | (see `NonContinuousFinishedAreaIndicator`) |
| Garage / carport | `CarStorageAreaMeasure` |
| Porch, deck, patio, breezeway, other | amenity areas (`AmenityAreaMeasure`) |

Finished space that fails the ANSI ceiling test goes to **non-standard
finished**, not unfinished (inferred from the field names; confirm in the GSE
spec).

Per level, UAD 3.6 also reports `LEVEL` with `LevelType` (LevelOne, LevelTwo,
BelowGradeOne …), `GradeLevelType` (AboveGrade, FullyBelowGrade …),
`AccessType`, and finished/unfinished area. The model totals finished and
unfinished living area per level for this.

## 8. User interface (phase 1)

```
┌──────────────────────────────────────────────────────────────┐
│ File  Edit  View  Templates  Export          [ANSI ✓]         │
├───────────────┬──────────────────────────────────────────────┤
│ Structures    │                                              │
│ ▾ Main house  │            drawing (SVG, grid, zoom/pan)     │
│   1st floor ● │                                              │
│   2nd floor   │                                              │
│   Basement    │                                              │
│   Garage      │                                              │
│ ▸ ADU         ├──────────────────────────────────────────────┤
│ [+ area]      │ vectors: R24 U30 L24'6" D30 _                │
├───────────────┤ ✓ closed  1,248.0 sf  perim 108'             │
│ Area table    │ area: kind ▾ grade ▾ finished ☐ ceiling ▾    │
└───────────────┴──────────────────────────────────────────────┘
```

- The vector line redraws live as you type; errors underline the bad token.
- Mouse: drag an area to position it, drag labels, select a wall to edit its
  length (rewrites the vector text), snap to other areas' corners.
- Dimension labels on every wall; area label (name + sf) inside each area.
- Undo/redo for every change (command history over the sketch model).
- Templates: rectangle, L, bump-out, 45° bay, bow window, garage, deck —
  prompt for dimensions and write ordinary vector text.
- Stairs: symbols on an area (straight, middle landing, L, winder, U) with
  treads, walking-line arrow and UP/DN; draggable, rotatable. Flagged if drawn
  outside their area; never change area figures.
- Theme: Auto (follows the system), Light or Dark; saved per browser.
- Stair handles: a selected stair shows round handles at the end of each
  flight and on its side; dragging resizes to the nearest inch.
- Labels: area labels drag freely (offset saved in the file, double-click
  resets). Show/hide: dimensions and labels for the whole sketch (saved in
  the file, applies to print) or per area; grid per browser, screen only.
  Per-wall dimension hiding and dragging is still to do.

## 9. Exports (phase 1)

- **Print page / PDF**: letter, header (subject, file #, client, appraiser,
  date), sketch scaled to fit, area table with buckets and totals, override
  notes. PDF via the browser's print-to-PDF first; a direct PDF library only
  if print output is not consistent enough.
- **PNG**: the drawing at a chosen resolution for upload as an exhibit.
- **Paste-ready area block**: plain `.txt` (no markdown) with the totals in
  report order, plus CSV of every area.
- **`.sketch.json`**: the native file, documented in `docs/FILE_FORMAT.md`
  (written with the model in phase 1), versioned with a `formatVersion` field.

## 10. Architecture

```
src/
  geometry/     pure, tested, no DOM
    units.ts    parse/format lengths
    vectors.ts  vector language → path
    path.ts     area, perimeter, arcs, closure, self-intersection, bounds
    ansi.ts     ANSI classification and report buckets
    model.ts    sketch/structure/area types; compute an area from its vectors
  app/          UI (later): state + undo history, SVG renderer, panels
  export/       print page, PNG, text/CSV, JSON
```

The geometry module has no UI dependencies so it can be reused (by `appr`, a
CLI, or a future mobile app) and tested on its own. Tests: Vitest, including
hand-calculated houses and the user's past sketches with known areas.

## 11. Open questions

1. UAD 3.6: exactly when a floor plan (interior walls) is required vs a sketch,
   and the definition of "non-standard" finished area. The six field names
   are known (§7). Check Fannie Mae / Freddie Mac documents directly.
2. Fannie Mae non-ANSI comment requirement (exact wording/code).
3. Reggora: any import route for sketch images or area data (user asking
   Reggora support); a sample finished report for field names.
4. Final project name and license confirmation.
5. Test houses: three past jobs (A, B, C) are in `test/real-houses.test.ts` (dimensions
   only; sources in gitignored `test/fixtures/private/`).

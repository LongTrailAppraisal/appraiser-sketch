# sketch

Open-source floor sketch and ANSI Z765 area calculator for residential
appraisers. Browser app, local files, no server. Working name.

Status: the geometry module (vector entry, area math, ANSI rules) is built and
tested, and the first drawing screen works: live drawing as you type, dimension
labels, multiple areas and structures, drag with corner snapping, undo/redo,
area table and copy totals (grouped the same way as the print), open/save `.sketch.json`, draft recovery, stairs
(straight, landing, L, winder, U), templates (rectangle, L, bump-out, 45° bay,
bow window, garage, deck), an Auto/Light/Dark theme, ceiling zones and openings (strips along a wall for
knee walls, or any outline; ANSI counts them), and a print page (areas grouped: finished above grade from the first floor up,
unfinished above, finished below, unfinished below, garages, amenities) (Print / PDF button or Ctrl+P:
report header, the sketch fitted to the page, area table with totals) plus PNG
download. See `docs/SPEC.md`.

## Vector entry

```
R40 U24 L16 U12 L24 D36      L-shaped 1st floor, 1,248 sf
R24'6" U30 L24'6" D30        feet-inches
R4 DR2.83 R4 UR2.83 R4 …     45° bay (length along the wall)
R10U5                        one diagonal wall: run 10, rise 5
A30:12                       12' at 30°
R20^3                        arc bulging 3' outward
CL                           close to the start
```

Stairs (straight, L, landing, U, winder) are drawn as symbols in phase 1 and
count as area on the floor above, per ANSI Z765.

## Development

```
npm install
npm run dev       # opens http://localhost:5179 (fixed port: drafts and My labels are kept per address)
npm test          # Vitest
npm run typecheck
npm run build     # static site in dist/
```

Publishing: `.github/workflows/pages.yml` runs the tests on every push to
`main` and, once the repository is public, builds and publishes the site to
GitHub Pages (Settings › Pages › Source: GitHub Actions). The site keeps its
data in each visitor's browser; nothing is sent anywhere.

Layout: `src/geometry/` is pure TypeScript with no DOM (units, vectors, path,
ansi, model); `src/app/` is the screen (store with undo, SVG renderer, files,
main); `src/export/` holds the paste-ready text; tests in `test/`.

On the canvas: drag an area to move it (snaps to other areas' corners, or to
the grid set in ⚙ Settings; hold Alt for free movement), drag empty space to pan, wheel to zoom,
F to fit. Click a stair to select it, then drag it or its round handles
(flight lengths, width); T rotates it. Typing while the drawing has focus goes
straight into the walls box. A length then an arrow key makes a wall (`30` ↑ →
`U30`); arrows along that wall then lengthen or shorten it one step (1", or
0.1' in decimal feet; Shift: 1') until Enter moves on to the next wall.
⚙ Settings › Mouse snaps to sets the grid for dragging (1" or 0.1' by
default, 6", 1', or off). ⚙ Settings › Lengths switches between feet-inches and decimal feet for
dimensions, messages, the print and new walls. `A` (or `CL`) closes the outline. With an area selected, drag a **wall** to slide it in or
out (it stays square, in whole inches) or drag a **corner** to move it (it
snaps to other corners and lines up with its neighbours; hold Alt for free
movement). A clicked corner moves 1" per arrow key (Shift: 1'); the walls text is rewritten to match. The inside angle shows at each corner of
the selected area (square corners in grey; turn off with Show › Angles). Click a corner and choose
**Delete wall** to remove the wall leaving it and redraw from that corner;
Backspace on the drawing, or Delete last wall, steps back one wall at a time.
**Labels** (right side): click a name from Rooms, Garages & outbuildings or
Decks, porches & patios, or type a custom one (and save it to My labels, kept
in this browser; export or import the list from the ⚙ settings menu, which also
holds the theme), and it is placed in the selected area; drag it into place,
edit it, or press Delete to remove it. **+ Area** offers presets: next living floor, basement (below grade,
unfinished, blank; **Copy walls from** on the Area panel starts any empty area
from another area's outline), finished basement,
finished attic, garage, carport, porch, deck, patio, breezeway. **Copy as** on the Area panel copies
the outline (with its stairs and ceiling zones) as a new area, either exactly or
as one of the presets (basement, next floor, garage…). **Copy to** on the Stairs
panel copies a set-up stair to another floor at the same place relative to
that floor's start point, with the arrow pointing down from above or up from
below, or beside itself on the same floor. A structure is named after its type (Dwelling,
ADU, Detached garage, Barn, Shed, Outbuilding; numbered if repeated) and the
name follows the type until you type your own. Moving an
area moves its stairs, ceiling zones and the labels inside it. The sidebar shows Stairs and Ceilings & openings only for areas that have
them (add them from the Area panel), and every panel collapses by clicking
its heading; the browser remembers which are collapsed. Click a wall dimension or an area label on the drawing and press Delete to
hide just that one (double-click hides a dimension at once); the Area panel
brings them back. **C** on the drawing toggles Auto fit. **Auto fit** (toolbar) keeps the whole sketch centred and in view as you draw;
zooming or panning by hand turns it off, and F or Fit turns it back on. on an area with no walls yet, clicking the drawing
moves its start point there. Drag an area's label to move it,
double-click to put it back. The toolbar's Show switches hide dimensions,
labels or the grid; each area can also hide its own label or dimensions. Ctrl+Z / Ctrl+Y undo and redo, Ctrl+S save, Ctrl+O open.

License: MIT (see LICENSE).

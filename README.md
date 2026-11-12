# sketch

Open-source floor sketch and ANSI Z765 area calculator for residential
appraisers. Browser app, local files, no server. Working name.

Status: the geometry module (vector entry, area math, ANSI rules) is built and
tested, and the first drawing screen works: live drawing as you type, dimension
labels, multiple areas and structures, drag with corner snapping, undo/redo,
area table, copy totals, open/save `.sketch.json`, draft recovery, stairs
(straight, landing, L, winder, U), templates (rectangle, L, bump-out, 45° bay,
bow window, garage, deck), an Auto/Light/Dark theme, ceiling zones and openings (strips along a wall for
knee walls, or any outline; ANSI counts them), and a print page (Print / PDF button or Ctrl+P:
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
npm run dev       # open http://localhost:5173
npm test          # Vitest
npm run typecheck
npm run build     # static site in dist/
```

Layout: `src/geometry/` is pure TypeScript with no DOM (units, vectors, path,
ansi, model); `src/app/` is the screen (store with undo, SVG renderer, files,
main); `src/export/` holds the paste-ready text; tests in `test/`.

On the canvas: drag an area to move it (snaps to other areas' corners, or to
6" grid; hold Alt for free movement), drag empty space to pan, wheel to zoom,
F to fit. Click a stair to select it, then drag it or its round handles
(flight lengths, width); T rotates it. Typing while the drawing has focus goes
straight into the walls box. A length then an arrow key makes a wall (`30` ↑ →
`U30`). `A` (or `CL`) closes the outline. Click a corner of a closed area and choose
**Delete wall** to remove the wall leaving it and redraw from that corner;
Backspace on the drawing, or Delete last wall, steps back one wall at a time.
The sidebar shows Stairs and Ceilings & openings only for areas that have
them (add them from the Area panel), and every panel collapses by clicking
its heading; the browser remembers which are collapsed. **Auto fit** (toolbar) keeps the whole sketch centred and in view as you draw;
zooming or panning by hand turns it off, and F or Fit turns it back on. on an area with no walls yet, clicking the drawing
moves its start point there. Drag an area's label to move it,
double-click to put it back. The toolbar's Show switches hide dimensions,
labels or the grid; each area can also hide its own label or dimensions. Ctrl+Z / Ctrl+Y undo and redo, Ctrl+S save, Ctrl+O open.

License: MIT (see LICENSE).

# sketch

Open-source floor sketch and ANSI Z765 area calculator for residential
appraisers. Browser app, local files, no server. Working name.

Status: the geometry module (vector entry, area math, ANSI rules) is built and
tested, and the first drawing screen works: live drawing as you type, dimension
labels, multiple areas and structures, drag with corner snapping, undo/redo,
area table, copy totals, open/save `.sketch.json`, draft recovery, stairs
(straight, landing, L, winder, U), templates (rectangle, L, bump-out, 45° bay,
bow window, garage, deck), and an Auto/Light/Dark theme. Print/PDF and PNG
are next. See `docs/SPEC.md`.

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
(flight lengths, width); R rotates it. Drag an area's label to move it,
double-click to put it back. The toolbar's Show switches hide dimensions,
labels or the grid; each area can also hide its own label or dimensions. Ctrl+Z / Ctrl+Y undo and redo, Ctrl+S save, Ctrl+O open.

License: MIT (see LICENSE).

# sketch

Open-source floor sketch and ANSI Z765 area calculator for residential
appraisers. Browser app, local files, no server. Working name.

Status: the geometry module (vector entry, area math, ANSI rules) is built and
tested. The drawing UI and exports are next. See `docs/SPEC.md`.

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
npm test          # Vitest
npm run typecheck
```

Layout: `src/geometry/` is pure TypeScript with no DOM (units, vectors, path,
ansi, model); tests in `test/`.

License: MIT (see LICENSE).

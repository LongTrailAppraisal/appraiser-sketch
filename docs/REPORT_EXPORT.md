# Report export (`.areas.json`)

**For report** in the toolbar saves one JSON file that a report program can read
without redoing the sketch geometry. The Save dialog opens in the folder of the
saved sketch where the browser allows it, so the file lands next to
`<name>.sketch.json` in the workfile. Its default name is `<name>.areas.json`.

The totals are the same ones the area table and **Copy totals** show.

```jsonc
{
  "formatVersion": 1,
  "generator": "Appraiser Sketch",
  "ansi": true,                       // ANSI Z765 rules on
  "standard": "ANSI Z765-2021",       // null when ANSI rules are off
  "meta": { "subject": "…", "fileNumber": "…", "date": "…" },
  "gla": 1650,                        // GLA summed over "dwelling" structures
  "structures": [
    {
      "name": "Main house",
      "kind": "dwelling",             // dwelling | adu | garage | barn | shed | outbuilding
      "kindLabel": "Dwelling",
      "buckets": { "gla": 1650, "unfinishedBelow": 1050, "garage": 576 },
      "totals": [
        { "label": "Standard finished above grade (GLA)", "area": 1650, "group": "Finished above grade", "bucket": "gla" },
        { "label": "Level 1", "area": 1050, "group": "Finished above grade", "level": "1" },
        { "label": "Level 2", "area": 600, "group": "Finished above grade", "level": "2" }
      ]
    }
  ],
  "overrides": [ { "structure": "Main house", "area": "Attic room", "note": "…" } ],
  "svg": "<svg …>…</svg>"             // the drawing, standalone, white background
}
```

- `totals` is in report order. A row with `bucket` is a total; rows with `level`
  that follow it break down the same group by floor.
- `buckets` holds the non-zero totals keyed by bucket name (see
  `src/geometry/ansi.ts`), for programs that want specific figures.
- Structures with no areas are left out.
- Areas are whole square feet, rounded the same way as the area table.
- `formatVersion` changes only if a field is removed or changes meaning.

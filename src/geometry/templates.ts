/**
 * Starter shapes. Each template turns a few dimensions into vector text, so
 * the result is ordinary, editable walls. Outlines start at the front-left
 * corner and run counter-clockwise (front wall first).
 */

import type { AreaKind } from "./ansi.js";
import { formatFeetInches } from "./units.js";

export interface TemplateParam {
  key: string;
  label: string;
  /** Default, feet. */
  value: number;
}

export interface Template {
  id: string;
  label: string;
  /** Sets the area's kind when applied (garage, deck…); living templates leave it alone. */
  kind?: AreaKind;
  params: TemplateParam[];
  build(p: Record<string, number>): string;
}

const f = formatFeetInches;

export const TEMPLATES: Template[] = [
  {
    id: "rect",
    label: "Rectangle",
    params: [
      { key: "w", label: "Width", value: 24 },
      { key: "d", label: "Depth", value: 30 },
    ],
    build: ({ w, d }) => `R${f(w!)} U${f(d!)} L${f(w!)} D${f(d!)}`,
  },
  {
    id: "l",
    label: "L-shape",
    params: [
      { key: "w", label: "Front width", value: 40 },
      { key: "d", label: "Depth", value: 24 },
      { key: "ww", label: "Rear wing width (left side)", value: 24 },
      { key: "wd", label: "Rear wing depth", value: 12 },
    ],
    build: ({ w, d, ww, wd }) =>
      `R${f(w!)} U${f(d!)} L${f(w! - ww!)} U${f(wd!)} L${f(ww!)} D${f(d! + wd!)}`,
  },
  {
    id: "bump",
    label: "Rectangle with bump-out",
    params: [
      { key: "w", label: "Width", value: 30 },
      { key: "d", label: "Depth", value: 24 },
      { key: "off", label: "Bump-out from left", value: 10 },
      { key: "bw", label: "Bump-out width", value: 10 },
      { key: "bd", label: "Bump-out depth", value: 4 },
    ],
    build: ({ w, d, off, bw, bd }) =>
      `R${f(off!)} D${f(bd!)} R${f(bw!)} U${f(bd!)} R${f(w! - off! - bw!)} U${f(d!)} L${f(w!)} D${f(d!)}`,
  },
  {
    id: "bay45",
    label: "Rectangle with 45° bay",
    params: [
      { key: "w", label: "Width", value: 30 },
      { key: "d", label: "Depth", value: 24 },
      { key: "off", label: "Bay from left", value: 12 },
      { key: "face", label: "Bay front face", value: 4 },
      { key: "bd", label: "Bay depth", value: 2 },
    ],
    // 45° sides as run/rise moves, so they stay exact.
    build: ({ w, d, off, face, bd }) =>
      `R${f(off!)} R${f(bd!)}D${f(bd!)} R${f(face!)} R${f(bd!)}U${f(bd!)} R${f(w! - off! - face! - 2 * bd!)} U${f(d!)} L${f(w!)} D${f(d!)}`,
  },
  {
    id: "bow",
    label: "Rectangle with bow window",
    params: [
      { key: "w", label: "Width", value: 30 },
      { key: "d", label: "Depth", value: 24 },
      { key: "off", label: "Bow from left", value: 10 },
      { key: "bw", label: "Bow width", value: 10 },
      { key: "bd", label: "Bow depth", value: 2 },
    ],
    build: ({ w, d, off, bw, bd }) =>
      `R${f(off!)} R${f(bw!)}^${f(bd!)} R${f(w! - off! - bw!)} U${f(d!)} L${f(w!)} D${f(d!)}`,
  },
  {
    id: "garage",
    label: "Garage",
    kind: "garage",
    params: [
      { key: "w", label: "Width", value: 24 },
      { key: "d", label: "Depth", value: 24 },
    ],
    build: ({ w, d }) => `R${f(w!)} U${f(d!)} L${f(w!)} D${f(d!)}`,
  },
  {
    id: "deck",
    label: "Deck",
    kind: "deck",
    params: [
      { key: "w", label: "Width", value: 16 },
      { key: "d", label: "Depth", value: 12 },
    ],
    build: ({ w, d }) => `R${f(w!)} U${f(d!)} L${f(w!)} D${f(d!)}`,
  },
];

/** Check template dimensions; returns a message if they don't make a valid shape. */
export function checkTemplate(t: Template, p: Record<string, number>): string | null {
  for (const param of t.params) {
    const v = p[param.key];
    if (v === undefined || !(v > 0)) return `${param.label} must be more than 0`;
  }
  const { w, off, bw, ww, face, bd } = p as Record<string, number>;
  if (t.id === "l" && ww! >= w!) return "Rear wing must be narrower than the front";
  if ((t.id === "bump" || t.id === "bow") && off! + bw! >= w!) return "Bump-out must fit within the width";
  if (t.id === "bay45" && off! + face! + 2 * bd! >= w!) return "Bay must fit within the width";
  return null;
}

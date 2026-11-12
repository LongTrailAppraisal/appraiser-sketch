import { describe, expect, it } from "vitest";
import { exportLabels, mergeLabels, parseLabelsFile } from "../src/app/labels.js";

describe("My labels files", () => {
  it("round-trips an export", () => {
    expect(parseLabelsFile(exportLabels(["Sauna", "Wine Cellar"]))).toEqual(["Sauna", "Wine Cellar"]);
  });
  it("reads a plain JSON list or one name per line", () => {
    expect(parseLabelsFile('["Sauna", 3, " Gym "]')).toEqual(["Sauna", "Gym"]);
    expect(parseLabelsFile("Sauna\r\n\nGym\n")).toEqual(["Sauna", "Gym"]);
    expect(parseLabelsFile("")).toEqual([]);
  });
  it("rejects files that aren't labels", () => {
    expect(() => parseLabelsFile("{bad")).toThrow(/not valid JSON/);
    expect(() => parseLabelsFile('{"formatVersion":1,"structures":[]}')).toThrow(/no list/);
  });
  it("merges without duplicates", () => {
    expect(mergeLabels(["Sauna"], ["sauna", "Gym", "Gym"])).toEqual({ labels: ["Gym", "Sauna"], added: 1 });
  });
});

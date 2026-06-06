import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseLegacyTowns } from "../scripts/src/pipeline/legacy.js";
import { normalizeName } from "../scripts/src/pipeline/names.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "fixtures", "grottos-legacy-2026-06.html"), "utf8");
const towns = parseLegacyTowns(html);

describe("parseLegacyTowns (town fallback source)", () => {
  it("parses a healthy number of town entries from the legacy list", () => {
    expect(towns.size).toBeGreaterThan(150);
  });

  it("maps a grotto to its town/state, keyed by normalized name", () => {
    expect(towns.get(normalizeName("Birmingham Grotto"))).toEqual({ town: "Birmingham", state: "AL" });
    // Dallas-Fort Worth's current page has no address; the legacy list does.
    const dfw = towns.get(normalizeName("Dallas-Fort Worth Grotto"));
    expect(dfw?.state).toBe("TX");
    expect(dfw?.town).toBeTruthy();
  });

  it("never stores a town containing a digit or street fragment (privacy)", () => {
    for (const { town } of towns.values()) {
      expect(/\d/.test(town)).toBe(false);
      expect(/\b(street|road|avenue|drive|lane|loop|p\.?o\.? box)\b/i.test(town)).toBe(false);
    }
  });
});

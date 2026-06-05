import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseGrottos, extractTownState } from "../scripts/src/pipeline/parse.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "grottos-legacy-2026-06.html");
const html = readFileSync(FIXTURE, "utf8");
const grottos = parseGrottos(html);
const byName = (n: string) => grottos.find((g) => g.name === n);

describe("parseGrottos against the saved source fixture", () => {
  it("extracts the full set of grottos (~210 expected)", () => {
    // Real source has ~207-210 entries; guard against parser drift.
    expect(grottos.length).toBeGreaterThan(190);
    expect(grottos.length).toBeLessThan(230);
  });

  it("assigns a valid 2-letter state to every entry", () => {
    const bad = grottos.filter((g) => g.state && !/^[A-Z]{2}$/.test(g.state));
    expect(bad).toEqual([]);
  });

  it("parses a clean 'City, ST ZIP' entry", () => {
    expect(byName("Birmingham Grotto")).toMatchObject({
      town: "Birmingham",
      state: "AL",
      contactUrl: "http://www.bhamgrotto.org",
    });
  });

  it("parses an entry with no website as contactUrl null", () => {
    expect(byName("Gadsden Grotto")?.contactUrl).toBeNull();
  });
});

describe("PRIVACY: town extraction never leaks a street address", () => {
  it("extracts the town from a line that begins with a street number", () => {
    // Source line: "6740 Marguerite St, Juneau AK 99801"
    expect(byName("Glacier Grotto")).toMatchObject({ town: "Juneau", state: "AK" });
  });

  it("no extracted town contains a digit or street keyword", () => {
    const streety =
      /\b(street|road|avenue|boulevard|drive|lane|court|circle|parkway|highway|place|terrace|trail|p\.?o\.? box|apt|suite|ste)\b/i;
    const leaks = grottos
      .filter((g) => g.town)
      .filter((g) => /\d/.test(g.town) || streety.test(g.town));
    expect(leaks).toEqual([]);
  });
});

describe("extractTownState format handling", () => {
  const cases = [
    ["Birmingham, AL 35259-9607", "Birmingham", "AL"], // clean, ZIP+4
    ["Sherwood AR 72120", "Sherwood", "AR"], // no comma
    ["Blue Springs, MO, 64014", "Blue Springs", "MO"], // extra comma
    ["1927 SE Fairwood Drive Bend OR, 97701", "Bend", "OR"], // street + city + comma-ZIP
    ["6740 Marguerite St, Juneau AK 99801", "Juneau", "AK"], // street, city ST ZIP
    ["Indiana, Pa 15701", "Indiana", "PA"], // lowercase state
    ["St. Louis, MO 63101", "St. Louis", "MO"], // 'St.' city not stripped as street
  ] as const;
  it.each(cases)("'%s' -> %s, %s", (line, town, state) => {
    expect(extractTownState([line])).toEqual({ town, state });
  });

  it("returns empty town when there is no parseable address line", () => {
    expect(extractTownState(["Steve Hobson, Chair"])).toEqual({ town: "", state: "" });
  });

  it("ignores a bogus 2-letter code that is not a real state", () => {
    expect(extractTownState(["Springfield ZZ 65801"])).toEqual({ town: "", state: "" });
  });
});

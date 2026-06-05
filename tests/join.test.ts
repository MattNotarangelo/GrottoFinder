import { describe, it, expect } from "vitest";
import { normalizeName } from "../scripts/src/pipeline/names.js";
import { joinRosterWithLegacy } from "../scripts/src/pipeline/join.js";
import type { ScrapedGrotto } from "../scripts/src/pipeline/types.js";
import type { RosterGrotto } from "../scripts/src/pipeline/roster.js";

describe("normalizeName matches the same club across sources", () => {
  it.each([
    ["Battlefield Area Troglodyte Society", "Battlefield Area Troglodyte Soc"],
    ["Middle Mississippi Valley Grotto", "Middle Mississippi Valley Gr."],
    ["New Jersey Tri-State Speleological Society", "New Jersey Tri-State Spel. Society"],
    ["Greater Randolph Organization (GROSS)", "Greater Randolph Organization"], // parenthetical dropped
    ["Cave Geology &#038; Geography", "Cave Geology & Geography"], // entity decode
  ])("'%s' == '%s'", (a, b) => {
    expect(normalizeName(a)).toBe(normalizeName(b));
  });

  it("keeps genuinely different names distinct", () => {
    expect(normalizeName("Huntsville Grotto")).not.toBe(normalizeName("Birmingham Grotto"));
  });
});

const leg = (name: string, town: string, state: string, url: string | null = null): ScrapedGrotto => ({
  name,
  town,
  state,
  contactUrl: url,
});
const ros = (name: string, states: string[]): RosterGrotto => ({ name, states });

describe("joinRosterWithLegacy", () => {
  const legacy = [
    leg("Huntsville Grotto", "Huntsville", "AL", "https://h.org"),
    leg("Persona Non Grotto", "Corbett", "OR"), // active in legacy, NOT in roster -> defunct
    leg("Battlefield Area Troglodyte Soc", "Manassas", "VA"), // matches via abbreviation
  ];
  const roster = [
    ros("Huntsville Grotto", ["AL"]),
    ros("Battlefield Area Troglodyte Society", ["VA"]), // name variant of legacy entry
    ros("Gila Area Grotto", ["NM"]), // new: in roster, no legacy match
    ros("Tennessee Cave Survey", []), // non-local entity: no state, no legacy
  ];

  const result = joinRosterWithLegacy(roster, legacy);

  it("pulls town + website from the matched legacy entry", () => {
    const h = result.grottos.find((g) => g.name === "Huntsville Grotto");
    expect(h).toMatchObject({ town: "Huntsville", state: "AL", contactUrl: "https://h.org" });
  });

  it("matches across name/abbreviation variants and keeps the roster's name", () => {
    const b = result.grottos.find((g) => g.name === "Battlefield Area Troglodyte Society");
    expect(b).toMatchObject({ town: "Manassas", state: "VA" });
  });

  it("drops legacy entries that are not in the roster (defunct)", () => {
    expect(result.grottos.some((g) => g.name === "Persona Non Grotto")).toBe(false);
    expect(result.legacyOnlyDropped).toContain("Persona Non Grotto");
  });

  it("keeps roster-only grottos but with no town (until an override adds one)", () => {
    const gila = result.grottos.find((g) => g.name === "Gila Area Grotto");
    expect(gila).toMatchObject({ town: "", state: "NM" });
    expect(result.apiOnly).toContain("Gila Area Grotto");
  });

  it("carries a non-local entity through with neither town nor state", () => {
    const survey = result.grottos.find((g) => g.name === "Tennessee Cave Survey");
    expect(survey).toMatchObject({ town: "", state: "" });
  });

  it("resolves an explicit alias (API name -> legacy name)", () => {
    const r2 = joinRosterWithLegacy(
      [ros("Renamed Mountain Grotto", ["CO"])],
      [leg("Old Mountain Grotto", "Aspen", "CO")],
      { "Renamed Mountain Grotto": "Old Mountain Grotto" }
    );
    expect(r2.grottos[0]).toMatchObject({ name: "Renamed Mountain Grotto", town: "Aspen", state: "CO" });
    expect(r2.legacyOnlyDropped).toEqual([]);
  });
});

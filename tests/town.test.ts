import { describe, it, expect } from "vitest";
import { extractTownState } from "../scripts/src/pipeline/town.js";

describe("extractTownState format handling", () => {
  it.each([
    ["Birmingham, AL 35259-9607", "Birmingham", "AL"], // clean, ZIP+4
    ["Sherwood AR 72120", "Sherwood", "AR"], // no comma
    ["Blue Springs, MO, 64014", "Blue Springs", "MO"], // extra comma
    ["1927 SE Fairwood Drive Bend OR, 97701", "Bend", "OR"], // street + city + comma-ZIP
    ["6740 Marguerite St, Juneau AK 99801", "Juneau", "AK"], // street, city ST ZIP
    ["Indiana, Pa 15701", "Indiana", "PA"], // lowercase state
    ["St. Louis, MO 63101", "St. Louis", "MO"], // 'St.' city not stripped as street
    ["14045 North Green Hills Loop, Austin, TX 78737-8619", "Austin", "TX"], // member home addr
    ["115 Stoneleigh Rd. Bel Air, Maryland, 21014-2837", "Bel Air", "MD"], // full state name
    ["Bend, Oregon 97701 president@x.org", "Bend", "OR"], // full name + trailing email
  ])("'%s' -> %s, %s", (line, town, state) => {
    expect(extractTownState([line])).toEqual({ town, state });
  });

  it("returns empty town when there is no parseable address line", () => {
    expect(extractTownState(["Ethan Perrine", "president@utgrotto.org"])).toEqual({
      town: "",
      state: "",
    });
  });

  it("ignores a bogus 2-letter code that is not a real state", () => {
    expect(extractTownState(["Springfield ZZ 65801"])).toEqual({ town: "", state: "" });
  });
});

describe("PRIVACY: never emits a street fragment as a town", () => {
  it("extracts the city from a multi-line member home address", () => {
    // A real contact block: name, street, City ST ZIP, email, phone.
    const lines = [
      "Ethan Perrine",
      "14045 North Green Hills Loop",
      "Austin, TX 78737-8619",
      "president@utgrotto.org",
      "(512) 350-1469",
    ];
    expect(extractTownState(lines)).toEqual({ town: "Austin", state: "TX" });
  });

  it("never returns a town containing a digit or street keyword", () => {
    const streety =
      /\b(street|road|avenue|boulevard|drive|lane|court|loop|circle|parkway|highway|p\.?o\.? box)\b/i;
    const samples = [
      ["123 Main St", "Anywhere, TN 37000"],
      ["14045 North Green Hills Loop", "Austin, TX 78737"],
      ["PO Box 5", "Cookeville, TN 38501"],
    ];
    for (const lines of samples) {
      const { town } = extractTownState(lines);
      expect(/\d/.test(town)).toBe(false);
      expect(streety.test(town)).toBe(false);
    }
  });
});

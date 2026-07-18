import { describe, expect, it } from "vitest";

import {
  classifyBreedingLine,
  canonicalizeWorkbookState,
  parseWorkbookState,
  sortWorkbookRows,
  workbookAppHref,
  workbookRawStateNeedsRedirect,
  workbookStateHref,
} from "@/lib/workbook-read";

describe("workbook state", () => {
  it("uses operational defaults and ignores unknown sections", () => {
    expect(parseWorkbookState({ section: "unknown", history: "false" })).toEqual({
      section: "overview",
      sheet: "all",
      search: "",
      sort: "priority",
      direction: "asc",
      history: false,
      labId: undefined,
    });
  });

  it("parses URL-backed sheet state", () => {
    expect(parseWorkbookState({
      section: "rooms",
      sheet: "room-a101",
      search: " CM-A101 ",
      sort: "occupancy",
      direction: "desc",
      history: "1",
      labId: "lab-neuro",
    })).toMatchObject({
      section: "rooms",
      sheet: "room-a101",
      search: "CM-A101",
      sort: "occupancy",
      direction: "desc",
      history: true,
      labId: "lab-neuro",
    });
  });

  it("normalizes invalid sort keys and inaccessible sheet or lab state", () => {
    const parsed = parseWorkbookState({ section: "rooms", sheet: "foreign-room", sort: "unsafe", labId: "foreign-lab" });
    expect(parsed.sort).toBe("location");
    expect(canonicalizeWorkbookState(parsed, {
      allowedSections: ["rooms"],
      childSheets: [{ id: "all", label: "All rooms" }, { id: "room-a", label: "Room A" }],
      canFilterLabs: true,
      labs: [{ id: "lab-a", label: "LAB-A" }],
    })).toMatchObject({ sheet: "all", sort: "location", labId: undefined });
  });

  it("detects every noncanonical raw URL state value", () => {
    const normalized = parseWorkbookState({ section: "unknown", direction: "sideways", history: "yes" });
    expect(workbookRawStateNeedsRedirect(
      { section: "unknown", direction: "sideways", history: "yes" },
      normalized,
    )).toBe(true);
    expect(workbookRawStateNeedsRedirect(
      { section: "rooms", direction: "desc", history: "1", sort: "occupancy" },
      parseWorkbookState({ section: "rooms", direction: "desc", history: "1", sort: "occupancy" }),
    )).toBe(false);
    expect(workbookRawStateNeedsRedirect(
      { section: "rooms", sheet: "all", search: "" },
      parseWorkbookState({ section: "rooms" }),
    )).toBe(true);
    expect(workbookRawStateNeedsRedirect(
      { section: "rooms", sheet: " room-a " },
      { ...parseWorkbookState({ section: "rooms", sheet: "room-a" }), sheet: "room-a" },
    )).toBe(true);
    expect(workbookRawStateNeedsRedirect(
      { section: ["rooms", "overview"] },
      parseWorkbookState({ section: "rooms" }),
    )).toBe(true);
  });

  it("preserves workbook URL state across sheet navigation", () => {
    const state = parseWorkbookState({
      section: "rooms",
      search: "CM-42",
      sort: "occupancy",
      direction: "desc",
      history: "1",
      labId: "lab-a",
    });
    expect(workbookStateHref(state, { sheet: "room-a", search: "" })).toBe(
      "/workbook?section=rooms&sheet=room-a&sort=occupancy&direction=desc&history=1&labId=lab-a",
    );
  });

  it("maps each workbook section back to its authoritative app route", () => {
    expect(workbookAppHref("overview")).toBe("/");
    expect(workbookAppHref("rooms")).toBe("/cages");
    expect(workbookAppHref("breeding")).toBe("/breeding");
    expect(workbookAppHref("experiments")).toBe("/experiments");
    expect(workbookAppHref("biosamples")).toBe("/samples");
    expect(workbookAppHref("cryostorage")).toBe("/cryostorage");
  });
});

describe("workbook grouping", () => {
  const adult = (role: string, id: string, name: string) => ({
    role,
    animal: { strain: { id, name } },
  });

  it("groups same-line parents under their strain", () => {
    expect(classifyBreedingLine([
      adult("sire", "strain-cx", "Cx3cr1-CreER"),
      adult("dam", "strain-cx", "Cx3cr1-CreER"),
    ])).toEqual({ id: "strain-cx", label: "Cx3cr1-CreER" });
  });

  it("routes mixed-parent strains to Cross-line", () => {
    expect(classifyBreedingLine([
      adult("sire", "strain-cx", "Cx3cr1-CreER"),
      adult("dam", "strain-ifn", "IFNAR flox"),
    ])).toEqual({ id: "cross-line", label: "Cross-line" });
  });

  it("sorts server-side worksheet rows deterministically", () => {
    const rows = [{ label: "Cage 10" }, { label: "Cage 2" }, { label: "Cage 1" }];
    expect(sortWorkbookRows(rows, (row) => row.label, "asc").map((row) => row.label)).toEqual([
      "Cage 1",
      "Cage 2",
      "Cage 10",
    ]);
    expect(sortWorkbookRows(rows, (row) => row.label, "desc").map((row) => row.label)).toEqual([
      "Cage 10",
      "Cage 2",
      "Cage 1",
    ]);
  });

  it("sorts numeric date keys chronologically across years", () => {
    const rows = [
      { label: "02 Jan 2026", timestamp: new Date("2026-01-02").getTime() },
      { label: "15 Dec 2025", timestamp: new Date("2025-12-15").getTime() },
    ];
    expect(sortWorkbookRows(rows, (row) => row.timestamp, "asc").map((row) => row.label)).toEqual([
      "15 Dec 2025",
      "02 Jan 2026",
    ]);
  });
});

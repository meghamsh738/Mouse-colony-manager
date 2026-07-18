import { describe, expect, it } from "vitest";

import { projectIntegrationExportCatalog, projectIntegrationResourceCatalog } from "@/lib/integration-api-catalog";
import type { Capability } from "@/lib/capabilities";

const resources = [
  { name: "animals", methods: ["GET", "POST", "PATCH"] as const },
  { name: "experiments", methods: ["GET"] as const },
  { name: "experiment-assignments", methods: ["POST", "PATCH", "DELETE"] as const },
  { name: "procedures", methods: ["GET", "POST"] as const },
  { name: "procedure-occurrences", methods: ["GET", "POST"] as const },
  { name: "samples", methods: ["GET", "POST", "PATCH"] as const },
  { name: "cryostorage", methods: ["GET", "POST", "PATCH"] as const },
  { name: "exports" },
] as const;

describe("integration API discovery projection", () => {
  it("does not advertise biosamples or private experiment mutations to CMU", () => {
    const capabilities: Capability[] = [
      "animals:read",
      "animals:manage",
      "experiments:read",
      "cryostorage:read",
      "cryostorage:manage",
      "procedures:operational",
      "procedures:execute",
      "workbook:read",
    ];

    const projected = projectIntegrationResourceCatalog(resources, capabilities);

    expect(projected.find((resource) => resource.name === "animals")?.methods).toEqual(["GET", "POST", "PATCH"]);
    expect(projected.find((resource) => resource.name === "experiments")?.methods).toEqual(["GET"]);
    expect(projected.some((resource) => resource.name === "experiment-assignments")).toBe(false);
    expect(projected.some((resource) => resource.name === "samples")).toBe(false);
    expect(projected.find((resource) => resource.name === "cryostorage")?.methods).toEqual(["GET", "POST", "PATCH"]);
    expect(projected.find((resource) => resource.name === "procedures")?.methods).toEqual(["GET"]);
    expect(projected.find((resource) => resource.name === "procedure-occurrences")?.methods).toEqual(["GET", "POST"]);
  });

  it("shows read-only methods to a lab viewer and filters exports independently", () => {
    const capabilities: Capability[] = [
      "animals:read",
      "experiments:read",
      "experiments:full",
      "biosamples:read",
      "cryostorage:read",
      "workbook:read",
      "procedures:operational",
    ];

    const projected = projectIntegrationResourceCatalog(resources, capabilities);
    expect(projected.find((resource) => resource.name === "animals")?.methods).toEqual(["GET"]);
    expect(projected.find((resource) => resource.name === "samples")?.methods).toEqual(["GET"]);
    expect(projected.find((resource) => resource.name === "cryostorage")?.methods).toEqual(["GET"]);
    expect(projected.find((resource) => resource.name === "procedures")?.methods).toEqual(["GET"]);
    expect(projected.find((resource) => resource.name === "procedure-occurrences")?.methods).toEqual(["GET"]);

    const exports = projectIntegrationExportCatalog(
      [{ entity: "animals" }, { entity: "alerts" }, { entity: "experiments" }],
      capabilities,
    );
    expect(exports.map((entry) => entry.entity)).toEqual(["animals", "experiments"]);
  });
});

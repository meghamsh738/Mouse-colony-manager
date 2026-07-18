import type { Capability } from "@/lib/capabilities";

type CatalogResource = {
  name: string;
  methods?: readonly string[];
  [key: string]: unknown;
};

type CatalogExport = {
  entity: string;
  [key: string]: unknown;
};

const methodCapabilities: Record<string, Partial<Record<string, Capability>>> = {
  animals: { GET: "animals:read", POST: "animals:manage", PATCH: "animals:manage" },
  cages: { GET: "cages:read", PATCH: "cages:manage" },
  "cage-health-notes": { POST: "cages:manage" },
  "breeding-setups": { POST: "breeding:manage" },
  litters: { POST: "breeding:manage" },
  weanings: { POST: "breeding:manage" },
  experiments: { GET: "experiments:read" },
  "experiment-assignments": { POST: "experiments:manage", PATCH: "experiments:manage", DELETE: "experiments:manage" },
  "experiment-reservations": { POST: "experiments:manage" },
  procedures: { GET: "procedures:operational", POST: "procedures:plan" },
  "procedure-occurrences": { GET: "procedures:operational", POST: "procedures:execute" },
  projects: { GET: "experiments:full", POST: "experiments:manage", PATCH: "experiments:manage" },
  samples: { GET: "biosamples:read", POST: "biosamples:manage", PATCH: "biosamples:manage" },
  cryostorage: { GET: "cryostorage:read", POST: "cryostorage:manage", PATCH: "cryostorage:manage" },
  genotypes: { POST: "animals:manage" },
  "genotype-import": { POST: "animals:manage" },
  rules: { GET: "rules:manage", PATCH: "rules:manage" },
};

const resourceCapabilities: Record<string, Capability> = {
  exports: "workbook:read",
  "notification-delivery": "notifications:deliver",
};

const exportCapabilities: Record<string, Capability> = {
  animals: "animals:read",
  cages: "cages:read",
  alerts: "notifications:read",
  experiments: "experiments:full",
};

export function projectIntegrationResourceCatalog<T extends CatalogResource>(
  resources: readonly T[],
  capabilities: readonly Capability[],
) {
  const allowed = new Set(capabilities);

  return resources.flatMap((resource) => {
    const policy = methodCapabilities[resource.name];
    if (policy) {
      const methods = (resource.methods ?? []).filter((method) => {
        const capability = policy[method];
        return capability ? allowed.has(capability) : false;
      });
      return methods.length ? [{ ...resource, methods }] : [];
    }

    const capability = resourceCapabilities[resource.name];
    return capability && allowed.has(capability) ? [resource] : [];
  });
}

export function projectIntegrationExportCatalog<T extends CatalogExport>(
  exports: readonly T[],
  capabilities: readonly Capability[],
) {
  const allowed = new Set(capabilities);
  return exports.filter((entry) => {
    const capability = exportCapabilities[entry.entity];
    return capability ? allowed.has(capability) : false;
  });
}

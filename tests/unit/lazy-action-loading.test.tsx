import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAnimalInventoryPageView: vi.fn(),
  getAnimalPageOptions: vi.fn(),
  getSampleInventoryFilterOptions: vi.fn(),
  getSampleInventoryPageView: vi.fn(),
  getSamplePageOptions: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/animals-read", () => ({
  ANIMAL_INVENTORY_DEFAULT_PAGE_SIZE: 80,
  getAnimalInventoryPageView: mocks.getAnimalInventoryPageView,
  getAnimalPageOptions: mocks.getAnimalPageOptions,
}));

vi.mock("@/lib/samples-read", () => ({
  SAMPLE_INVENTORY_DEFAULT_PAGE_SIZE: 80,
  getSampleInventoryFilterOptions: mocks.getSampleInventoryFilterOptions,
  getSampleInventoryPageView: mocks.getSampleInventoryPageView,
  getSamplePageOptions: mocks.getSamplePageOptions,
}));

vi.mock("@/lib/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/components/app/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));

import AnimalsPage from "@/app/animals/page";
import SamplesPage from "@/app/samples/page";
import { getRequestedAction, withActionQuery } from "@/lib/action-route";

const actor = {
  id: "user-manager",
  role: "colony_manager",
  capabilities: ["biosamples:read", "biosamples:manage"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(actor);
  mocks.getAnimalInventoryPageView.mockResolvedValue({
    items: [],
    page: 1,
    pageCount: 1,
    pageSize: 80,
    query: { availableOnly: false, pageSize: 80, search: "", status: "all" },
    totalCount: 0,
  });
  mocks.getAnimalPageOptions.mockResolvedValue({ cageOptions: [], projectOptions: [], strainOptions: [] });
  mocks.getSampleInventoryPageView.mockResolvedValue({
    items: [],
    page: 1,
    pageCount: 1,
    pageSize: 80,
    query: { experimentId: "all", pageSize: 80, sampleType: "all", search: "", status: "all" },
    sampleTypes: [],
    totalCount: 0,
  });
  mocks.getSampleInventoryFilterOptions.mockResolvedValue({ experimentOptions: [] });
  mocks.getSamplePageOptions.mockResolvedValue({
    activeExperimentOptions: [],
    animalOptions: [],
    experimentOptions: [],
    projectOptions: [],
  });
});

describe("lazy inventory action options", () => {
  it("does not fetch closed action-form catalogs", async () => {
    await AnimalsPage({ searchParams: Promise.resolve({}) });
    await SamplesPage({ searchParams: Promise.resolve({}) });

    expect(mocks.getAnimalPageOptions).not.toHaveBeenCalled();
    expect(mocks.getSamplePageOptions).not.toHaveBeenCalled();
    expect(mocks.getSampleInventoryFilterOptions).toHaveBeenCalledOnce();
  });

  it("keeps non-catalog actions available on the lightweight Animals route", async () => {
    render(await AnimalsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "Receive mice: Purchased delivery" })).toHaveAttribute(
      "href",
      "/cages/intake?mode=purchase",
    );
  });

  it("fetches action-form catalogs only for the matching explicit action", async () => {
    await AnimalsPage({ searchParams: Promise.resolve({ action: "add-mouse" }) });
    await SamplesPage({ searchParams: Promise.resolve({ action: "add-sample" }) });

    expect(mocks.getAnimalPageOptions).toHaveBeenCalledOnce();
    expect(mocks.getSamplePageOptions).toHaveBeenCalledOnce();
    expect(mocks.getSampleInventoryFilterOptions).not.toHaveBeenCalled();
  });

  it("does not let an action query bypass role or capability checks", async () => {
    mocks.requireUser.mockResolvedValue({
      id: "user-read-only",
      role: "read_only",
      capabilities: ["biosamples:read"],
    });

    await AnimalsPage({ searchParams: Promise.resolve({ action: "add-mouse" }) });
    await SamplesPage({ searchParams: Promise.resolve({ action: "add-sample" }) });

    expect(mocks.getAnimalPageOptions).not.toHaveBeenCalled();
    expect(mocks.getSamplePageOptions).not.toHaveBeenCalled();
    expect(mocks.getSampleInventoryFilterOptions).toHaveBeenCalledOnce();
  });
});

describe("inventory action routes", () => {
  it("preserves the canonical inventory query while adding the requested action", () => {
    expect(withActionQuery("/animals?status=breeding&page=3", "add-mouse")).toBe(
      "/animals?status=breeding&page=3&action=add-mouse",
    );
  });

  it("accepts only a declared action and handles repeated query values deterministically", () => {
    expect(getRequestedAction({ action: ["add-sample", "unexpected"] }, ["add-sample"] as const)).toBe(
      "add-sample",
    );
    expect(getRequestedAction({ action: "unexpected" }, ["add-sample"] as const)).toBeUndefined();
  });
});

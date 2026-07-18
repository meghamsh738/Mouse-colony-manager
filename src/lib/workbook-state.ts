import type { WorkbookSection, WorkbookState } from "@/lib/workbook-read";

export function workbookStateHref(state: WorkbookState, changes: Partial<WorkbookState> = {}) {
  const next = { ...state, ...changes };
  const params = new URLSearchParams();
  params.set("section", next.section);
  if (next.sheet !== "all") params.set("sheet", next.sheet);
  if (next.search) params.set("search", next.search);
  if (next.sort) params.set("sort", next.sort);
  if (next.direction !== "asc") params.set("direction", next.direction);
  if (next.history) params.set("history", "1");
  if (next.labId) params.set("labId", next.labId);
  return `/workbook?${params.toString()}`;
}

export function workbookAppHref(section: WorkbookSection) {
  return {
    overview: "/",
    rooms: "/cages",
    breeding: "/breeding",
    experiments: "/experiments",
    biosamples: "/samples",
    cryostorage: "/cryostorage",
  }[section];
}

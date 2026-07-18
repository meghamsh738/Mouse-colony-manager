import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-route";
import type { Capability } from "@/lib/capabilities";
import {
  buildCsvExport,
  CsvExportLimitError,
  CsvExportRangeError,
  hasActiveExportFilters,
} from "@/lib/export-csv";

const exportCapabilities: Record<string, Capability> = {
  animals: "animals:read",
  cages: "cages:read",
  alerts: "notifications:read",
  experiments: "experiments:full",
  audit: "audit:domain",
  security: "audit:security",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  const { entity } = await params;
  const capability = exportCapabilities[entity];

  if (!capability) {
    return NextResponse.json({ error: "Unknown export entity" }, { status: 404 });
  }

  const authorization = await requireApiUser(capability);

  if ("response" in authorization) {
    return authorization.response;
  }

  const url = new URL(request.url);
  const filters = {
    search: url.searchParams.get("search") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    availableOnly: url.searchParams.get("availableOnly") === "true",
    warningsOnly: url.searchParams.get("warningsOnly") === "true",
    outcome: url.searchParams.get("outcome") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  };
  let csv: string | null;
  try {
    csv = await buildCsvExport(entity, authorization.user, filters);
  } catch (error) {
    if (error instanceof CsvExportRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof CsvExportLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    throw error;
  }

  if (csv === null) {
    return NextResponse.json({ error: "Unknown export entity" }, { status: 404 });
  }

  const filename = hasActiveExportFilters(filters) ? `${entity}-filtered.csv` : `${entity}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

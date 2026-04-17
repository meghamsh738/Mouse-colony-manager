import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { buildCsvExport, hasActiveExportFilters } from "@/lib/export-csv";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entity } = await params;
  const url = new URL(request.url);
  const filters = {
    search: url.searchParams.get("search") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    availableOnly: url.searchParams.get("availableOnly") === "true",
    warningsOnly: url.searchParams.get("warningsOnly") === "true",
  };
  const csv = await buildCsvExport(entity, filters);

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

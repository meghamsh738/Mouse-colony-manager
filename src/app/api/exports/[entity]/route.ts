import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { buildCsvExport } from "@/lib/export-csv";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entity } = await params;
  const csv = await buildCsvExport(entity);

  if (csv === null) {
    return NextResponse.json({ error: "Unknown export entity" }, { status: 404 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${entity}.csv"`,
    },
  });
}

import { NextRequest, NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-route";
import { resolveCageByApiReference } from "@/lib/integration-api";

function buildBrowserSafeRedirect(pathname: string, request: NextRequest) {
  const url = new URL(pathname, request.url);

  if (url.hostname === "0.0.0.0" || url.hostname === "::" || url.hostname === "[::]") {
    url.hostname = "localhost";
  }

  return url;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiUser("scan:use");

  if ("response" in auth) {
    return auth.response;
  }

  const barcode = request.nextUrl.searchParams.get("barcode")?.trim();

  if (!barcode) {
    return NextResponse.redirect(buildBrowserSafeRedirect("/scan", request));
  }

  const cage = await resolveCageByApiReference({ cageBarcode: barcode }, auth.user);

  if (!cage.ok) {
    return NextResponse.json({ error: "Cage not found" }, { status: 404 });
  }

  return NextResponse.redirect(
    buildBrowserSafeRedirect(`/scan/${encodeURIComponent(cage.value.cageBarcode)}`, request),
  );
}

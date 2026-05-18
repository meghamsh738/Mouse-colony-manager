import { NextRequest, NextResponse } from "next/server";

function buildBrowserSafeRedirect(pathname: string, request: NextRequest) {
  const url = new URL(pathname, request.url);

  if (url.hostname === "0.0.0.0" || url.hostname === "::" || url.hostname === "[::]") {
    url.hostname = "localhost";
  }

  return url;
}

export function GET(request: NextRequest) {
  const barcode = request.nextUrl.searchParams.get("barcode")?.trim();

  if (!barcode) {
    return NextResponse.redirect(buildBrowserSafeRedirect("/scan", request));
  }

  return NextResponse.redirect(buildBrowserSafeRedirect(`/scan/${encodeURIComponent(barcode)}`, request));
}

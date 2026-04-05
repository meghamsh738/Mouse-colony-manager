import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  const barcode = request.nextUrl.searchParams.get("barcode")?.trim();

  if (!barcode) {
    return NextResponse.redirect(new URL("/scan", request.url));
  }

  return NextResponse.redirect(new URL(`/scan/${encodeURIComponent(barcode)}`, request.url));
}

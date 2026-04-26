import { NextResponse } from "next/server";

import { buildItemResponse, requireApiUser } from "@/lib/api-route";
import { buildNotificationDeliveryBatch, deliverNotificationDigest } from "@/lib/notification-delivery";

function canDeliver(role: string) {
  return role === "admin" || role === "colony_manager";
}

async function parseDeliveryRequest(request: Request) {
  try {
    const body = (await request.json()) as { dryRun?: unknown };

    return {
      dryRun: body.dryRun !== false,
    };
  } catch {
    return {
      dryRun: true,
    };
  }
}

export async function GET() {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  return buildItemResponse(await buildNotificationDeliveryBatch());
}

export async function POST(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (!canDeliver(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const input = await parseDeliveryRequest(request);

  return buildItemResponse(await deliverNotificationDigest(input));
}

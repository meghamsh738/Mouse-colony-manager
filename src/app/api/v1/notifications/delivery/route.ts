import { buildItemResponse, requireApiUser } from "@/lib/api-route";
import { buildNotificationDeliveryBatch, deliverNotificationDigest } from "@/lib/notification-delivery";

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
  const auth = await requireApiUser("notifications:deliver");

  if ("response" in auth) {
    return auth.response;
  }

  return buildItemResponse(await buildNotificationDeliveryBatch(auth.user));
}

export async function POST(request: Request) {
  const auth = await requireApiUser("notifications:deliver");

  if ("response" in auth) {
    return auth.response;
  }

  const input = await parseDeliveryRequest(request);

  return buildItemResponse(await deliverNotificationDigest(input, auth.user));
}

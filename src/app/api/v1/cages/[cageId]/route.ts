import { buildItemResponse, buildNotFoundResponse, requireApiUser } from "@/lib/api-route";
import { getCageApiDetail } from "@/lib/integration-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cageId: string }> },
) {
  const auth = await requireApiUser("cages:read");

  if ("response" in auth) {
    return auth.response;
  }

  const { cageId } = await params;
  const cage = await getCageApiDetail(cageId, auth.user);

  if (!cage) {
    return buildNotFoundResponse("Cage", cageId);
  }

  return buildItemResponse(cage);
}

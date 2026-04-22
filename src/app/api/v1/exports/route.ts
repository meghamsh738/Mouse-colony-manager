import { buildCollectionResponse, requireApiUser } from "@/lib/api-route";
import { getIntegrationExportCatalog } from "@/lib/integration-api";

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const origin = new URL(request.url).origin;
  const exports = getIntegrationExportCatalog(origin);

  return buildCollectionResponse(exports, {
    total: exports.length,
    limit: exports.length,
    filters: {},
  });
}

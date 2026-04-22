import { buildIndexResponse, requireApiUser } from "@/lib/api-route";
import { getIntegrationExportCatalog, getIntegrationResourceCatalog } from "@/lib/integration-api";

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const origin = new URL(request.url).origin;

  return buildIndexResponse({
    version: "v1",
    resources: getIntegrationResourceCatalog(origin),
    exports: getIntegrationExportCatalog(origin),
  });
}

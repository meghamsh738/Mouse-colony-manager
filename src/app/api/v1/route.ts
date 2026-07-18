import { buildIndexResponse, requireApiUser } from "@/lib/api-route";
import { projectIntegrationExportCatalog, projectIntegrationResourceCatalog } from "@/lib/integration-api-catalog";
import { getIntegrationExportCatalog, getIntegrationResourceCatalog } from "@/lib/integration-api";

export async function GET(request: Request) {
  const auth = await requireApiUser("dashboard:view");

  if ("response" in auth) {
    return auth.response;
  }

  const origin = new URL(request.url).origin;
  const resources = getIntegrationResourceCatalog(origin);
  const exports = getIntegrationExportCatalog(origin);

  return buildIndexResponse({
    version: "v1",
    resources: projectIntegrationResourceCatalog(resources, auth.user.capabilities),
    exports: projectIntegrationExportCatalog(exports, auth.user.capabilities),
  });
}

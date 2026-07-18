import { buildCollectionResponse, compactApiMeta, requireApiUser } from "@/lib/api-route";
import { getExperimentApiList, parseExperimentApiFilters } from "@/lib/integration-api";

export async function GET(request: Request) {
  const auth = await requireApiUser("experiments:read");

  if ("response" in auth) {
    return auth.response;
  }

  const filters = parseExperimentApiFilters(new URL(request.url).searchParams);
  const result = await getExperimentApiList(filters, auth.user);

  return buildCollectionResponse(result.data, {
    total: result.total,
    limit: filters.limit,
    filters: compactApiMeta({
      search: filters.search || undefined,
      status: filters.status !== "all" ? filters.status : undefined,
      projectCode: filters.projectCode || undefined,
    }),
  });
}

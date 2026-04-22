import { buildCollectionResponse, compactApiMeta, requireApiUser } from "@/lib/api-route";
import { getProjectApiList, parseProjectApiFilters } from "@/lib/integration-api";

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const filters = parseProjectApiFilters(new URL(request.url).searchParams);
  const result = await getProjectApiList(filters);

  return buildCollectionResponse(result.data, {
    total: result.total,
    limit: filters.limit,
    filters: compactApiMeta({
      search: filters.search || undefined,
      owner: filters.owner || undefined,
    }),
  });
}

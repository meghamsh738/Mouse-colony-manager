import { buildCollectionResponse, compactApiMeta, requireApiUser } from "@/lib/api-route";
import { getCageApiList, parseCageApiFilters } from "@/lib/integration-api";

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const filters = parseCageApiFilters(new URL(request.url).searchParams);
  const result = await getCageApiList(filters);

  return buildCollectionResponse(result.data, {
    total: result.total,
    limit: filters.limit,
    filters: compactApiMeta({
      search: filters.search || undefined,
      status: filters.status !== "all" ? filters.status : undefined,
      room: filters.room || undefined,
      rack: filters.rack || undefined,
      warningsOnly: filters.warningsOnly ? true : undefined,
    }),
  });
}

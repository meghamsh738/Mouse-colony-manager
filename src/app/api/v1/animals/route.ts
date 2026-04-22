import { buildCollectionResponse, compactApiMeta, requireApiUser } from "@/lib/api-route";
import { getAnimalApiList, parseAnimalApiFilters } from "@/lib/integration-api";

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const filters = parseAnimalApiFilters(new URL(request.url).searchParams);
  const result = await getAnimalApiList(filters);

  return buildCollectionResponse(result.data, {
    total: result.total,
    limit: filters.limit,
    filters: compactApiMeta({
      search: filters.search || undefined,
      status: filters.status !== "all" ? filters.status : undefined,
      sex: filters.sex !== "all" ? filters.sex : undefined,
      strain: filters.strain || undefined,
      projectCode: filters.projectCode || undefined,
      availableOnly: filters.availableOnly ? true : undefined,
      warningsOnly: filters.warningsOnly ? true : undefined,
    }),
  });
}

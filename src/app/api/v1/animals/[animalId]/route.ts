import { buildItemResponse, buildNotFoundResponse, requireApiUser } from "@/lib/api-route";
import { getAnimalApiDetail } from "@/lib/integration-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ animalId: string }> },
) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  const { animalId } = await params;
  const animal = await getAnimalApiDetail(animalId);

  if (!animal) {
    return buildNotFoundResponse("Animal", animalId);
  }

  return buildItemResponse(animal);
}

import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { recordAnimalGenotype } from "@/lib/colony-write";
import {
  buildGenotypeApiFinalCall,
  getExistingGenotypeApiRecord,
  getGenotypeApiRecordById,
  resolveGenotypeApiInput,
} from "@/lib/integration-api";

const createGenotypeApiSchema = z.object({
  animalId: z.string().trim().min(1).optional(),
  animalCode: z.string().trim().min(1).optional(),
  alleleId: z.string().trim().min(1).optional(),
  marker: z.string().trim().min(1).optional(),
  zygosity: z.string().trim().min(1).max(40),
  status: z.enum(["pending", "provisional", "confirmed", "conflict"]).default("confirmed"),
  sourceType: z.string().trim().min(2).max(80),
  assayType: z.string().trim().min(2).max(80),
  sampleDate: z.string().trim().min(1),
  resultDate: z.string().trim().min(1),
  resultText: z.string().trim().min(3).max(400),
  confidence: z.string().trim().max(40).optional(),
  provider: z.string().trim().max(80).optional(),
  sampleId: z.string().trim().max(80).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot record genotyping results.", 403);
  }

  const body = await parseJsonBody(request);
  const parsed = createGenotypeApiSchema.safeParse(body);

  if (!parsed.success) {
    return buildApiErrorResponse("Invalid genotype payload.", 400, parsed.error.flatten().fieldErrors);
  }

  const resolved = await resolveGenotypeApiInput(parsed.data);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const finalCall = buildGenotypeApiFinalCall({
    marker: resolved.value.marker,
    status: parsed.data.status,
    zygosity: parsed.data.zygosity,
  });
  const existingRecord = await getExistingGenotypeApiRecord({
    animalId: resolved.value.animalId,
    marker: resolved.value.marker,
    status: parsed.data.status,
    sampleDate: parsed.data.sampleDate,
    resultDate: parsed.data.resultDate,
    finalCall,
    resultText: parsed.data.resultText,
  });

  if (existingRecord) {
    return buildMutationResponse(existingRecord, {
      status: 200,
      created: false,
      message: `${existingRecord.markerTested} genotype is already recorded for ${existingRecord.animalCode}.`,
    });
  }

  const result = await recordAnimalGenotype(
    {
      animalId: resolved.value.animalId,
      alleleId: resolved.value.alleleId,
      zygosity: parsed.data.zygosity,
      status: parsed.data.status,
      sourceType: parsed.data.sourceType,
      assayType: parsed.data.assayType,
      sampleDate: parsed.data.sampleDate,
      resultDate: parsed.data.resultDate,
      resultText: parsed.data.resultText,
      confidence: parsed.data.confidence,
      provider: parsed.data.provider,
      sampleId: parsed.data.sampleId,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok || !result.entityId) {
    const status = result.message.includes("role cannot") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  const genotype = await getGenotypeApiRecordById(result.entityId);

  if (!genotype) {
    return buildApiErrorResponse("Genotype was recorded but could not be read back.", 500);
  }

  return buildMutationResponse(genotype, {
    status: 201,
    created: true,
    message: result.message,
  });
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

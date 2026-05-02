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
  attachmentLabel: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot record genotyping results.", 403);
  }

  const parsedRequest = await parseGenotypeApiRequest(request);

  if (!parsedRequest.ok) {
    return buildApiErrorResponse(parsedRequest.message, 400, parsedRequest.details);
  }

  const parsed = parsedRequest.value;

  const resolved = await resolveGenotypeApiInput(parsed);

  if (!resolved.ok) {
    return buildApiErrorResponse(resolved.message, resolved.status);
  }

  const finalCall = buildGenotypeApiFinalCall({
    marker: resolved.value.marker,
    status: parsed.status,
    zygosity: parsed.zygosity,
  });
  const existingRecord = await getExistingGenotypeApiRecord({
    animalId: resolved.value.animalId,
    marker: resolved.value.marker,
    status: parsed.status,
    sampleDate: parsed.sampleDate,
    resultDate: parsed.resultDate,
    finalCall,
    resultText: parsed.resultText,
  });

  if (existingRecord && !parsedRequest.attachment) {
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
      zygosity: parsed.zygosity,
      status: parsed.status,
      sourceType: parsed.sourceType,
      assayType: parsed.assayType,
      sampleDate: parsed.sampleDate,
      resultDate: parsed.resultDate,
      resultText: parsed.resultText,
      confidence: parsed.confidence,
      provider: parsed.provider,
      sampleId: parsed.sampleId,
      attachment: parsedRequest.attachment
        ? {
            file: parsedRequest.attachment,
            label: parsed.attachmentLabel,
          }
        : undefined,
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
    status: existingRecord ? 200 : 201,
    created: !existingRecord,
    message: result.message,
  });
}

async function parseGenotypeApiRequest(request: Request): Promise<
  | {
      ok: true;
      value: z.infer<typeof createGenotypeApiSchema>;
      attachment?: File;
    }
  | {
      ok: false;
      message: string;
      details?: unknown;
    }
> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("multipart/form-data")) {
    try {
      const formData = await request.formData();
      const attachmentField = formData.get("attachment");
      const attachment = attachmentField instanceof File && attachmentField.size > 0 ? attachmentField : undefined;
      const parsed = createGenotypeApiSchema.safeParse({
        animalId: getFormText(formData, "animalId"),
        animalCode: getFormText(formData, "animalCode"),
        alleleId: getFormText(formData, "alleleId"),
        marker: getFormText(formData, "marker"),
        zygosity: getFormText(formData, "zygosity"),
        status: getFormText(formData, "status") ?? undefined,
        sourceType: getFormText(formData, "sourceType"),
        assayType: getFormText(formData, "assayType"),
        sampleDate: getFormText(formData, "sampleDate"),
        resultDate: getFormText(formData, "resultDate"),
        resultText: getFormText(formData, "resultText"),
        confidence: getFormText(formData, "confidence"),
        provider: getFormText(formData, "provider"),
        sampleId: getFormText(formData, "sampleId"),
        attachmentLabel: getFormText(formData, "attachmentLabel"),
      });

      if (!parsed.success) {
        return {
          ok: false,
          message: "Invalid genotype payload.",
          details: parsed.error.flatten().fieldErrors,
        };
      }

      return {
        ok: true,
        value: parsed.data,
        attachment,
      };
    } catch {
      return { ok: false, message: "Invalid genotype payload." };
    }
  }

  try {
    const parsed = createGenotypeApiSchema.safeParse(await request.json());

    if (!parsed.success) {
      return {
        ok: false,
        message: "Invalid genotype payload.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    return {
      ok: true,
      value: parsed.data,
    };
  } catch {
    return { ok: false, message: "Invalid genotype payload." };
  }
}

function getFormText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

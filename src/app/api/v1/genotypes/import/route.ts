import { z } from "zod";

import { buildApiErrorResponse, buildMutationResponse, requireApiUser } from "@/lib/api-route";
import { importGenotypeCsvBatch } from "@/lib/colony-write";
import { buildGenotypeImportApiSummary } from "@/lib/integration-api";

const genotypeImportApiSchema = z.object({
  csvText: z.string(),
  fileName: z.string().trim().max(200).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();

  if ("response" in auth) {
    return auth.response;
  }

  if (auth.user.role === "read_only") {
    return buildApiErrorResponse("Your role cannot import genotyping results.", 403);
  }

  const parsedRequest = await parseGenotypeImportApiRequest(request);

  if (!parsedRequest.ok) {
    return buildApiErrorResponse(parsedRequest.message, 400, parsedRequest.details);
  }

  const result = await importGenotypeCsvBatch(
    {
      csvText: parsedRequest.value.csvText,
      fileName: parsedRequest.value.fileName,
    },
    { id: auth.user.id, role: auth.user.role },
  );

  if (!result.ok) {
    const status = result.message.includes("role cannot") ? 403 : 400;

    return buildApiErrorResponse(result.message, status);
  }

  return buildMutationResponse(buildGenotypeImportApiSummary(parsedRequest.value), {
    status: 200,
    created: false,
    message: result.message,
  });
}

async function parseGenotypeImportApiRequest(request: Request): Promise<
  | {
      ok: true;
      value: z.infer<typeof genotypeImportApiSchema>;
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
      const fileField = formData.get("file");
      const file = fileField instanceof File && fileField.size > 0 ? fileField : null;
      const csvTextInput = getFormText(formData, "csvText") ?? "";

      if (!file && !csvTextInput.trim()) {
        return { ok: false, message: "Upload a CSV file or paste genotype rows before importing." };
      }

      if (file && file.size > 1_000_000) {
        return { ok: false, message: "Keep genotype import files under 1 MB for the current MVP flow." };
      }

      const csvText = file ? await file.text() : csvTextInput;
      const parsed = genotypeImportApiSchema.safeParse({
        csvText,
        fileName: file?.name ?? getFormText(formData, "fileName"),
      });

      if (!parsed.success) {
        return {
          ok: false,
          message: "Invalid genotype import payload.",
          details: parsed.error.flatten().fieldErrors,
        };
      }

      return {
        ok: true,
        value: parsed.data,
      };
    } catch {
      return { ok: false, message: "Invalid genotype import payload." };
    }
  }

  try {
    const raw = await request.json();
    const parsed = genotypeImportApiSchema.safeParse(raw);

    if (!parsed.success) {
      return {
        ok: false,
        message: "Invalid genotype import payload.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    if (!parsed.data.csvText.trim()) {
      return { ok: false, message: "Upload a CSV file or paste genotype rows before importing." };
    }

    return {
      ok: true,
      value: parsed.data,
    };
  } catch {
    return { ok: false, message: "Invalid genotype import payload." };
  }
}

function getFormText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

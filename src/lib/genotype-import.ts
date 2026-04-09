import type { GenotypeCallStatus } from "@/lib/types";

export type ParsedGenotypeImportRow = {
  rowNumber: number;
  animalLookup: string;
  alleleLookup: string;
  zygosity: string;
  status: GenotypeCallStatus;
  sourceType: string;
  assayType: string;
  sampleDate: string;
  resultDate: string;
  resultText: string;
  confidence?: string;
  provider?: string;
  sampleId?: string;
};

export type ParsedGenotypeImportResult = {
  rows: ParsedGenotypeImportRow[];
  errors: string[];
};

const requiredHeaders = {
  animalLookup: ["animal_id", "animalid", "animal", "subject_id", "subject", "lab_id", "labid"],
  alleleLookup: ["allele", "marker", "locus", "construct", "gene"],
  sampleDate: ["sample_date", "collection_date", "date_sampled", "collected_at"],
  resultDate: ["result_date", "assay_date", "date_reported", "reported_at"],
};

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/^\ufeff/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseCsvMatrix(csvText: string) {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  const commitField = () => {
    currentRow.push(currentField);
    currentField = "";
  };

  const commitRow = () => {
    if (currentRow.length === 1 && currentRow[0] === "") {
      currentRow = [];
      return;
    }

    rows.push(currentRow);
    currentRow = [];
  };

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];

    if (char === '"') {
      const next = csvText[index + 1];

      if (inQuotes && next === '"') {
        currentField += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === ",") {
      commitField();
      continue;
    }

    if (!inQuotes && char === "\n") {
      commitField();
      commitRow();
      continue;
    }

    if (!inQuotes && char === "\r") {
      continue;
    }

    currentField += char;
  }

  commitField();
  commitRow();

  return rows;
}

function getCell(row: Record<string, string>, candidates: string[]) {
  for (const candidate of candidates) {
    const value = row[candidate];

    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

function normalizeStatus(rawStatus: string, rawCall: string): GenotypeCallStatus {
  const statusKey = rawStatus.trim().toLowerCase();
  const callKey = rawCall.trim().toLowerCase();

  if (["pending", "awaiting", "awaiting_report"].includes(statusKey) || callKey === "pending") {
    return "pending";
  }

  if (["provisional", "preliminary"].includes(statusKey)) {
    return "provisional";
  }

  if (["conflict", "discordant", "failed"].includes(statusKey) || callKey === "conflict") {
    return "conflict";
  }

  return "confirmed";
}

function normalizeZygosity(rawCall: string, status: GenotypeCallStatus) {
  const value = rawCall.trim().toLowerCase();

  if (!value) {
    return status === "pending" ? "pending" : status === "conflict" ? "conflict" : "";
  }

  if (["positive", "pos", "present", "het", "heterozygous", "+/-"].includes(value)) {
    return "+/-";
  }

  if (["homozygous", "hom", "+/+"].includes(value)) {
    return "+/+";
  }

  if (["negative", "neg", "absent", "wt", "wt/wt", "wildtype", "wild_type", "wild type"].includes(value)) {
    return "WT/WT";
  }

  return rawCall.trim();
}

function validateHeaderSet(headers: string[]) {
  const missing = Object.values(requiredHeaders)
    .filter((aliases) => aliases.every((alias) => !headers.includes(alias)))
    .map((aliases) => aliases[0]);

  return missing;
}

export function parseGenotypeImportCsv(csvText: string): ParsedGenotypeImportResult {
  const trimmed = csvText.replace(/^\ufeff/, "").trim();

  if (!trimmed) {
    return {
      rows: [],
      errors: ["Upload a CSV file or paste genotype rows before importing."],
    };
  }

  const matrix = parseCsvMatrix(trimmed);

  if (matrix.length < 2) {
    return {
      rows: [],
      errors: ["Provide a header row and at least one genotype record row."],
    };
  }

  const headers = matrix[0].map(normalizeHeader);
  const missingHeaders = validateHeaderSet(headers);

  if (missingHeaders.length) {
    return {
      rows: [],
      errors: [`Missing required headers: ${missingHeaders.join(", ")}.`],
    };
  }

  const rows: ParsedGenotypeImportRow[] = [];
  const errors: string[] = [];

  for (let index = 1; index < matrix.length; index += 1) {
    const values = matrix[index];
    const paddedValues = headers.map((_, headerIndex) => values[headerIndex]?.trim() ?? "");

    if (paddedValues.every((value) => value === "")) {
      continue;
    }

    const row = Object.fromEntries(headers.map((header, headerIndex) => [header, paddedValues[headerIndex]]));
    const rowNumber = index + 1;
    const animalLookup = getCell(row, requiredHeaders.animalLookup);
    const alleleLookup = getCell(row, requiredHeaders.alleleLookup);
    const rawCall = getCell(row, ["zygosity", "call", "genotype_call", "genotype", "result"]);
    const status = normalizeStatus(getCell(row, ["status", "call_status", "result_status"]), rawCall);
    const zygosity = normalizeZygosity(rawCall, status);
    const sampleDate = getCell(row, requiredHeaders.sampleDate);
    const resultDate = getCell(row, requiredHeaders.resultDate);
    const sourceType = getCell(row, ["source_type", "source"]) || (getCell(row, ["provider", "vendor"]) ? "external vendor" : "manual PCR");
    const assayType = getCell(row, ["assay_type", "assay", "assay_name", "test"]) || "CSV import";
    const resultText =
      getCell(row, ["result_text", "result_summary", "notes", "comment", "report"]) ||
      (rawCall ? `Imported CSV call: ${rawCall.trim()}.` : "Imported CSV genotype result.");
    const confidence = getCell(row, ["confidence", "confidence_level"]) || undefined;
    const provider = getCell(row, ["provider", "vendor"]) || undefined;
    const sampleId = getCell(row, ["sample_id", "sample", "tube_id", "specimen_id"]) || undefined;

    if (!animalLookup || !alleleLookup || !sampleDate || !resultDate || !zygosity) {
      errors.push(`Row ${rowNumber}: animal, allele, call, sample date, and result date are required.`);
      continue;
    }

    rows.push({
      rowNumber,
      animalLookup,
      alleleLookup,
      zygosity,
      status,
      sourceType,
      assayType,
      sampleDate,
      resultDate,
      resultText,
      confidence,
      provider,
      sampleId,
    });
  }

  if (!rows.length && !errors.length) {
    errors.push("No valid genotype rows were found in the uploaded CSV.");
  }

  return { rows, errors };
}

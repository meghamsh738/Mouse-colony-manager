import { describe, expect, it } from "vitest";

import { parseGenotypeImportCsv } from "@/lib/genotype-import";

describe("genotype import parsing", () => {
  it("parses vendor-style headers and normalizes positive or negative calls", () => {
    const csv = [
      "subject_id,marker,call,status,source,assay,sample_date,result_date,result_text,provider,confidence,sample_id",
      "CM-25009,CreER,positive,confirmed,manual PCR,gel PCR,2026-04-09,2026-04-09,Expected positive band,,high,PCR-25009",
      "MC-2026-013,CreER,negative,confirmed,external vendor,Transnetyx panel,2026-04-09,2026-04-09,Expected negative vendor call,Transnetyx,high,TX-26013",
    ].join("\n");

    const parsed = parseGenotypeImportCsv(csv);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      animalLookup: "CM-25009",
      alleleLookup: "CreER",
      zygosity: "+/-",
      status: "confirmed",
    });
    expect(parsed.rows[1]).toMatchObject({
      animalLookup: "MC-2026-013",
      alleleLookup: "CreER",
      zygosity: "WT/WT",
      provider: "Transnetyx",
    });
  });

  it("fails fast when required headers are missing", () => {
    const csv = ["marker,call,result_text", "CreER,+/-,Incomplete row"].join("\n");

    const parsed = parseGenotypeImportCsv(csv);

    expect(parsed.rows).toEqual([]);
    expect(parsed.errors[0]).toContain("Missing required headers");
  });
});

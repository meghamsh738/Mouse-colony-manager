import { describe, expect, it } from "vitest";

import { formatRuleDisplayValue, formatRuleEditorValue } from "@/lib/rule-config";

describe("rule config formatting", () => {
  it("renders object-backed fertility profiles without object placeholders", () => {
    const profiles = [
      {
        strainId: "strain-creer",
        label: "Cx3cr1-CreER maintenance",
        litterSizeMultiplier: 0.95,
        probabilityMultiplier: 1,
        surplusPenaltyMultiplier: 1.05,
      },
      {
        strainId: "strain-cas9",
        label: "Tmem119-Cas9",
        litterSizeMultiplier: 0.85,
        probabilityMultiplier: 0.9,
        surplusPenaltyMultiplier: 1.2,
      },
    ];

    const displayValue = formatRuleDisplayValue(profiles);
    const editorValue = formatRuleEditorValue("json", profiles);

    expect(displayValue).toContain("Cx3cr1-CreER maintenance (litter x0.95, genotype x1, surplus x1.05)");
    expect(displayValue).toContain("Tmem119-Cas9 (litter x0.85, genotype x0.9, surplus x1.2)");
    expect(displayValue).not.toContain("[object Object]");
    expect(editorValue).toContain('"strainId": "strain-creer"');
    expect(editorValue).not.toContain("[object Object]");
  });

  it("keeps simple json note arrays easy to edit line by line", () => {
    expect(formatRuleDisplayValue(["One note", "Second note"])).toBe("One note; Second note");
    expect(formatRuleEditorValue("json", ["One note", "Second note"])).toBe("One note\nSecond note");
  });
});

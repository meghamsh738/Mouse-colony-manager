export function formatRuleDisplayValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join("; ");
  }

  if (value === null || value === undefined) {
    return "Not set";
  }

  return String(value);
}

export function formatRuleEditorValue(valueType: string, value: unknown) {
  switch (valueType) {
    case "json":
      if (Array.isArray(value)) {
        return value.map((entry) => String(entry)).join("\n");
      }

      return value === null || value === undefined ? "" : JSON.stringify(value, null, 2);
    case "boolean":
      return value ? "true" : "false";
    default:
      return value === null || value === undefined ? "" : String(value);
  }
}

export function parseRuleInputValue(valueType: string, valueInput: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = valueInput.trim();

  switch (valueType) {
    case "number": {
      if (!trimmed) {
        return { ok: false, message: "Enter a numeric threshold value." };
      }

      const parsed = Number(trimmed);

      if (!Number.isFinite(parsed) || parsed < 0) {
        return { ok: false, message: "Threshold values must be zero or greater." };
      }

      return { ok: true, value: parsed };
    }
    case "boolean": {
      if (trimmed !== "true" && trimmed !== "false") {
        return { ok: false, message: "Choose either enabled or disabled for this rule." };
      }

      return { ok: true, value: trimmed === "true" };
    }
    case "json": {
      if (!trimmed) {
        return { ok: true, value: [] };
      }

      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
          return { ok: true, value: JSON.parse(trimmed) };
        } catch {
          return { ok: false, message: "Enter valid JSON or one note per line." };
        }
      }

      return {
        ok: true,
        value: trimmed
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      };
    }
    default: {
      if (!trimmed) {
        return { ok: false, message: "Enter a value before saving." };
      }

      return { ok: true, value: trimmed };
    }
  }
}

export function getRuleEditorHint(valueType: string) {
  switch (valueType) {
    case "number":
      return "Use a whole-number threshold.";
    case "boolean":
      return "Toggle whether this policy is allowed or blocked.";
    case "json":
      return "Enter one note per line, or paste valid JSON.";
    default:
      return "Update the stored rule value.";
  }
}

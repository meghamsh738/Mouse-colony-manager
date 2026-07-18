import { describe, expect, it } from "vitest";

import {
  formatMinorCurrency,
  isSupportedCurrencyCode,
  normalizeCurrencyCode,
  parseCurrencyToMinorUnits,
} from "@/lib/currency";

describe("currency input parsing", () => {
  it.each([
    ["$2.50", 250],
    ["2.50", 250],
    ["2.5", 250],
    ["2", 200],
    ["1,234.56", 123456],
    [0, 0],
  ])("converts %s to exact integer minor units", (input, expected) => {
    expect(parseCurrencyToMinorUnits(input)).toBe(expected);
  });

  it.each(["2.505", "-1.00", "two", "", null])("rejects invalid or missing input %s", (input) => {
    expect(Number.isNaN(parseCurrencyToMinorUnits(input))).toBe(true);
  });

  it("accepts a legacy integer-cent fallback only when the visible field is empty", () => {
    expect(parseCurrencyToMinorUnits("", "250")).toBe(250);
    expect(Number.isNaN(parseCurrencyToMinorUnits("2.505", "250"))).toBe(true);
  });

  it("normalizes supported ISO currency codes and rejects arbitrary three-character values", () => {
    expect(normalizeCurrencyCode("usd")).toBe("USD");
    expect(isSupportedCurrencyCode("EUR")).toBe(true);
    expect(isSupportedCurrencyCode("123")).toBe(false);
    expect(isSupportedCurrencyCode("ZZZ")).toBe(false);
  });

  it("renders legacy invalid currency data without throwing or mislabeling it as USD", () => {
    expect(() => formatMinorCurrency(250, "123")).not.toThrow();
    expect(formatMinorCurrency(250, "123")).toBe("2.50 123");
    expect(formatMinorCurrency(250, "ZZZ")).toBe("2.50 ZZZ");
  });
});

function scalarText(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
}

export const SUPPORTED_BILLING_CURRENCY_CODES = [
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL",
  "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY",
  "COP", "CRC", "CUC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD",
  "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP",
  "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG", "HUF", "IDR",
  "ILS", "INR", "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS",
  "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR",
  "LRD", "LSL", "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP",
  "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO",
  "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN",
  "PYG", "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG",
  "SEK", "SGD", "SHP", "SLE", "SLL", "SOS", "SRD", "SSP", "STN", "SVC",
  "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD",
  "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VES", "VND", "VUV", "WST",
  "XAF", "XCD", "XCG", "XDR", "XOF", "XPF", "XSU", "YER", "ZAR", "ZMW",
  "ZWG", "ZWL",
] as const;

const supportedCurrencyCodes = new Set<string>(SUPPORTED_BILLING_CURRENCY_CODES);

export function normalizeCurrencyCode(value: unknown) {
  const code = scalarText(value).toUpperCase();
  return /^[A-Z]{3}$/.test(code) && supportedCurrencyCodes.has(code) ? code : null;
}

export function isSupportedCurrencyCode(value: unknown) {
  return normalizeCurrencyCode(value) !== null;
}

export function formatMinorCurrency(cents: number, currencyCode: unknown = "USD") {
  const normalizedCode = normalizeCurrencyCode(currencyCode);
  if (!normalizedCode) {
    const legacyCode = scalarText(currencyCode).toUpperCase() || "UNKNOWN";
    return `${(cents / 100).toFixed(2)} ${legacyCode}`;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: normalizedCode,
  }).format(cents / 100);
}

export function parseCurrencyToMinorUnits(value: unknown, fallbackMinorUnits?: unknown) {
  const rawValue = scalarText(value);

  if (rawValue) {
    const normalizedValue = rawValue.replaceAll(/[$,\s]/g, "");
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalizedValue);

    if (!match) return Number.NaN;
    const wholeUnits = Number(match[1]);
    const minorUnits = Number((match[2] ?? "").padEnd(2, "0") || "0");
    const total = wholeUnits * 100 + minorUnits;
    return Number.isSafeInteger(total) ? total : Number.NaN;
  }

  const fallbackText = scalarText(fallbackMinorUnits);
  if (!fallbackText) return Number.NaN;
  const fallback = Number(fallbackText);
  return Number.isSafeInteger(fallback) && fallback >= 0 ? fallback : Number.NaN;
}

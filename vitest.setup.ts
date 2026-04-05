import "@testing-library/jest-dom/vitest";

process.loadEnvFile?.(".env");
process.env.COLONY_REFERENCE_DATE = "2026-04-05T09:00:00.000Z";

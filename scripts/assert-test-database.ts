import { assertDestructiveSeedAllowed } from "../src/lib/destructive-seed-guard";

export function assertTestDatabaseTarget() {
  assertDestructiveSeedAllowed();
}

if (process.argv[1]?.endsWith("assert-test-database.ts")) {
  try {
    assertTestDatabaseTarget();
    console.log("Loopback disposable test schema confirmed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

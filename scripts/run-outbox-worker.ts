import { runOutboxWorkerOnce, type PortableOutboxWorkerType } from "../src/lib/notification-delivery";
import { prisma } from "../src/lib/prisma";

const TOKEN_ENV: Record<PortableOutboxWorkerType, string> = {
  notification_delivery: "OUTBOX_WORKER_TOKEN_NOTIFICATION_DELIVERY",
  sop_delivery: "OUTBOX_WORKER_TOKEN_SOP_DELIVERY",
};

function optionalNumber(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main() {
  const rawWorkerType = process.env.OUTBOX_WORKER_TYPE?.trim();
  if (rawWorkerType !== "notification_delivery" && rawWorkerType !== "sop_delivery") {
    console.log(JSON.stringify({
      outcome: "configuration_error",
      exitCode: 2,
      message: "OUTBOX_WORKER_TYPE must be notification_delivery or sop_delivery.",
    }));
    process.exitCode = 2;
    return;
  }
  const workerType = rawWorkerType;
  const summary = await runOutboxWorkerOnce({
    workerType,
    workerId: process.env.OUTBOX_WORKER_ID?.trim() || `${workerType}:${process.pid}`,
    token: process.env[TOKEN_ENV[workerType]]?.trim() ?? "",
    batchSize: optionalNumber("OUTBOX_WORKER_BATCH_SIZE"),
    concurrency: optionalNumber("OUTBOX_WORKER_CONCURRENCY"),
    providerTimeoutMs: optionalNumber("OUTBOX_WORKER_PROVIDER_TIMEOUT_MS"),
    runTimeoutMs: optionalNumber("OUTBOX_WORKER_RUN_TIMEOUT_MS"),
    leaseMs: optionalNumber("OUTBOX_WORKER_LEASE_MS"),
    maintenanceLimit: optionalNumber("OUTBOX_WORKER_MAINTENANCE_LIMIT"),
  });
  console.log(JSON.stringify(summary));
  process.exitCode = summary.exitCode;
}

main()
  .catch(() => {
    console.log(JSON.stringify({
      outcome: "worker_error",
      exitCode: 1,
      message: "The outbox worker did not complete. Review private application logs.",
    }));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

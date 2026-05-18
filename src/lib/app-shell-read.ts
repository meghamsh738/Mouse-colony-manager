import { prisma } from "@/lib/prisma";

export async function getAppShellStatusView() {
  const openAlerts = await prisma.alert.count({
    where: {
      status: "open",
    },
  });

  return { openAlerts };
}

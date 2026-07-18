"use client";

import { RouteErrorFallback } from "@/components/app/route-error-fallback";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorFallback
      message="Dashboard data could not load. You can retry or jump straight to the staff workflows."
      reset={reset}
      title="Dashboard unavailable"
    />
  );
}

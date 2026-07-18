"use client";

import { RouteErrorFallback } from "@/components/app/route-error-fallback";

export default function ForecastError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteErrorFallback
      message="Forecast data could not load. You can retry or continue with the core colony workflows."
      reset={reset}
      title="Forecast unavailable"
    />
  );
}

"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Print labels" }: { label?: string }) {
  return (
    <Button data-testid="print-labels-button" onClick={() => window.print()} type="button">
      <Printer aria-hidden="true" size={16} />
      {label}
    </Button>
  );
}

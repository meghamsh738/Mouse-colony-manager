import { Badge } from "@/components/ui/badge";
import type { FormActionState } from "@/lib/form-state";

export function FormFeedback({ state }: { state: FormActionState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--ink)]"
    >
      <div className="flex items-start gap-3">
        <Badge variant={state.status === "success" ? "success" : "danger"}>{state.status}</Badge>
        <p className="leading-6">{state.message}</p>
      </div>
    </div>
  );
}

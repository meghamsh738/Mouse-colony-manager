import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type WorkflowStep = {
  id: string;
  label: string;
};

export function WorkflowSteps({
  currentStep,
  steps,
}: {
  currentStep: string;
  steps: WorkflowStep[];
}) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === currentStep));

  return (
    <ol aria-label="Workflow progress" className="workflow-steps">
      {steps.map((step, index) => (
        <li
          aria-current={index === currentIndex ? "step" : undefined}
          className={cn(index === currentIndex && "is-current", index < currentIndex && "is-complete")}
          key={step.id}
        >
          <span aria-hidden="true">{index + 1}</span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}

export function WorkflowImpact({
  children,
  title,
  tone = "danger",
}: {
  children: ReactNode;
  title: string;
  tone?: "danger" | "warning" | "financial";
}) {
  return (
    <section aria-label="Change impact" className={cn("workflow-impact", `workflow-impact-${tone}`)}>
      <strong>{title}</strong>
      <div className="mt-1">{children}</div>
    </section>
  );
}

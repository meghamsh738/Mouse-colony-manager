"use client";

import { useActionState } from "react";

import { updateRuleConfigAction } from "@/app/settings/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";
import { getRuleEditorHint } from "@/lib/rule-config";

type RuleConfigEditorProps = {
  rules: Array<{
    id: string;
    key: string;
    label: string;
    description: string;
    category: string;
    valueType: string;
    displayValue: string;
    editorValue: string;
    criticalBlock: boolean;
  }>;
};

const categoryLabels: Record<string, string> = {
  breeding: "Breeding",
  capacity: "Capacity",
  compliance: "Compliance",
  experiment: "Experiment",
  genotype: "Genotype",
  welfare: "Welfare",
};

function RuleEditorCard({
  rule,
}: {
  rule: RuleConfigEditorProps["rules"][number];
}) {
  const [state, formAction, pending] = useActionState(updateRuleConfigAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-2xl border border-[var(--line)] bg-white/70 p-4"
      data-testid={`rule-form-${rule.key}`}
      onSubmit={handleSubmit}
    >
      <input name="ruleId" type="hidden" value={rule.id} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-[var(--ink)]">{rule.label}</p>
          <p className="text-sm leading-6 text-[var(--muted)]">{rule.description}</p>
        </div>
        <div className="max-w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs leading-5 text-[var(--muted)] md:max-w-[22rem]">
          {rule.displayValue}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Value</span>
          {rule.valueType === "boolean" ? (
            <select
              className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-base text-[var(--ink)] md:text-sm"
              data-testid={`rule-value-${rule.key}`}
              defaultValue={rule.editorValue}
              name="valueInput"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          ) : rule.valueType === "json" ? (
            <textarea
              className="min-h-36 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-3 font-mono text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
              data-testid={`rule-value-${rule.key}`}
              defaultValue={rule.editorValue}
              name="valueInput"
            />
          ) : (
            <Input
              data-testid={`rule-value-${rule.key}`}
              defaultValue={rule.editorValue}
              name="valueInput"
              type={rule.valueType === "number" ? "number" : "text"}
            />
          )}
          <p className="text-xs leading-5 text-[var(--muted)]">{getRuleEditorHint(rule.valueType)}</p>
        </label>
        <label className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--muted)]">
          <input
            data-testid={`rule-critical-${rule.key}`}
            defaultChecked={rule.criticalBlock}
            name="criticalBlock"
            type="checkbox"
          />
          Block when breached
        </label>
      </div>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-3">
        <Button className="relative z-10 w-full sm:w-auto" data-testid={`rule-save-${rule.key}`} disabled={pending} type="submit">
          {pending ? "Saving rule..." : "Save rule"}
        </Button>
      </div>
    </form>
  );
}

export function RuleConfigEditor({ rules }: RuleConfigEditorProps) {
  const groupedRules = rules.reduce<Record<string, RuleConfigEditorProps["rules"]>>((groups, rule) => {
    const existing = groups[rule.category] ?? [];
    existing.push(rule);
    groups[rule.category] = existing;
    return groups;
  }, {});

  return (
    <div className="space-y-5">
      {Object.entries(groupedRules).map(([category, categoryRules]) => (
        <section key={category} className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)] pb-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{categoryLabels[category] ?? category}</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                {categoryRules.length} {categoryRules.length === 1 ? "rule" : "rules"}
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-[var(--muted)]">
              Save each rule independently so high-impact threshold changes stay traceable in the audit log.
            </p>
          </div>
          <div className="space-y-3">
            {categoryRules.map((rule) => (
              <RuleEditorCard key={`${rule.id}-${rule.editorValue}-${rule.criticalBlock}`} rule={rule} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

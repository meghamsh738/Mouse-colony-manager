import Link from "next/link";
import {
  ArrowRight,
  Beaker,
  Boxes,
  Building2,
  Check,
  ClipboardCheck,
  FlaskConical,
  QrCode,
  Receipt,
  Search,
  ShieldAlert,
  Snowflake,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import type { PersonaQueueItem, OnboardingStep } from "@/lib/persona-dashboard-read";
import type { CanonicalUserRole } from "@/lib/types";

type Command = {
  href: string;
  icon: typeof QrCode;
  label: string;
};

function personaDefinition(input: {
  activeLabName?: string | null;
  canManageColony: boolean;
  role: CanonicalUserRole;
}) {
  if (input.role === "facility_admin") {
    return {
      eyebrow: "Facility administration",
      title: "Facility oversight",
      commands: [
        { href: "/approvals", label: "Review approvals", icon: ClipboardCheck },
        { href: "/administration/labs", label: "Labs", icon: Building2 },
        { href: "/administration/users", label: "Users", icon: Users },
        { href: "/billing", label: "Billing", icon: Receipt },
      ] satisfies Command[],
    };
  }
  if (input.role === "cmu_staff") {
    return {
      eyebrow: "Facility operations",
      title: "Daily operations",
      commands: [
        { href: "/scan", label: "Scan cage", icon: QrCode },
        { href: "/cages/intake?mode=new", label: "Cage intake", icon: Boxes },
        { href: "/quarantine", label: "Quarantine", icon: ShieldAlert },
        { href: "/cryostorage", label: "Cryostorage", icon: Snowflake },
      ] satisfies Command[],
    };
  }
  return {
    eyebrow: input.activeLabName ?? "Active lab",
    title: "Lab workspace",
    commands: [
      { href: "/animals", label: "Find mouse", icon: Search },
      { href: "/cages", label: "Cages", icon: Boxes },
      ...(input.canManageColony ? [{ href: "/cages/intake?mode=new", label: "Cage intake", icon: Beaker }] : []),
      { href: "/experiments", label: "Experiments", icon: FlaskConical },
    ] satisfies Command[],
  };
}

function queueBadge(item: PersonaQueueItem) {
  if (item.tone === "danger") return "danger" as const;
  if (item.tone === "warning") return "warning" as const;
  if (item.tone === "info") return "info" as const;
  return "neutral" as const;
}

export function PersonaDashboard({
  activeLabName,
  canManageColony,
  onboarding,
  queue,
  role,
}: {
  activeLabName?: string | null;
  canManageColony: boolean;
  onboarding: OnboardingStep[];
  queue: PersonaQueueItem[];
  role: CanonicalUserRole;
}) {
  const definition = personaDefinition({ activeLabName, canManageColony, role });
  const incompleteOnboarding = onboarding.filter((step) => !step.complete);

  return <>
    <PageHeader eyebrow={definition.eyebrow} title={definition.title} />

    <section className="dashboard-command-deck" aria-label="Primary actions">
      <div className="dashboard-command-actions">
        {definition.commands.map((command, index) => {
          const Icon = command.icon;
          return <Link className={index === 0 ? "dashboard-primary-command" : "dashboard-secondary-command"} href={command.href} key={command.href}>
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span>{command.label}</span>
            {index === 0 ? <ArrowRight className="ml-auto h-4 w-4" aria-hidden="true" /> : null}
          </Link>;
        })}
      </div>
      <div className="dashboard-command-context">
        <span>{queue.reduce((sum, item) => sum + item.count, 0) ? "Work waiting" : "Queue clear"}</span>
        <Link href={queue.find((item) => item.count)?.href ?? definition.commands[0].href}>
          {queue.reduce((sum, item) => sum + item.count, 0) ? "Open next task" : "Start work"}
        </Link>
      </div>
    </section>

    <section className="dashboard-lane" aria-labelledby="persona-work-queue">
      <div className="dashboard-lane-header">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="persona-work-queue">Work queue</h2>
          <span className="lane-count">{queue.reduce((sum, item) => sum + item.count, 0)}</span>
        </div>
      </div>
      <div className="dashboard-row-list">
        {queue.map((item) => <Link className="dashboard-data-row" href={item.href} key={item.id}>
          <span className="dashboard-row-title">{item.label}</span>
          <Badge variant={queueBadge(item)}>{item.count}</Badge>
          <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
        </Link>)}
      </div>
    </section>

    {onboarding.length && incompleteOnboarding.length ? <section className="dashboard-lane" aria-labelledby="setup-progress">
      <div className="dashboard-lane-header">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="setup-progress">Setup progress</h2>
          <span className="lane-count">{onboarding.length - incompleteOnboarding.length}/{onboarding.length}</span>
        </div>
        <Link href={incompleteOnboarding[0].href}>Continue setup</Link>
      </div>
      <div className="dashboard-row-list">
        {onboarding.map((step) => <Link className="dashboard-data-row" data-complete={step.complete || undefined} href={step.href} key={step.id}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--line-strong)]" aria-hidden="true">{step.complete ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : null}</span>
          <span className="dashboard-row-title">{step.label}</span>
          <span className="dashboard-row-meta">{step.complete ? "Ready" : "Next"}</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
        </Link>)}
      </div>
    </section> : null}
  </>;
}

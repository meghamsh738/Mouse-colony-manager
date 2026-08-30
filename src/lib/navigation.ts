import type { Capability, CapabilityActor } from "@/lib/capabilities";
import { actorHasCapability } from "@/lib/capabilities";

export type NavigationItemId =
  | "dashboard"
  | "scan"
  | "animals"
  | "cages"
  | "quarantine"
  | "welfare"
  | "corrections"
  | "reconciliation"
  | "breeding"
  | "experiments"
  | "procedures"
  | "sops"
  | "biosamples"
  | "forecast"
  | "strains"
  | "cryostorage"
  | "approvals"
  | "billing"
  | "notifications"
  | "workbook"
  | "rules"
  | "labs"
  | "users"
  | "duties"
  | "compliance"
  | "system";

export type NavigationItem = {
  id: NavigationItemId;
  href: string;
  label: string;
  group: "Home" | "Colony" | "Research" | "Facility" | "Administration" | "Technical";
  capability: Capability;
  mobilePrimary?: boolean;
};

export const navigationRegistry: NavigationItem[] = [
  { id: "dashboard", href: "/", label: "Dashboard", group: "Home", capability: "dashboard:view", mobilePrimary: true },
  { id: "scan", href: "/scan", label: "Scan", group: "Colony", capability: "scan:use", mobilePrimary: true },
  { id: "animals", href: "/animals", label: "Animals", group: "Colony", capability: "animals:read", mobilePrimary: true },
  { id: "cages", href: "/cages", label: "Cages", group: "Colony", capability: "cages:read", mobilePrimary: true },
  { id: "quarantine", href: "/quarantine", label: "Quarantine", group: "Colony", capability: "quarantine:read" },
  { id: "welfare", href: "/welfare", label: "Welfare cases", group: "Facility", capability: "welfare:read" },
  { id: "corrections", href: "/corrections", label: "Controlled corrections", group: "Facility", capability: "corrections:read" },
  { id: "reconciliation", href: "/reconciliation", label: "Operational reconciliation", group: "Facility", capability: "reconciliation:read" },
  { id: "breeding", href: "/breeding", label: "Breeding", group: "Research", capability: "breeding:read" },
  { id: "experiments", href: "/experiments", label: "Experiments", group: "Research", capability: "experiments:read" },
  { id: "procedures", href: "/procedures", label: "Procedures", group: "Research", capability: "procedures:operational" },
  { id: "sops", href: "/sops", label: "SOPs", group: "Research", capability: "sops:read" },
  { id: "biosamples", href: "/samples", label: "Biosamples", group: "Research", capability: "biosamples:read" },
  { id: "forecast", href: "/forecast", label: "Forecast", group: "Research", capability: "forecast:read" },
  { id: "strains", href: "/strains", label: "Strain directory", group: "Research", capability: "strains:discover" },
  { id: "cryostorage", href: "/cryostorage", label: "Cryostorage", group: "Facility", capability: "cryostorage:read" },
  { id: "approvals", href: "/approvals", label: "Approvals", group: "Facility", capability: "approvals:read" },
  { id: "billing", href: "/billing", label: "Billing", group: "Facility", capability: "billing:read" },
  { id: "notifications", href: "/notifications", label: "Notifications", group: "Facility", capability: "notifications:read" },
  { id: "workbook", href: "/workbook", label: "Workbook", group: "Facility", capability: "workbook:read" },
  { id: "rules", href: "/settings", label: "Facility rules", group: "Administration", capability: "rules:manage" },
  { id: "labs", href: "/administration/labs", label: "Labs", group: "Administration", capability: "labs:manage" },
  { id: "users", href: "/administration/users", label: "Users", group: "Administration", capability: "users:manage" },
  { id: "duties", href: "/administration/duties", label: "Facility duties", group: "Administration", capability: "duties:manage" },
  { id: "compliance", href: "/administration/compliance", label: "Protocol compliance", group: "Administration", capability: "dashboard:view" },
  { id: "system", href: "/system", label: "Technical console", group: "Technical", capability: "system:view", mobilePrimary: true },
];

export function getNavigationForActor(actor: CapabilityActor) {
  return navigationRegistry.filter((item) => actorHasCapability(actor, item.capability));
}

export function requiredCapabilityForPath(path: string): Capability | null {
  const candidates = navigationRegistry
    .filter((item) => item.href === "/" ? path === "/" : path === item.href || path.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length);

  return candidates[0]?.capability ?? null;
}

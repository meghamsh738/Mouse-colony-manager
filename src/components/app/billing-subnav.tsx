import Link from "next/link";

import { cn } from "@/lib/utils";

const billingNavItems = [
  { href: "/billing", label: "Overview" },
  { href: "/billing/rates", label: "Rates" },
  { href: "/billing/invoices", label: "Invoices" },
];

function isActive(currentPath: string, href: string) {
  if (href === "/billing") {
    return currentPath === href;
  }

  return currentPath === href || currentPath.startsWith(`${href}/`);
}

export function BillingSubnav({ currentPath }: { currentPath: string }) {
  return (
    <nav
      aria-label="Billing sections"
      className="billing-subnav"
    >
      {billingNavItems.map((item) => {
        const active = isActive(currentPath, item.href);

        return (
          <Link
            key={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "billing-subnav-link",
              active
                ? "is-active"
                : "text-[var(--muted)] hover:text-[var(--ink)]",
            )}
            href={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

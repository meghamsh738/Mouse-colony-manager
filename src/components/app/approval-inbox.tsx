import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import type { ApprovalInboxItem } from "@/lib/approval-inbox-read";
import { formatDate } from "@/lib/utils";

function badgeVariant(tone: ApprovalInboxItem["tone"]) {
  if (tone === "danger") return "danger" as const;
  if (tone === "warning") return "warning" as const;
  return "info" as const;
}

export function ApprovalInbox({ items }: { items: ApprovalInboxItem[] }) {
  return (
    <WorksheetShell
      eyebrow="Decision inbox"
      summary={<span>{items.length} items requiring your authority</span>}
      title="Awaiting your review"
    >
      {items.length ? (
        <div className="row-list" data-testid="approval-inbox">
          {items.map((item) => (
            <article className="record-row" id={`approval-${item.id.replace(":", "-")}`} key={item.id}>
              <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant={badgeVariant(item.tone)}>{item.category}</Badge>
                    <strong className="wrap-value">{item.title}</strong>
                  </div>
                  <p className="mt-1 wrap-value text-sm text-[var(--muted)]">{item.detail}</p>
                  <p className="mt-2 text-xs text-[var(--muted)]">{item.scope} · {item.stage} · {formatDate(item.requestedAt)}</p>
                </div>
                <Link className="table-action min-h-11" href={item.href}>
                  Review <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="worksheet-empty"><strong>Queue clear</strong><p>No decisions currently require your authority.</p></div>
      )}
    </WorksheetShell>
  );
}

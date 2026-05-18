"use client";

import { Button } from "@/components/ui/button";

export const INITIAL_VISIBLE_RECORDS = 80;
export const VISIBLE_RECORD_BATCH = 80;

type VisibleRecordControlsProps = {
  matchingCount: number;
  noun: string;
  onShowAll: () => void;
  onShowMore: () => void;
  totalCount: number;
  visibleCount: number;
};

export function VisibleRecordControls({
  matchingCount,
  noun,
  onShowAll,
  onShowMore,
  totalCount,
  visibleCount,
}: VisibleRecordControlsProps) {
  if (matchingCount <= visibleCount) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted)]">
      <span>
        Rendering <span className="font-medium text-[var(--ink)]">{visibleCount}</span> of{" "}
        <span className="font-medium text-[var(--ink)]">{matchingCount}</span> matching {noun}
        {matchingCount === totalCount ? "" : ` from ${totalCount} total`}.
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="subtle" onClick={onShowMore}>
          Show {Math.min(VISIBLE_RECORD_BATCH, matchingCount - visibleCount)} more
        </Button>
        <Button type="button" variant="subtle" onClick={onShowAll}>
          Show all matching
        </Button>
      </div>
    </div>
  );
}

type AttachmentListProps = {
  attachments: Array<{
    id: string;
    label: string;
    fileName: string;
    fileType: string;
    storageUrl: string;
  }>;
  label?: string;
  testId?: string;
};

export function AttachmentList({ attachments, label = "Attachments", testId }: AttachmentListProps) {
  if (!attachments.length) {
    return null;
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">{label}</p>
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment) => (
          <a
            key={attachment.id}
            className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-white"
            href={attachment.storageUrl}
            rel="noreferrer"
            target="_blank"
          >
            <span className="block font-medium">{attachment.label}</span>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              {attachment.fileName} · {attachment.fileType}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

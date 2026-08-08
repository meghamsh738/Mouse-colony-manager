type RouteLoadingStateProps = {
  currentPath: string;
  eyebrow: string;
  title: string;
  rows?: number;
};

export function RouteLoadingState({ currentPath, eyebrow, title, rows = 5 }: RouteLoadingStateProps) {
  return (
    <main
      aria-busy="true"
      aria-label={`Loading ${title}`}
      className="app-main-content mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8"
      data-current-path={currentPath}
    >
      <header className="space-y-3">
        <p className="section-kicker">{eyebrow}</p>
        <div className="h-9 w-44 animate-pulse rounded-xl bg-[var(--surface-2)]" />
        <p className="sr-only">Loading {title}</p>
      </header>
      <section className="overflow-hidden rounded-[1.35rem] border border-[var(--line)] bg-white/60" aria-hidden="true">
        <div className="h-12 border-b border-[var(--line)] bg-[var(--surface-2)]" />
        <div className="space-y-3 p-4">
          {Array.from({ length: rows }, (_, index) => (
            <div className="h-11 animate-pulse rounded-xl bg-[var(--surface-2)]" key={index} />
          ))}
        </div>
      </section>
    </main>
  );
}

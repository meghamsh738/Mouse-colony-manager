# Performance review and implementation plan

Source: ChatGPT Pro source-only review of commit `5de2a7a` on 2026-08-08. The
review did not run the app, so rankings are based on inspected source patterns,
not measured production timings. It applies only to the synthetic local QA
environment; no real colony data is involved.

## Main finding

The perceived slowness has two causes:

1. Development builds intentionally use Webpack. This can make cold route
   compilation slow, especially because the repository documents a Node 26
   Turbopack worker issue. Webpack and Node 22 remain the supported local QA
   path until that is resolved.
2. Several production-runtime patterns do extra work: repeated actor and lab
   access reads, an alert query that delays the shared app shell, broad list
   reads, a transfer-workspace N+1 query, large interactive tables, and broad
   route invalidation.

Changing bundlers alone would only address the first category.

## Ranked findings

| Rank | Finding | Impact / confidence |
| --- | --- | --- |
| 1 | Protected routes repeatedly resolve authentication, actor, membership, and shell status. | High / very high |
| 2 | Lists and histories can read broad nested relations and serialize more than is visible. | Very high as data grows / very high |
| 3 | Some read paths are sequential or duplicated; the transfer workspace reads destination cages once per request. | High / high |
| 4 | Some tables hydrate both responsive presentations and mount row editors before they are opened. | High / very high |
| 5 | Sparse route loading feedback, full document scanner navigation, and broad revalidation make the app feel slower. | Medium runtime / high confidence |

## Safe first pass

The first implementation pass must preserve all current authorization,
audit, privacy, command, and migration protections. It needs no schema change
or product decision:

- Request-deduplicate actor resolution with `React.cache()`.
- Reuse the already database-validated memberships for ordinary read renders,
  while preserving a database lookup within write transactions.
- Stream the app shell's non-critical alert status behind `Suspense`.
- Do not load create-form option data when the user has no matching capability.
- Batch transfer destination-cage reads by destination lab.
- Use App Router navigation after a barcode scan instead of a full-document
  reload.
- Add lightweight loading states to the main operational routes.

## Later work requiring a separate decision or measurement gate

- Whole-dataset server-side search/pagination (recommended default: page size
  80, hard maximum 100).
- Bounded detail histories with an explicit “Load older” action (recommended
  initial limit: 50 per history type).
- Replacing the Workbook's full overview with summary projections.
- Composite database indexes only after query-plan evidence.
- Narrowing mutation revalidation only after documenting affected projections.
- Any persistent or briefly stale cache for actor-scoped inventory, health,
  transfer, billing, or alert data. These records stay request-fresh by
  default.

## Measurement gate

After the safe pass, compare the same disposable PostgreSQL snapshot in cold
and warm Webpack development, optional Node 22 Turbopack experiments, and a
production build. Measure `/`, `/animals`, `/cages`, `/samples`,
`/cryostorage`, `/workbook`, `/approvals`, and `/scan/<test-barcode>` at
desktop and 390 px width. Record route completion, visible loading feedback,
top-level query count, RSC bytes, client JavaScript, hydration, long tasks,
and search responsiveness. Temporary instrumentation must not log animal IDs,
health notes, lab names, SQL parameters, or other colony data.

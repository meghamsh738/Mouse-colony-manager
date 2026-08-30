"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Filter,
  QrCode,
  Search,
  Sheet,
} from "lucide-react";

import type {
  WorkbookBiosampleRow,
  WorkbookBreedingRow,
  WorkbookCryostorageRow,
  WorkbookExperimentGroup,
  WorkbookNavigation,
  WorkbookRoomGroup,
  WorkbookSection,
  WorkbookSheet,
  WorkbookState,
} from "@/lib/workbook-read";
import { workbookAppHref, workbookStateHref } from "@/lib/workbook-state";
import { cn } from "@/lib/utils";

const SECTION_LABELS: Record<WorkbookSection, string> = {
  overview: "Overview",
  rooms: "Rooms",
  breeding: "Breeding",
  experiments: "Experiments",
  biosamples: "Biosamples",
  cryostorage: "Cryostorage",
};

const SORT_OPTIONS: Record<WorkbookSection, Array<{ value: string; label: string }>> = {
  overview: [{ value: "priority", label: "Priority" }],
  rooms: [
    { value: "location", label: "Location" },
    { value: "cage", label: "Cage ID" },
    { value: "lab", label: "Lab" },
    { value: "occupancy", label: "Occupancy" },
    { value: "status", label: "Status" },
  ],
  breeding: [
    { value: "startDate", label: "Start date" },
    { value: "setup", label: "Setup ID" },
    { value: "line", label: "Mouse line" },
    { value: "status", label: "Status" },
    { value: "progeny", label: "Progeny" },
  ],
  experiments: [
    { value: "experiment", label: "Experiment" },
    { value: "group", label: "Treatment group" },
    { value: "status", label: "Status" },
    { value: "assignments", label: "Assignments" },
  ],
  biosamples: [
    { value: "collectedAt", label: "Collected date" },
    { value: "label", label: "Sample label" },
    { value: "animal", label: "Animal" },
    { value: "status", label: "Status" },
    { value: "storage", label: "Storage" },
  ],
  cryostorage: [
    { value: "storedAt", label: "Stored date" },
    { value: "label", label: "Label" },
    { value: "strain", label: "Strain" },
    { value: "status", label: "Status" },
    { value: "storage", label: "Storage" },
  ],
};

function appHref(state: WorkbookState, href = workbookAppHref(state.section)) {
  if (!state.labId) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}labId=${encodeURIComponent(state.labId)}`;
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function StatusCell({ value }: { value: string }) {
  return <span className={cn("workbook-status", `workbook-status-${value.replaceAll("_", "-")}`)}>{humanize(value)}</span>;
}

function EmptySheet({ message = "No records match this sheet." }: { message?: string }) {
  return (
    <div className="workbook-empty">
      <Sheet className="h-5 w-5" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function ExpandButton({ expanded, label, onClick }: { expanded: boolean; label: string; onClick: () => void }) {
  return (
    <button className="workbook-expand-button" type="button" onClick={onClick} aria-expanded={expanded} aria-label={label}>
      {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
    </button>
  );
}

function WorkbookHeader({ navigation, state }: { navigation: WorkbookNavigation; state: WorkbookState }) {
  const router = useRouter();

  return (
    <>
      <header className="workbook-titlebar">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--muted)]">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Colony workbook
          </div>
          <h1>{SECTION_LABELS[state.section]}</h1>
        </div>
        <div className="workbook-title-actions">
          <Link className="workbook-button workbook-button-primary" href="/scan">
            <QrCode aria-hidden="true" />
            Scan
          </Link>
          <Link className="workbook-button" href={appHref(state)}>
            <ArrowLeft aria-hidden="true" />
            App view
          </Link>
        </div>
      </header>

      <nav className="workbook-section-tabs" aria-label="Workbook sections">
        {navigation.allowedSections.map((section) => (
          <Link
            aria-current={state.section === section ? "page" : undefined}
            className={cn("workbook-section-tab", state.section === section && "is-active")}
            href={workbookStateHref(state, { section, sheet: "all", search: "", sort: "" })}
            key={section}
          >
            {SECTION_LABELS[section]}
          </Link>
        ))}
      </nav>

      {navigation.childSheets.length > 1 ? (
        <>
          <nav className="workbook-sheet-tabs" aria-label={`${SECTION_LABELS[state.section]} sheets`}>
            <span className="workbook-sheet-corner" aria-hidden="true" />
            {navigation.childSheets.map((sheet) => (
              <Link
                aria-current={state.sheet === sheet.id || (state.sheet === "all" && sheet.id === "all") ? "page" : undefined}
                className={cn("workbook-sheet-tab", (state.sheet === sheet.id || (state.sheet === "all" && sheet.id === "all")) && "is-active")}
                href={workbookStateHref(state, { sheet: sheet.id, search: "" })}
                key={sheet.id}
              >
                <span>{sheet.label}</span>
                {sheet.count !== undefined ? <span className="workbook-sheet-count">{sheet.count}</span> : null}
              </Link>
            ))}
          </nav>
          <label className="workbook-sheet-picker">
            <span>{SECTION_LABELS[state.section]} sheet</span>
            <select
              aria-label={`${SECTION_LABELS[state.section]} sheet`}
              onChange={(event) => router.push(workbookStateHref(state, { sheet: event.target.value, search: "" }))}
              value={state.sheet}
            >
              {navigation.childSheets.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.label}{sheet.count !== undefined ? ` (${sheet.count})` : ""}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}

      <form
        className="workbook-toolbar"
        key={`${state.section}:${state.sheet}:${state.search}:${state.sort}:${state.direction}:${state.history}:${state.labId ?? "all"}`}
        method="get"
        action="/workbook"
      >
        <input name="section" type="hidden" value={state.section} />
        <input name="sheet" type="hidden" value={state.sheet} />
        <label className="workbook-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search current sheet</span>
          <input defaultValue={state.search} name="search" placeholder="Search this sheet" type="search" />
        </label>
        {navigation.canFilterLabs ? (
          <label className="workbook-select-label">
            <span>Lab</span>
            <select defaultValue={state.labId ?? ""} name="labId">
              <option value="">All labs</option>
              {navigation.labs.map((lab) => <option value={lab.id} key={lab.id}>{lab.label}</option>)}
            </select>
          </label>
        ) : null}
        <label className="workbook-select-label">
          <span>Sort</span>
          <select defaultValue={state.sort} name="sort">
            {SORT_OPTIONS[state.section].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="workbook-select-label workbook-direction">
          <span>Order</span>
          <select defaultValue={state.direction} name="direction">
            <option value="asc">A to Z</option>
            <option value="desc">Z to A</option>
          </select>
        </label>
        <label className="workbook-history-toggle">
          <input defaultChecked={state.history} name="history" type="checkbox" value="1" />
          <span>Include history</span>
        </label>
        <button className="workbook-button workbook-button-filter" type="submit">
          <Filter aria-hidden="true" />
          Apply
        </button>
      </form>
    </>
  );
}

function OverviewSheet({ sheet, state }: { sheet: Extract<WorkbookSheet, { kind: "overview" }>; state: WorkbookState }) {
  return (
    <div className="workbook-overview">
      <section className="workbook-metric-grid" aria-label="Colony totals">
        {sheet.metrics.map((metric) => (
          <Link href={appHref(state, metric.href)} className="workbook-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </Link>
        ))}
      </section>
      <section className="workbook-overview-section">
        <div className="workbook-section-heading">
          <h2>Attention needed</h2>
          <Link href="/notifications">Open notifications <ExternalLink aria-hidden="true" /></Link>
        </div>
        {sheet.alerts.length ? (
          <div className="workbook-plain-rows">
            {sheet.alerts.map((alert) => (
              <Link className={cn("workbook-plain-row", `is-${alert.severity}`)} href={alert.href} key={alert.id}>
                <span className="workbook-row-marker" aria-hidden="true" />
                <span className="workbook-row-primary">{alert.context}</span>
                <span className="workbook-row-detail">{alert.message}</span>
                <StatusCell value={alert.severity} />
              </Link>
            ))}
          </div>
        ) : <EmptySheet message="No active follow-ups in this view." />}
      </section>
      <section className="workbook-overview-section">
        <div className="workbook-section-heading"><h2>Weaning due</h2><Link href="/breeding">Open breeding <ExternalLink aria-hidden="true" /></Link></div>
        {sheet.dueWeaning.length ? (
          <div className="workbook-plain-rows">
            {sheet.dueWeaning.map((litter) => (
              <Link className="workbook-plain-row is-warning" href={litter.href} key={litter.id}>
                <span className="workbook-row-marker" aria-hidden="true" />
                <span className="workbook-row-primary">{litter.id}</span>
                <span className="workbook-row-detail">Setup {litter.setupId} · born {litter.birthDate} · {litter.litterSize} pups{litter.correction ? ` · corrected ${litter.correction.requestId.slice(0, 12)}` : ""}</span>
                <strong>{litter.ageDays} days</strong>
              </Link>
            ))}
          </div>
        ) : <EmptySheet message="No litters are due for weaning." />}
      </section>
      <section className="workbook-overview-section">
        <div className="workbook-section-heading"><h2>Active work</h2></div>
        {sheet.activeWork.length ? (
          <div className="workbook-plain-rows">
            {sheet.activeWork.map((work) => (
              <Link className="workbook-plain-row" href={appHref(state, work.href)} key={`${work.type}-${work.id}`}>
                <span className="workbook-row-primary">{work.title}</span>
                <span className="workbook-row-detail">{work.type} · {work.detail}</span>
                <StatusCell value={work.status} />
              </Link>
            ))}
          </div>
        ) : <EmptySheet message="No active breeding or experiment work." />}
      </section>
    </div>
  );
}

function GroupControls({ ids, expanded, setExpanded }: { ids: string[]; expanded?: Set<string>; setExpanded: (value: Set<string>) => void }) {
  return (
    <div className="workbook-group-controls">
      <span>{ids.length} groups{expanded?.size ? ` · ${expanded.size} open` : ""}</span>
      <button type="button" onClick={() => setExpanded(new Set(ids))}>Expand all</button>
      <button type="button" onClick={() => setExpanded(new Set())}>Collapse all</button>
    </div>
  );
}

function useExpandedRows() {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  }
  return { expanded, setExpanded, toggle };
}

function RoomsSheet({ groups }: { groups: WorkbookRoomGroup[] }) {
  const ids = useMemo(() => groups.map((group) => group.id), [groups]);
  const { expanded, setExpanded, toggle } = useExpandedRows();
  if (!groups.length) return <EmptySheet />;
  return (
    <>
      <GroupControls ids={ids} setExpanded={setExpanded} />
      <div className="workbook-grid-wrap workbook-desktop-grid">
        <table className="workbook-grid workbook-room-grid">
          <thead><tr><th className="workbook-frozen-cell">Cage / location</th><th>Lab</th><th>Status</th><th>Occupancy</th><th>Strain</th><th>Sex mix</th><th>Warnings</th><th>Charge</th><th>Open</th></tr></thead>
          <tbody>
            {groups.map((group) => (
              <RoomDesktopRows expanded={expanded.has(group.id)} group={group} key={group.id} onToggle={() => toggle(group.id)} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="workbook-mobile-list">
        {groups.map((group) => (
          <article className={cn("workbook-mobile-group", group.warnings.length && "has-warning")} key={group.id}>
            <button className="workbook-mobile-group-head" type="button" onClick={() => toggle(group.id)} aria-expanded={expanded.has(group.id)}>
              {expanded.has(group.id) ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
              <span><strong>{group.barcode}</strong><small>{group.location} · {group.lab}</small></span>
              <span className="workbook-capacity">{group.occupancy}</span>
            </button>
            <div className="workbook-mobile-summary">
              <span><b>Status</b><StatusCell value={group.status} /></span>
              <span><b>Strain</b>{group.strain}</span>
              <span><b>Sex</b>{group.sexMix}</span>
              <span><b>Charge</b>{group.charge}</span>
            </div>
            {group.warnings.length ? <div className="workbook-warning-line"><AlertTriangle aria-hidden="true" />{group.warnings.join(" · ")}</div> : null}
            <div className="workbook-mobile-actions">
              {group.id !== "unassigned" ? <><Link href={`/scan/${encodeURIComponent(group.barcode)}`}>Scan</Link><Link href={`/cages/${group.id}`}>Open cage</Link></> : <Link href="/animals">Open animals</Link>}
            </div>
            {expanded.has(group.id) ? <AnimalMobileRows animals={group.animals} /> : null}
          </article>
        ))}
      </div>
    </>
  );
}

function RoomDesktopRows({ expanded, group, onToggle }: { expanded: boolean; group: WorkbookRoomGroup; onToggle: () => void }) {
  return (
    <>
      <tr className={cn("workbook-group-row", group.warnings.length && "has-warning")}>
        <td className="workbook-frozen-cell"><div className="workbook-identity-cell"><ExpandButton expanded={expanded} label={`${expanded ? "Collapse" : "Expand"} ${group.barcode}`} onClick={onToggle} /><span><strong>{group.barcode}</strong><small>{group.location}</small></span></div></td>
        <td>{group.lab}</td><td><StatusCell value={group.status} /></td><td><strong>{group.occupancy}</strong></td><td>{group.strain}</td><td>{group.sexMix}</td>
        <td>{group.warnings.length ? <span className="workbook-warning-text"><AlertTriangle aria-hidden="true" />{group.warnings.join(" · ")}</span> : "—"}</td>
        <td>{group.charge}</td>
        <td><div className="workbook-cell-actions">{group.id !== "unassigned" ? <><Link href={`/cages/${group.id}`}>Cage</Link><Link href={`/scan/${encodeURIComponent(group.barcode)}`}>Scan</Link></> : <Link href="/animals">Animals</Link>}</div></td>
      </tr>
      {expanded ? group.animals.map((animal) => (
        <tr className="workbook-child-row" key={animal.id}>
          <td className="workbook-frozen-cell"><Link href={`/animals/${animal.id}`} className="workbook-child-identity"><span className="workbook-tree-line" /> <strong>{animal.animalId}</strong><small>{animal.labAnimalId}</small></Link></td>
          <td>{animal.sex} · {animal.age}</td><td><StatusCell value={animal.status} /></td><td>{animal.dob}</td><td>{animal.strain}</td><td>{animal.genotype}</td><td>{animal.health}</td><td>{animal.project}</td><td><Link className="workbook-inline-link" href={`/animals/${animal.id}`}>Open</Link></td>
        </tr>
      )) : null}
    </>
  );
}

function AnimalMobileRows({ animals }: { animals: WorkbookRoomGroup["animals"] }) {
  return <div className="workbook-mobile-children">{animals.length ? animals.map((animal) => <Link href={`/animals/${animal.id}`} key={animal.id}><span><strong>{animal.animalId}</strong><small>{animal.labAnimalId} · {animal.sex} · {animal.age}</small></span><span><b>{animal.strain}</b><small>{animal.genotype}</small></span></Link>) : <p>Empty cage</p>}</div>;
}

function BreedingSheet({ rows }: { rows: WorkbookBreedingRow[] }) {
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const { expanded, setExpanded, toggle } = useExpandedRows();
  if (!rows.length) return <EmptySheet />;
  return (
    <>
      <GroupControls ids={ids} setExpanded={setExpanded} />
      <div className="workbook-grid-wrap workbook-desktop-grid"><table className="workbook-grid workbook-breeding-grid"><thead><tr><th className="workbook-frozen-cell">Setup / line</th><th>Status</th><th>Sire</th><th>Dam</th><th>Target genotype</th><th>Start / age</th><th>Latest litter</th><th>Weaning</th><th>Progeny</th><th>Cautions</th></tr></thead><tbody>{rows.map((row) => <BreedingDesktopRows expanded={expanded.has(row.id)} key={row.id} onToggle={() => toggle(row.id)} row={row} />)}</tbody></table></div>
      <div className="workbook-mobile-list">{rows.map((row) => <article className={cn("workbook-mobile-group", row.cautions.length && "has-warning")} key={row.id}><button className="workbook-mobile-group-head" type="button" onClick={() => toggle(row.id)} aria-expanded={expanded.has(row.id)}>{expanded.has(row.id) ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<span><strong>{row.id}</strong><small>{row.line} · {row.targetGenotype}</small></span><StatusCell value={row.status} /></button><div className="workbook-mobile-summary"><span><b>Sire</b>{row.sire?.animalId ?? "—"}</span><span><b>Dam</b>{row.dam?.animalId ?? "—"}</span><span><b>Started</b>{row.startDate} · {row.age}</span><span><b>Weaning</b>{row.weaning}</span></div>{row.cautions.length ? <div className="workbook-warning-line"><AlertTriangle aria-hidden="true" />{row.cautions.join(" · ")}</div> : null}{expanded.has(row.id) ? <LitterMobileRows row={row} /> : null}</article>)}</div>
    </>
  );
}

function BreedingDesktopRows({ expanded, onToggle, row }: { expanded: boolean; onToggle: () => void; row: WorkbookBreedingRow }) {
  return <><tr className={cn("workbook-group-row", row.cautions.length && "has-warning")}><td className="workbook-frozen-cell"><div className="workbook-identity-cell"><ExpandButton expanded={expanded} label={`${expanded ? "Collapse" : "Expand"} ${row.id}`} onClick={onToggle} /><span><strong>{row.id}</strong><small>{row.line}</small></span></div></td><td><StatusCell value={row.status} /></td><td>{row.sire ? <Link className="workbook-linked-stack" href={`/animals/${row.sire.id}`}><strong>{row.sire.animalId}</strong><small>{row.sire.genotype}</small></Link> : "—"}</td><td>{row.dam ? <Link className="workbook-linked-stack" href={`/animals/${row.dam.id}`}><strong>{row.dam.animalId}</strong><small>{row.dam.genotype}</small></Link> : "—"}</td><td>{row.targetGenotype}</td><td>{row.startDate}<small className="workbook-cell-subline">{row.age}</small></td><td>{row.latestLitter}</td><td>{row.weaning}</td><td>{row.progenyCount}</td><td>{row.cautions.length ? <span className="workbook-warning-text"><AlertTriangle aria-hidden="true" />{row.cautions.join(" · ")}</span> : "—"}</td></tr>{expanded ? row.litters.map((litter) => <tr className="workbook-child-row" key={litter.id}><td className="workbook-frozen-cell"><span className="workbook-child-identity"><span className="workbook-tree-line" /><strong>{litter.id}</strong><small>{litter.birthDate} · {litter.age}{litter.correction ? ` · corrected ${litter.correction.requestId.slice(0, 12)}` : ""}</small></span></td><td>{litter.weaned === null ? <StatusCell value="nursing" /> : <StatusCell value="weaned" />}</td><td colSpan={2}>{litter.progeny.map((animal) => <Link className="workbook-animal-chip" href={`/animals/${animal.id}`} key={animal.id}>{animal.animalId}</Link>)}</td><td>Born {litter.born}</td><td>Weaned {litter.weaned ?? "—"}</td><td colSpan={4}>{litter.progeny.length} linked progeny</td></tr>) : null}</>;
}

function LitterMobileRows({ row }: { row: WorkbookBreedingRow }) {
  return <div className="workbook-mobile-children">{row.litters.length ? row.litters.map((litter) => <div className="workbook-mobile-litter" key={litter.id}><span><strong>{litter.id}</strong><small>{litter.birthDate} · {litter.age} · born {litter.born}{litter.correction ? ` · corrected ${litter.correction.requestId.slice(0, 12)}` : ""}</small></span><span className="workbook-chip-row">{litter.progeny.map((animal) => <Link href={`/animals/${animal.id}`} key={animal.id}>{animal.animalId}</Link>)}</span></div>) : <p>No litter recorded</p>}</div>;
}

function ExperimentsSheet({ groups }: { groups: WorkbookExperimentGroup[] }) {
  const ids = useMemo(() => groups.map((group) => group.id), [groups]);
  const { expanded, setExpanded, toggle } = useExpandedRows();
  if (!groups.length) return <EmptySheet />;
  return <><GroupControls ids={ids} expanded={expanded} setExpanded={setExpanded} /><div className="workbook-grid-wrap workbook-desktop-grid"><table className="workbook-grid workbook-experiment-grid"><thead><tr><th className="workbook-frozen-cell">Experiment / group</th><th>Project</th><th>Status</th><th>Assignments</th><th>Animal</th><th>Sex</th><th>Strain</th><th>Genotype</th><th>Cage</th><th>Start</th><th>Notes</th></tr></thead><tbody>{groups.map((group) => <ExperimentDesktopRows expanded={expanded.has(group.id)} group={group} key={group.id} onToggle={() => toggle(group.id)} />)}</tbody></table></div><div className="workbook-mobile-list">{groups.map((group) => <article className="workbook-mobile-group" key={group.id}><button className="workbook-mobile-group-head" type="button" onClick={() => toggle(group.id)} aria-expanded={expanded.has(group.id)}>{expanded.has(group.id) ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<span><strong>{group.experimentCode}</strong><small>{group.treatmentGroup} · {group.title}</small></span><span className="workbook-capacity">{group.assignments.length}</span></button><div className="workbook-mobile-summary"><span><b>Project</b>{group.project}</span><span><b>Status</b><StatusCell value={group.status} /></span></div>{expanded.has(group.id) ? <div className="workbook-mobile-children">{group.assignments.length ? group.assignments.map((animal) => <Link href={`/animals/${animal.animalRecordId}`} key={animal.id}><span><strong>{animal.animalId}</strong><small>{animal.sex} · {animal.strain}</small></span><span><b>{animal.cage}</b><small>{animal.genotype}</small></span></Link>) : <p>No assignments</p>}</div> : null}</article>)}</div></>;
}

function ExperimentDesktopRows({ expanded, group, onToggle }: { expanded: boolean; group: WorkbookExperimentGroup; onToggle: () => void }) {
  return <><tr className="workbook-group-row"><td className="workbook-frozen-cell"><div className="workbook-identity-cell"><ExpandButton expanded={expanded} label={`${expanded ? "Collapse" : "Expand"} ${group.experimentCode} ${group.treatmentGroup}`} onClick={onToggle} /><span><strong>{group.experimentCode}</strong><small>{group.treatmentGroup} · {group.title}</small></span></div></td><td>{group.project}</td><td><StatusCell value={group.status} /></td><td>{group.assignments.length}</td><td colSpan={7}>Treatment group</td></tr>{expanded ? group.assignments.map((animal) => <tr className="workbook-child-row" key={animal.id}><td className="workbook-frozen-cell"><Link href={`/animals/${animal.animalRecordId}`} className="workbook-child-identity"><span className="workbook-tree-line" /><strong>{animal.animalId}</strong><small>{group.treatmentGroup}</small></Link></td><td>{group.project}</td><td><StatusCell value={animal.status} /></td><td>1</td><td><Link className="workbook-inline-link" href={`/animals/${animal.animalRecordId}`}>{animal.animalId}</Link></td><td>{animal.sex}</td><td>{animal.strain}</td><td>{animal.genotype}</td><td>{animal.cage}</td><td>{animal.startDate}</td><td>{animal.notes}</td></tr>) : null}</>;
}

function BiosamplesSheet({ rows }: { rows: WorkbookBiosampleRow[] }) {
  if (!rows.length) return <EmptySheet />;
  return <><div className="workbook-grid-wrap workbook-desktop-grid"><table className="workbook-grid"><thead><tr><th className="workbook-frozen-cell">Sample</th><th>Type</th><th>Status</th><th>Animal</th><th>Lab ID</th><th>Collected</th><th>Project</th><th>Experiment</th><th>Storage</th><th>Quantity</th><th>Notes</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="workbook-frozen-cell"><strong>{row.sampleLabel}</strong>{row.correction ? <small data-testid={`workbook-sample-correction-${row.id}`}>Corrected · {row.correction.requestId.slice(0, 12)}</small> : null}</td><td>{row.type}</td><td><StatusCell value={row.status} /></td><td><Link className="workbook-inline-link" href={`/animals/${row.animalRecordId}`}>{row.animalId}</Link></td><td>{row.labAnimalId}</td><td>{row.collectedAt}</td><td>{row.project}</td><td>{row.experiment}</td><td>{row.storage}</td><td>{row.quantity}</td><td>{row.notes}</td></tr>)}</tbody></table></div><RecordMobileList rows={rows} type="biosample" /></>;
}

function CryostorageSheet({ rows }: { rows: WorkbookCryostorageRow[] }) {
  if (!rows.length) return <EmptySheet />;
  return <><div className="workbook-grid-wrap workbook-desktop-grid"><table className="workbook-grid"><thead><tr><th className="workbook-frozen-cell">Label</th><th>Material</th><th>Status</th><th>Strain</th><th>Stored</th><th>Project</th><th>Storage</th><th>Quantity</th><th>Notes</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="workbook-frozen-cell"><strong>{row.sampleLabel}</strong></td><td>{row.material}</td><td><StatusCell value={row.status} /></td><td>{row.strain}</td><td>{row.storedAt}</td><td>{row.project}</td><td>{row.storage}</td><td>{row.quantity}</td><td>{row.notes}</td></tr>)}</tbody></table></div><RecordMobileList rows={rows} type="cryo" /></>;
}

function RecordMobileList({ rows, type }: { rows: WorkbookBiosampleRow[] | WorkbookCryostorageRow[]; type: "biosample" | "cryo" }) {
  const { expanded, toggle } = useExpandedRows();
  return <div className="workbook-mobile-list">{rows.map((record) => {
    const isSample = type === "biosample";
    const row = record as WorkbookBiosampleRow & WorkbookCryostorageRow;
    const isExpanded = expanded.has(record.id);
    return <article className="workbook-mobile-record" key={record.id}><button className="workbook-mobile-record-head" type="button" onClick={() => toggle(record.id)} aria-expanded={isExpanded} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${row.sampleLabel}`}><span className="workbook-mobile-record-title">{isExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<span><strong>{row.sampleLabel}</strong><small data-testid={isSample && row.correction ? `workbook-sample-correction-mobile-${row.id}` : undefined}>{isSample ? row.type : row.material}{isSample && row.correction ? ` · corrected ${row.correction.requestId.slice(0, 12)}` : ""}</small></span></span><StatusCell value={row.status} /></button>{isExpanded ? <dl><div><dt>{isSample ? "Animal" : "Strain"}</dt><dd>{isSample ? <Link className="workbook-inline-link" href={`/animals/${row.animalRecordId}`}>{row.animalId}</Link> : row.strain}</dd></div><div><dt>Date</dt><dd>{isSample ? row.collectedAt : row.storedAt}</dd></div><div><dt>Storage</dt><dd>{row.storage}</dd></div><div><dt>Quantity</dt><dd>{row.quantity}</dd></div><div><dt>Project</dt><dd>{row.project}</dd></div>{isSample ? <div><dt>Experiment</dt><dd>{row.experiment}</dd></div> : null}<div><dt>Notes</dt><dd>{row.notes}</dd></div></dl> : null}</article>;
  })}</div>;
}

export function WorkbookView({ navigation, sheet, state }: { navigation: WorkbookNavigation; sheet: WorkbookSheet; state: WorkbookState }) {
  return (
    <div className="workbook-shell">
      <WorkbookHeader navigation={navigation} state={state} />
      <div className="workbook-canvas">
        <div className="workbook-canvas-status">
          <span><ArrowDownAZ aria-hidden="true" />{SECTION_LABELS[state.section]} · {navigation.childSheets.find((child) => child.id === state.sheet)?.label ?? "All"}</span>
          <span>Read only · changes open in App view</span>
        </div>
        {sheet.kind === "overview" ? <OverviewSheet sheet={sheet} state={state} /> : null}
        {sheet.kind === "rooms" ? <RoomsSheet groups={sheet.groups} /> : null}
        {sheet.kind === "breeding" ? <BreedingSheet rows={sheet.rows} /> : null}
        {sheet.kind === "experiments" ? <ExperimentsSheet groups={sheet.groups} /> : null}
        {sheet.kind === "biosamples" ? <BiosamplesSheet rows={sheet.rows} /> : null}
        {sheet.kind === "cryostorage" ? <CryostorageSheet rows={sheet.rows} /> : null}
      </div>
    </div>
  );
}

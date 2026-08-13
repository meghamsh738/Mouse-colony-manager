"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import type { AnimalTransferWorkspaceView } from "@/lib/types";

type AnimalTransferPanelProps = {
  action: (state: FormActionState | undefined, formData: FormData) => Promise<FormActionState>;
  basePath: string;
  workspace: AnimalTransferWorkspaceView;
};

function pageHref(basePath: string, workspace: AnimalTransferWorkspaceView, changes: Partial<AnimalTransferWorkspaceView["query"]>) {
  const query = { ...workspace.query, ...changes };
  const params = new URLSearchParams({ action: "move-mouse" });
  if (query.animalSearch) params.set("animalSearch", query.animalSearch);
  if (query.animalPage > 1) params.set("animalPage", String(query.animalPage));
  if (query.destinationSearch) params.set("destinationSearch", query.destinationSearch);
  if (query.destinationPage > 1) params.set("destinationPage", String(query.destinationPage));
  if (query.pageSize !== 20) params.set("pageSize", String(query.pageSize));
  return `${basePath}?${params.toString()}`;
}

export function AnimalTransferPanel({ action, basePath, workspace }: AnimalTransferPanelProps) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);
  const [selectedAnimalId, setSelectedAnimalId] = useState("");
  const [selectedDestinationId, setSelectedDestinationId] = useState(workspace.defaultDestinationCageId);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [movedAt, setMovedAt] = useState(workspace.defaultDate);
  const [reason, setReason] = useState("Transferred during routine cage round.");

  const destinationOptions = workspace.pinnedDestination && !workspace.cageOptions.some((cage) => cage.id === workspace.pinnedDestination?.id)
    ? [workspace.pinnedDestination, ...workspace.cageOptions]
    : workspace.cageOptions;
  const selectedAnimal = workspace.animalOptions.find((animal) => animal.id === selectedAnimalId);
  const selectedDestination = destinationOptions.find((cage) => cage.id === selectedDestinationId);
  const sameCage = Boolean(selectedAnimal && selectedDestination && selectedAnimal.currentCageId === selectedDestination.id);
  const projectedOccupants =
    selectedDestination && selectedAnimal && !sameCage
      ? selectedDestination.occupantCount + 1
      : (selectedDestination?.occupantCount ?? 0);
  const createsMixedSex =
    Boolean(
      selectedAnimal &&
        selectedDestination &&
        !sameCage &&
        !workspace.rules.mixedSexHoldingAllowed &&
        selectedDestination.status !== "breeding" &&
        ((selectedAnimal.sex === "male" && selectedDestination.femaleCount > 0) ||
          (selectedAnimal.sex === "female" && selectedDestination.maleCount > 0)),
    );
  const warnings = [
    selectedDestination && projectedOccupants > selectedDestination.capacity
      ? `Projected occupancy ${projectedOccupants} exceeds this cage's limit of ${selectedDestination.capacity}.`
      : null,
    createsMixedSex ? "This would create mixed-sex holding in a non-breeding cage." : null,
    selectedDestination && selectedDestination.warningCount > 0
      ? `${selectedDestination.label} already has ${selectedDestination.warningCount} open warning item${
          selectedDestination.warningCount === 1 ? "" : "s"
        }.`
      : null,
  ].filter(Boolean);
  const invalidQuarantineDestination = selectedDestination?.status === "quarantine";
  const crossLabDestination = Boolean(
    selectedAnimal && selectedDestination && selectedAnimal.owningLabId !== selectedDestination.labId,
  );
  const commandKey = [workspace.commandNonce, selectedAnimalId, selectedDestinationId, movedAt, reason].join(":");

  return (
    <div className="space-y-4">
      <form action={basePath} className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" method="get">
        <input name="action" type="hidden" value="move-mouse" />
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Find animal</span>
          <Input defaultValue={workspace.query.animalSearch} data-testid="animal-transfer-search" name="animalSearch" placeholder="Animal ID, cage, strain, or status" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Find destination</span>
          <Input defaultValue={workspace.query.destinationSearch} data-testid="animal-transfer-destination-search" name="destinationSearch" placeholder="Barcode, room, rack, cage, or lab" />
        </label>
        <Button className="self-end" data-testid="animal-transfer-search-submit" type="submit" variant="subtle">Search</Button>
      </form>
      <p className="text-xs text-[var(--muted)]">Changing search or page clears the staged selection.</p>
      <form action={formAction} className="space-y-4" data-testid="animal-transfer-form" onSubmit={handleSubmit}>
      <input name="animalId" type="hidden" value={selectedAnimalId} />
      <input name="toCageId" type="hidden" value={selectedDestinationId} />
      <input name="expectedVersion" type="hidden" value={selectedAnimal?.version ?? ""} />
      <input name="idempotencyKey" type="hidden" value={commandKey} />
      <input name="requestId" type="hidden" value={commandKey} />

      <div className="animal-transfer-grid grid gap-4">
        <div className="space-y-3">
          <label className="space-y-2 text-sm">
            <span className="text-[var(--muted)]">Animal</span>
            <select
              className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
              data-testid="animal-transfer-animal"
              value={selectedAnimalId}
              onChange={(event) => setSelectedAnimalId(event.target.value)}
            >
              <option value="">Choose an animal</option>
              {workspace.animalOptions.map((animal) => (
                <option key={animal.id} value={animal.id}>
                  {animal.animalId} - {animal.currentCageBarcode} - {animal.strain}
                </option>
              ))}
            </select>
          </label>
          <div className="animal-transfer-results grid gap-2" aria-label="Animal search results">
            {workspace.animalOptions.map((animal) => (
              <button
                key={animal.id}
                className={`min-w-0 rounded-xl border px-3 py-2 text-left transition ${
                  selectedAnimalId === animal.id
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--line)] bg-white/70 hover:border-[var(--line-strong)]"
                }`}
                data-testid="animal-transfer-card"
                draggable
                onClick={() => setSelectedAnimalId(animal.id)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", animal.id);
                  setSelectedAnimalId(animal.id);
                }}
                type="button"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="wrap-value font-medium text-[var(--ink)]">{animal.animalId}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{animal.labId}</p>
                  </div>
                  <Badge variant={animal.sex === "unknown" ? "neutral" : "info"}>{animal.sex}</Badge>
                </div>
                <p className="wrap-value mt-2 text-sm text-[var(--muted)]">{animal.strain}</p>
                <p className="wrap-value mt-1 font-mono text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                  {animal.currentCageBarcode}
                </p>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 text-sm text-[var(--muted)]">
            <span>{workspace.animalResults.totalCount} matches · page {workspace.animalResults.page} of {workspace.animalResults.pageCount}</span>
            <div className="flex gap-2">
              {workspace.animalResults.page > 1 ? <Link className="table-action" href={pageHref(basePath, workspace, { animalPage: workspace.animalResults.page - 1 })}>Previous</Link> : null}
              {workspace.animalResults.page < workspace.animalResults.pageCount ? <Link className="table-action" href={pageHref(basePath, workspace, { animalPage: workspace.animalResults.page + 1 })}>Next</Link> : null}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="space-y-2 text-sm">
            <span className="text-[var(--muted)]">Destination cage</span>
            <select
              className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
              data-testid="animal-transfer-destination"
              value={selectedDestinationId}
              onChange={(event) => setSelectedDestinationId(event.target.value)}
            >
              {destinationOptions.map((cage) => (
                <option
                  disabled={Boolean(selectedAnimal && selectedAnimal.owningLabId !== cage.labId)}
                  key={cage.id}
                  value={cage.id}
                >
                  {cage.barcode} - {cage.label} - {cage.occupantCount}/{cage.capacity}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between gap-3 text-sm text-[var(--muted)]">
            <span>{workspace.destinationResults.totalCount} matches · page {workspace.destinationResults.page} of {workspace.destinationResults.pageCount}</span>
            <div className="flex gap-2">
              {workspace.destinationResults.page > 1 ? <Link className="table-action" href={pageHref(basePath, workspace, { destinationPage: workspace.destinationResults.page - 1 })}>Previous</Link> : null}
              {workspace.destinationResults.page < workspace.destinationResults.pageCount ? <Link className="table-action" href={pageHref(basePath, workspace, { destinationPage: workspace.destinationResults.page + 1 })}>Next</Link> : null}
            </div>
          </div>
          <div
            aria-label="Drop selected animal onto destination cage"
            className={`rounded-xl border p-4 transition ${
              isDraggingOver
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--line)] bg-[var(--surface-2)]"
            }`}
            data-testid="animal-transfer-drop-target"
            onDragLeave={() => setIsDraggingOver(false)}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setIsDraggingOver(true);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDraggingOver(false);
              const droppedAnimalId = event.dataTransfer.getData("text/plain");

              if (workspace.animalOptions.some((animal) => animal.id === droppedAnimalId)) {
                setSelectedAnimalId(droppedAnimalId);
              }
            }}
          >
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Destination</p>
            <p className="mt-2 font-medium text-[var(--ink)]">{selectedDestination?.barcode ?? "No cage selected"}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {selectedDestination?.label ?? "Choose a destination cage"} -{" "}
              {selectedDestination?.strainSummary ?? "No active cage options"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="neutral">{selectedDestination?.status ?? "unknown"}</Badge>
              <Badge variant="neutral">{projectedOccupants} / {selectedDestination?.capacity ?? "-"}</Badge>
              <Badge variant="neutral">{selectedDestination?.sexComposition ?? "No sex mix"}</Badge>
            </div>
          </div>
          {sameCage ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Choose a different destination cage before saving the transfer.
            </p>
          ) : null}
          {invalidQuarantineDestination ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Use the quarantine intake workflow to place an animal in this cage.
            </p>
          ) : null}
          {crossLabDestination ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Submit and finalize a cross-lab transfer request before choosing this cage.
            </p>
          ) : null}
          {warnings.length ? (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Transfer date</span>
          <Input name="movedAt" required type="date" value={movedAt} onChange={(event) => setMovedAt(event.target.value)} data-testid="animal-transfer-date" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Reason</span>
          <textarea
            className="min-h-24 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
            name="reason"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            data-testid="animal-transfer-reason"
          />
        </label>
      </div>

      {selectedAnimal && selectedDestination ? (
        <div className="status-band text-sm text-[var(--muted)]">
          Staged move: <span className="font-medium text-[var(--ink)]">{selectedAnimal.animalId}</span> from{" "}
          {selectedAnimal.currentCageBarcode} to <span className="font-medium text-[var(--ink)]">{selectedDestination.barcode}</span>.
        </div>
      ) : null}

      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button
          className="relative z-10 w-full sm:w-auto"
          data-testid="animal-transfer-submit"
          disabled={pending || !selectedAnimal || !selectedDestination || sameCage || createsMixedSex || invalidQuarantineDestination || crossLabDestination}
          type="submit"
        >
          {pending ? "Saving..." : "Confirm transfer"}
        </Button>
      </div>
      </form>
    </div>
  );
}

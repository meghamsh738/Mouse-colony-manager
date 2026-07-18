"use client";

import { useActionState, useMemo, useState } from "react";

import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import type { AnimalTransferOption, AnimalTransferWorkspaceView } from "@/lib/types";

type AnimalTransferPanelProps = {
  action: (state: FormActionState | undefined, formData: FormData) => Promise<FormActionState>;
  workspace: AnimalTransferWorkspaceView;
};

function getAnimalHaystack(animal: AnimalTransferOption) {
  return [
    animal.animalId,
    animal.labId,
    animal.sex,
    animal.status,
    animal.healthStatus,
    animal.strain,
    animal.currentCageBarcode,
    animal.currentCageLabel,
  ]
    .join(" ")
    .toLowerCase();
}

export function AnimalTransferPanel({ action, workspace }: AnimalTransferPanelProps) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);
  const [search, setSearch] = useState("");
  const [selectedAnimalId, setSelectedAnimalId] = useState("");
  const [selectedDestinationId, setSelectedDestinationId] = useState(workspace.defaultDestinationCageId);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [movedAt, setMovedAt] = useState(workspace.defaultDate);
  const [reason, setReason] = useState("Transferred during routine cage round.");

  const filteredAnimals = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return workspace.animalOptions.slice(0, 5);
    }

    return workspace.animalOptions
      .filter((animal) => getAnimalHaystack(animal).includes(normalizedSearch))
      .slice(0, 8);
  }, [search, workspace.animalOptions]);

  const selectedAnimal = workspace.animalOptions.find((animal) => animal.id === selectedAnimalId);
  const selectedDestination = workspace.cageOptions.find((cage) => cage.id === selectedDestinationId);
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
    <form action={formAction} className="space-y-4" data-testid="animal-transfer-form" onSubmit={handleSubmit}>
      <input name="animalId" type="hidden" value={selectedAnimalId} />
      <input name="toCageId" type="hidden" value={selectedDestinationId} />
      <input name="expectedVersion" type="hidden" value={selectedAnimal?.version ?? ""} />
      <input name="idempotencyKey" type="hidden" value={commandKey} />
      <input name="requestId" type="hidden" value={commandKey} />

      <div className="animal-transfer-grid grid gap-4">
        <div className="space-y-3">
          <label className="space-y-2 text-sm">
            <span className="text-[var(--muted)]">Search</span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Animal, lab ID, cage, strain, sex, status"
              data-testid="animal-transfer-search"
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-[var(--muted)]">Animal</span>
            <select
              className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
              data-testid="animal-transfer-animal"
              value={selectedAnimalId}
              onChange={(event) => setSelectedAnimalId(event.target.value)}
            >
              <option value="">Choose an animal</option>
              {filteredAnimals.map((animal) => (
                <option key={animal.id} value={animal.id}>
                  {animal.animalId} - {animal.currentCageBarcode} - {animal.strain}
                </option>
              ))}
            </select>
          </label>
          <div className="animal-transfer-results grid gap-2" aria-label="Animal search results">
            {filteredAnimals.map((animal) => (
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
              {workspace.cageOptions.map((cage) => (
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
  );
}

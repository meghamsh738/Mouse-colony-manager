"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  ClipboardCheck,
  FileUp,
  Plus,
  Save,
  ShoppingCart,
  Trash2,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

import {
  saveCageIntakeDraftAction,
  submitCageIntakeAction,
} from "@/app/cages/intake/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { WorkflowSteps } from "@/components/app/workflow-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialCageIntakeDraftActionState } from "@/lib/cage-intake-action-state";
import type { CageIntakeDraftPayload } from "@/lib/cage-intake-draft";
import { planCageAssignments } from "@/lib/cage-planner";
import { initialFormActionState } from "@/lib/form-state";
import type {
  AnimalIntakeRow,
  CageDestinationRef,
  CageDraft,
  CageIntakeOptionsView,
  Sex,
} from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

type IntakeMode = "new" | "wean" | "purchase";

type PurchaseRow = {
  rowId: string;
  sourceAnimalId: string;
  sex: Sex;
  strainId: string;
  dob: string;
  ageWeeks: string;
  healthNotes: string;
};

type IntakeSubject = {
  id: string;
  label: string;
  sex: Sex;
  strainId: string;
  strainLabel: string;
  purchaseRow?: PurchaseRow;
};

const modeItems: Array<{ mode: IntakeMode; label: string; icon: typeof Boxes }> = [
  { mode: "new", label: "New cage", icon: Boxes },
  { mode: "wean", label: "Wean litter", icon: Users },
  { mode: "purchase", label: "Receive mice", icon: ShoppingCart },
];

function parseDestination(value: string): CageDestinationRef {
  return value.startsWith("existing:")
    ? { kind: "existing", cageId: value.slice("existing:".length) }
    : { kind: "new", clientId: value.slice("new:".length) };
}

function createPurchaseRow(index: number, defaults?: Partial<PurchaseRow>): PurchaseRow {
  return {
    rowId: `purchase-${Date.now()}-${index}`,
    sourceAnimalId: "",
    sex: "female",
    strainId: "",
    dob: "",
    ageWeeks: "",
    healthNotes: "",
    ...defaults,
  };
}

function dateFromAgeWeeks(arrivalDate: string, ageWeeks: string) {
  const arrival = new Date(arrivalDate);
  const weeks = Number(ageWeeks);
  if (Number.isNaN(arrival.getTime()) || !Number.isFinite(weeks) || weeks < 0) return "";
  arrival.setUTCDate(arrival.getUTCDate() - Math.round(weeks * 7));
  return arrival.toISOString().slice(0, 10);
}

function parseCsvTable(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += character;
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeCsvRows(text: string, options: CageIntakeOptionsView, arrivalDate: string) {
  const table = parseCsvTable(text);
  if (!table.length) return [];

  const first = table[0].map((value) => value.toLowerCase());
  const dataRows = first.includes("sex") || first.includes("strain") ? table.slice(1) : table;

  return dataRows.map((values, index) => {
    const [sourceAnimalId = "", sexValue = "female", strainValue = "", dob = "", ageWeeks = "", healthNotes = ""] = values;
    const sex = ["male", "female", "unknown"].includes(sexValue.toLowerCase())
      ? (sexValue.toLowerCase() as Sex)
      : "unknown";
    const strain = options.strains.find(
      (option) => option.id === strainValue || option.name.toLowerCase() === strainValue.toLowerCase(),
    );

    return createPurchaseRow(index, {
      sourceAnimalId,
      sex,
      strainId: strain?.id ?? "",
      dob: dob || dateFromAgeWeeks(arrivalDate, ageWeeks),
      ageWeeks,
      healthNotes,
    });
  });
}

export function CageIntakeWizard({
  mode,
  options,
  initialDraft,
  workflowDraftId,
}: {
  mode: IntakeMode;
  options: CageIntakeOptionsView;
  initialDraft: { id: string; version: number; payload: CageIntakeDraftPayload } | null;
  workflowDraftId: string;
}) {
  const router = useRouter();
  const restored = initialDraft?.payload;
  const today = new Date().toISOString().slice(0, 10);
  const defaultLabId = options.labs[0]?.id ?? "";
  const defaultRoomId = options.rooms[0]?.id ?? "";
  const defaultRackId = options.racks.find((rack) => rack.roomId === defaultRoomId)?.id ?? "";
  const defaultCategoryId =
    options.chargeCategories.find((category) => category.code === "STANDARD")?.id ??
    options.chargeCategories[0]?.id ??
    "";
  const [step, setStep] = useState<1 | 2 | 3>(restored?.step ?? 1);
  const [labId, setLabId] = useState(restored?.labId ?? defaultLabId);
  const [protocolAuthorizationId, setProtocolAuthorizationId] = useState(restored?.protocolAuthorizationId ?? "");
  const [operationDate, setOperationDate] = useState(
    restored?.operationDate ?? (mode === "wean" ? options.litter?.suggestedWeanDate ?? today : today),
  );
  const [reason, setReason] = useState(restored?.reason ?? "New cage assignment");
  const [selectedAnimalIds, setSelectedAnimalIds] = useState<string[]>(restored?.selectedAnimalIds ?? []);
  const [femaleCount, setFemaleCount] = useState(restored?.femaleCount ?? 0);
  const [maleCount, setMaleCount] = useState(restored?.maleCount ?? 0);
  const [weanStrainId, setWeanStrainId] = useState(restored?.weanStrainId ?? options.strains[0]?.id ?? "");
  const [vendor, setVendor] = useState(restored?.vendor ?? "");
  const [orderReference, setOrderReference] = useState(restored?.orderReference ?? "");
  const [disposition, setDisposition] = useState<"holding" | "quarantine">(restored?.disposition ?? "holding");
  const [intakeNotes, setIntakeNotes] = useState(restored?.intakeNotes ?? "");
  const [csvText, setCsvText] = useState("");
  const [purchaseRows, setPurchaseRows] = useState<PurchaseRow[]>(restored?.purchaseRows ?? [
    createPurchaseRow(0, { strainId: options.strains[0]?.id ?? "" }),
  ]);
  const [subjects, setSubjects] = useState<IntakeSubject[]>(restored?.subjects ?? []);
  const [cages, setCages] = useState<CageDraft[]>(restored?.cages ?? []);
  const [assignments, setAssignments] = useState<Record<string, string>>(restored?.assignments ?? {});
  const [state, formAction, pending] = useActionState(submitCageIntakeAction, initialFormActionState);
  const [draftState, draftAction, draftPending] = useActionState(saveCageIntakeDraftAction, {
    ...initialCageIntakeDraftActionState,
    draftId: initialDraft?.id,
    draftVersion: initialDraft?.version,
    resumeUrl: initialDraft ? `/cages/intake?draftId=${encodeURIComponent(initialDraft.id)}` : undefined,
  });

  useEffect(() => {
    if (draftState.status === "success" && draftState.resumeUrl) {
      router.replace(draftState.resumeUrl, { scroll: false });
    }
  }, [draftState.resumeUrl, draftState.status, router]);

  const selectedRoom = options.rooms.find((room) => room.id === defaultRoomId) ?? options.rooms[0];
  const selectedFacility = options.facilities.find((facility) => facility.id === selectedRoom?.facilityId);
  const facilityLimit = selectedFacility?.maxCageOccupancy ?? 6;
  const strainById = useMemo(() => new Map(options.strains.map((strain) => [strain.id, strain.name])), [options.strains]);
  const requiredProtocolStrainIds = useMemo(() => {
    if (mode === "wean") return weanStrainId ? [weanStrainId] : [];
    if (mode === "purchase") return [...new Set(purchaseRows.map((row) => row.strainId).filter(Boolean))];
    return [];
  }, [mode, purchaseRows, weanStrainId]);
  const protocolOptions = useMemo(() => options.protocols.filter((protocol) => (
    protocol.labId === labId
    && requiredProtocolStrainIds.every((strainId) => protocol.strainIds.includes(strainId))
  )), [labId, options.protocols, requiredProtocolStrainIds]);
  const hasValidProtocolSelection = protocolOptions.some((protocol) => protocol.id === protocolAuthorizationId);
  const assignmentCounts = useMemo(() => {
    return Object.values(assignments).reduce<Record<string, number>>((counts, destination) => {
      counts[destination] = (counts[destination] ?? 0) + 1;
      return counts;
    }, {});
  }, [assignments]);
  const purchaseRowErrors = useMemo(() => {
    if (mode !== "purchase") return [];

    const errors = purchaseRows.flatMap((row, index) => {
      const errors: string[] = [];
      if (!strainById.has(row.strainId)) errors.push(`Row ${index + 1}: choose a known strain.`);
      if (!row.dob && !dateFromAgeWeeks(operationDate, row.ageWeeks)) {
        errors.push(`Row ${index + 1}: enter a date of birth or age in weeks.`);
      }
      return errors;
    });
    if (purchaseRows.length > 300) errors.unshift("An intake batch can contain at most 300 animals.");
    return errors;
  }, [mode, operationDate, purchaseRows, strainById]);

  const capacityErrors = useMemo(() => {
    const errors: string[] = [];
    if (cages.length > 50) errors.push(`The plan creates ${cages.length} cages; split it into batches of at most 50 cages.`);
    cages.forEach((cage) => {
      const room = options.rooms.find((item) => item.id === cage.roomId);
      const facility = options.facilities.find((item) => item.id === room?.facilityId);
      const limit = cage.capacityOverride ?? facility?.maxCageOccupancy ?? 6;
      const count = assignmentCounts[`new:${cage.clientId}`] ?? 0;
      if (count > limit) errors.push(`${cage.cageNumber || "New cage"}: ${count} / ${limit}`);
    });
    options.existingCages.forEach((cage) => {
      const count = assignmentCounts[`existing:${cage.id}`] ?? 0;
      if (count > cage.remainingCapacity) errors.push(`${cage.barcode}: ${count} new / ${cage.remainingCapacity} spaces`);
    });
    return errors;
  }, [assignmentCounts, cages, options.existingCages, options.facilities, options.rooms]);

  const canBuildPlan =
    Boolean(labId && operationDate) &&
    (mode === "new"
      ? reason.trim().length >= 3
      : mode === "wean"
        ? Boolean(
            hasValidProtocolSelection
            &&
            options.litter
            && !options.litter.alreadyWeaned
            && femaleCount + maleCount > 0
            && femaleCount + maleCount <= 100
            && weanStrainId
          )
        : Boolean(
            hasValidProtocolSelection
            &&
            vendor.trim().length >= 2 &&
            orderReference.trim().length >= 2 &&
            purchaseRows.length &&
            purchaseRows.length <= 300 &&
            purchaseRowErrors.length === 0
          ));

  function buildPlan() {
    const nextSubjects: IntakeSubject[] =
      mode === "new"
        ? options.movableAnimals
            .filter((animal) => selectedAnimalIds.includes(animal.id))
            .map((animal) => ({
              id: animal.id,
              label: animal.animalId,
              sex: animal.sex,
              strainId: animal.strain,
              strainLabel: animal.strain,
            }))
        : mode === "wean"
          ? [
              ...Array.from({ length: femaleCount }, (_, index) => ({
                id: `female-${index + 1}`,
                label: `Female pup ${index + 1}`,
                sex: "female" as const,
                strainId: weanStrainId,
                strainLabel: strainById.get(weanStrainId) ?? "Strain",
              })),
              ...Array.from({ length: maleCount }, (_, index) => ({
                id: `male-${index + 1}`,
                label: `Male pup ${index + 1}`,
                sex: "male" as const,
                strainId: weanStrainId,
                strainLabel: strainById.get(weanStrainId) ?? "Strain",
              })),
            ]
          : purchaseRows.map((row, index) => {
              const dob = row.dob || dateFromAgeWeeks(operationDate, row.ageWeeks);
              return {
                id: row.rowId,
                label: row.sourceAnimalId || `Purchased mouse ${index + 1}`,
                sex: row.sex,
                strainId: row.strainId,
                strainLabel: strainById.get(row.strainId) ?? "Strain",
                purchaseRow: { ...row, dob },
              };
            });

    const planned = planCageAssignments({
      subjects: nextSubjects,
      labId,
      roomId: defaultRoomId,
      rackId: defaultRackId,
      startDate: operationDate,
      status: mode === "purchase" && disposition === "quarantine" ? "quarantine" : "active",
      chargeCategoryId: defaultCategoryId,
      facilityLimit,
      existingCageNumbers: options.existingCages.map((cage) => cage.label.split("/").at(-1)?.trim() ?? ""),
    });

    setSubjects(nextSubjects);
    setCages(planned.cages);
    setAssignments(planned.assignments);
    setStep(2);
  }

  function updateCage(clientId: string, patch: Partial<CageDraft>) {
    setCages((current) =>
      current.map((cage) => {
        if (cage.clientId !== clientId) return cage;
        const next = { ...cage, ...patch };
        if (patch.roomId) {
          next.rackId = options.racks.find((rack) => rack.roomId === patch.roomId)?.id ?? "";
        }
        return next;
      }),
    );
  }

  function addCage() {
    if (cages.length >= 50) return;
    const index = cages.length + 1;
    setCages((current) => [
      ...current,
      {
        clientId: `cage-${Date.now()}`,
        labId,
        roomId: defaultRoomId,
        rackId: defaultRackId,
        cageNumber: String(index).padStart(3, "0"),
        status: mode === "purchase" && disposition === "quarantine" ? "quarantine" : "active",
        chargeCategoryId: defaultCategoryId,
        startDate: operationDate,
      },
    ]);
  }

  function removeCage(clientId: string) {
    if ((assignmentCounts[`new:${clientId}`] ?? 0) > 0) return;
    setCages((current) => current.filter((cage) => cage.clientId !== clientId));
  }

  function setDestination(subjectId: string, destination: string) {
    setAssignments((current) => ({ ...current, [subjectId]: destination }));
  }

  const activeCages = cages.filter(
    (cage) => mode === "new" && subjects.length === 0 ? true : (assignmentCounts[`new:${cage.clientId}`] ?? 0) > 0,
  );
  const existingDestinationCount = options.existingCages.filter(
    (cage) => (assignmentCounts[`existing:${cage.id}`] ?? 0) > 0,
  ).length;
  const intakeConfirmationLabel = mode === "wean"
    ? `Record weaning of ${subjects.length} pups into ${activeCages.length + existingDestinationCount} cages`
    : mode === "purchase"
      ? `Receive ${subjects.length} mice into ${activeCages.length + existingDestinationCount} cages`
      : subjects.length
        ? `Create ${activeCages.length} cages and move ${subjects.length} mice`
        : `Create ${activeCages.length} ${activeCages.length === 1 ? "cage" : "cages"}`;
  const payload =
    mode === "new"
      ? {
          cages: activeCages,
          assignments: subjects.map((subject) => ({
            subjectId: subject.id,
            destination: parseDestination(assignments[subject.id]),
          })),
          movedAt: operationDate,
          reason,
        }
      : mode === "wean"
        ? {
            protocolAuthorizationId,
            litterId: options.litter?.id ?? "",
            weanDate: operationDate,
            strainId: weanStrainId,
            pups: subjects.map((subject) => ({
              rowId: subject.id,
              sex: subject.sex,
              destination: parseDestination(assignments[subject.id]),
            })),
            cages: activeCages,
          }
        : {
            protocolAuthorizationId,
            labId,
            vendor,
            orderReference,
            arrivalDate: operationDate,
            disposition,
            notes: intakeNotes || undefined,
            animals: subjects.map<AnimalIntakeRow>((subject) => ({
              rowId: subject.id,
              sourceAnimalId: subject.purchaseRow?.sourceAnimalId || undefined,
              sex: subject.sex,
              strainId: subject.strainId,
              dob: subject.purchaseRow?.dob ?? "",
              healthNotes: subject.purchaseRow?.healthNotes || undefined,
              destination: parseDestination(assignments[subject.id]),
            })),
            cages: activeCages,
          };
  const draftPayload: CageIntakeDraftPayload = {
    schemaVersion: 1,
    mode,
    litterId: options.litter?.id,
    litterVersion: options.litter?.version,
    step,
    labId,
    protocolAuthorizationId,
    operationDate,
    reason,
    selectedAnimalIds,
    femaleCount,
    maleCount,
    weanStrainId,
    vendor,
    orderReference,
    disposition,
    intakeNotes,
    purchaseRows,
    subjects,
    cages,
    assignments,
    command: { mode, payload },
  };
  const saveDraftForm = (
    <form action={draftAction} className="intake-draft-action">
      <input name="workflowDraftId" type="hidden" value={workflowDraftId} />
      <input name="expectedVersion" type="hidden" value={draftState.draftVersion ?? initialDraft?.version ?? 0} />
      <input name="draftPayload" type="hidden" value={JSON.stringify(draftPayload)} />
      <Button disabled={draftPending || state.status === "success"} type="submit" variant="secondary">
        <Save aria-hidden="true" size={16} /> {draftPending ? "Saving..." : "Save draft"}
      </Button>
    </form>
  );

  return (
    <div className="intake-workspace">
      <nav aria-label="Cage intake mode" className="intake-mode-nav">
        {modeItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              aria-current={item.mode === mode ? "page" : undefined}
              className={cn("intake-mode-link", item.mode === mode && "is-active")}
              href={`/cages/intake?mode=${item.mode}`}
              key={item.mode}
            >
              <Icon aria-hidden="true" size={17} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <WorkflowSteps
        currentStep={String(step)}
        steps={[{ id: "1", label: "Source" }, { id: "2", label: "Cage plan" }, { id: "3", label: "Review" }]}
      />
      <FormFeedback state={draftState} />

      {step === 1 ? (
        <section className="intake-section">
          <div className="intake-section-heading">
            <h2>{mode === "new" ? "Cage source" : mode === "wean" ? "Litter outcome" : "Delivery"}</h2>
          </div>
          <div className="worksheet-filter-grid intake-source-grid">
            <label>
              <span>Owning lab</span>
              <select value={labId} onChange={(event) => { setLabId(event.target.value); setProtocolAuthorizationId(""); }}>
                {options.labs.map((lab) => <option key={lab.id} value={lab.id}>{lab.code} · {lab.name}</option>)}
              </select>
            </label>
            <label>
              <span>{mode === "purchase" ? "Arrival date" : mode === "wean" ? "Wean date" : "Start date"}</span>
              <Input type="date" value={operationDate} onChange={(event) => setOperationDate(event.target.value)} />
            </label>
            {mode === "new" ? (
              <label className="sm:col-span-2">
                <span>Reason</span>
                <Input value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
            ) : null}
          </div>

          {mode === "wean" || mode === "purchase" ? <div className="mt-4 space-y-3">
            <div className={protocolOptions.length ? "rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" : "rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"}>
              {protocolOptions.length
                ? "Choose the active intake authorization covering this lab and every selected strain. The server verifies that you are a named intake operator with current competency before saving."
                : "No matching intake authorization is active for this lab and strain selection. Intake is blocked until an independent reviewer activates a suitable protocol and your competency is current."}
            </div>
            <label className="block space-y-2 text-sm">
              <span className="text-[var(--muted)]">Intake protocol</span>
              <select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" name="protocolAuthorizationId" required value={protocolAuthorizationId} onChange={(event) => setProtocolAuthorizationId(event.target.value)}>
                <option value="">Choose active protocol</option>
                {protocolOptions.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.label} · expires {protocol.validUntil.slice(0, 10)}</option>)}
              </select>
            </label>
          </div> : null}

          {mode === "new" ? (
            <div className="intake-record-list">
              {options.movableAnimals.map((animal) => (
                <label className="intake-select-row" key={animal.id}>
                  <input
                    checked={selectedAnimalIds.includes(animal.id)}
                    onChange={(event) =>
                      setSelectedAnimalIds((current) =>
                        event.target.checked ? [...current, animal.id] : current.filter((id) => id !== animal.id),
                      )
                    }
                    type="checkbox"
                  />
                  <strong>{animal.animalId}</strong>
                  <span>{animal.sex} · {animal.strain}</span>
                  <span>{animal.currentCageBarcode}</span>
                </label>
              ))}
              {!options.movableAnimals.length ? <p className="empty-row">No movable animals in your labs.</p> : null}
            </div>
          ) : null}

          {mode === "wean" ? (
            options.litter ? (
              <div className={cn("intake-litter-strip", options.litter.daysOld >= options.litter.weaningDueDays && "is-due")}>
                <div><span>Litter</span><strong>{options.litter.id}</strong></div>
                <div><span>Age</span><strong>{options.litter.daysOld} days</strong></div>
                <div><span>Birth count</span><strong>{options.litter.litterSizeBirth}</strong></div>
                <div><span>Due</span><strong>{options.litter.weaningDueDays} days</strong></div>
                {options.litter.correction ? <div data-testid={`intake-litter-correction-${options.litter.id}`}><span>Correction</span><strong>{options.litter.correction.requestId.slice(0, 12)}</strong></div> : null}
              </div>
            ) : <p className="empty-row">Open this workflow from a litter row in Breeding.</p>
          ) : null}
          {mode === "wean" ? (
            <div className="worksheet-filter-grid mt-4">
              <label><span>Female pups</span><Input min={0} max={Math.max(0, 100 - maleCount)} type="number" value={femaleCount} onChange={(event) => setFemaleCount(Number(event.target.value))} /></label>
              <label><span>Male pups</span><Input min={0} max={Math.max(0, 100 - femaleCount)} type="number" value={maleCount} onChange={(event) => setMaleCount(Number(event.target.value))} /></label>
              <label><span>Progeny strain</span><select value={weanStrainId} onChange={(event) => setWeanStrainId(event.target.value)}>{options.strains.map((strain) => <option key={strain.id} value={strain.id}>{strain.name}</option>)}</select></label>
            </div>
          ) : null}
          {mode === "wean" && femaleCount + maleCount > 100 ? (
            <div className="capacity-error"><strong>Maximum 100 pups per weaning batch.</strong></div>
          ) : null}

          {mode === "purchase" ? (
            <>
              <div className="worksheet-filter-grid mt-4">
                <label><span>Vendor</span><Input value={vendor} onChange={(event) => setVendor(event.target.value)} /></label>
                <label><span>Order / receipt</span><Input value={orderReference} onChange={(event) => setOrderReference(event.target.value)} /></label>
                <label><span>Disposition</span><select value={disposition} onChange={(event) => setDisposition(event.target.value as typeof disposition)}><option value="holding">Holding</option><option value="quarantine">Quarantine</option></select></label>
                <label className="intake-full-field"><span>Delivery notes</span><Input value={intakeNotes} onChange={(event) => setIntakeNotes(event.target.value)} /></label>
              </div>
              <div className="intake-import-bar">
                <label className="intake-paste-field">
                  <span>Paste delivery records</span>
                  <textarea
                    placeholder="One mouse per row"
                    value={csvText}
                    onChange={(event) => setCsvText(event.target.value)}
                  />
                  <small>Columns: vendor ID, sex, strain, date of birth, age in weeks, notes.</small>
                </label>
                <div className="action-row">
                  <Button type="button" variant="secondary" onClick={() => setPurchaseRows(normalizeCsvRows(csvText, options, operationDate))}>
                    <ClipboardCheck size={16} /> Parse rows
                  </Button>
                  <label className="file-action">
                    <FileUp size={16} /> CSV file
                    <input
                      accept=".csv,text/csv"
                      className="sr-only"
                      type="file"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (file) setPurchaseRows(normalizeCsvRows(await file.text(), options, operationDate));
                      }}
                    />
                  </label>
                  <Button disabled={purchaseRows.length >= 300} type="button" variant="ghost" onClick={() => setPurchaseRows((rows) => [...rows, createPurchaseRow(rows.length, { strainId: options.strains[0]?.id ?? "" })])}>
                    <Plus size={16} /> Add row
                  </Button>
                </div>
              </div>
              <div className="purchase-grid" role="table" aria-label="Purchased animals">
                {purchaseRows.map((row, index) => (
                  <div className="purchase-row" role="row" key={row.rowId}>
                    <Input aria-label={`Vendor ID row ${index + 1}`} placeholder="Vendor ID" value={row.sourceAnimalId} onChange={(event) => setPurchaseRows((rows) => rows.map((item) => item.rowId === row.rowId ? { ...item, sourceAnimalId: event.target.value } : item))} />
                    <select aria-label={`Sex row ${index + 1}`} value={row.sex} onChange={(event) => setPurchaseRows((rows) => rows.map((item) => item.rowId === row.rowId ? { ...item, sex: event.target.value as Sex } : item))}><option value="female">Female</option><option value="male">Male</option><option value="unknown">Unknown</option></select>
                    <select aria-label={`Strain row ${index + 1}`} value={row.strainId} onChange={(event) => setPurchaseRows((rows) => rows.map((item) => item.rowId === row.rowId ? { ...item, strainId: event.target.value } : item))}><option value="">Choose strain</option>{options.strains.map((strain) => <option key={strain.id} value={strain.id}>{strain.name}</option>)}</select>
                    <Input aria-label={`DOB row ${index + 1}`} type="date" value={row.dob} onChange={(event) => setPurchaseRows((rows) => rows.map((item) => item.rowId === row.rowId ? { ...item, dob: event.target.value } : item))} />
                    <Input aria-label={`Age weeks row ${index + 1}`} min={0} placeholder="Age weeks" type="number" value={row.ageWeeks} onChange={(event) => setPurchaseRows((rows) => rows.map((item) => item.rowId === row.rowId ? { ...item, ageWeeks: event.target.value } : item))} />
                    <button aria-label={`Remove row ${index + 1}`} className="icon-action" onClick={() => setPurchaseRows((rows) => rows.filter((item) => item.rowId !== row.rowId))} type="button"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
              {purchaseRowErrors.length ? <div className="capacity-error"><strong>Review animal rows</strong>{purchaseRowErrors.map((error) => <span key={error}>{error}</span>)}</div> : null}
            </>
          ) : null}

          <div className="intake-footer">
            <Link className="table-action" href="/cages">Cancel</Link>
            {saveDraftForm}
            <Button disabled={!canBuildPlan} onClick={buildPlan} type="button">Build cage plan <ArrowRight size={16} /></Button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="intake-section">
          <div className="intake-section-heading">
            <div><h2>Cage plan</h2><p>{subjects.length} animals · {cages.length} proposed {cages.length === 1 ? "cage" : "cages"}</p></div>
            <Button disabled={cages.length >= 50} type="button" variant="secondary" onClick={addCage}><Plus size={16} /> Add cage</Button>
          </div>
          <div className="cage-plan-grid">
            {cages.map((cage) => {
              const count = assignmentCounts[`new:${cage.clientId}`] ?? 0;
              const room = options.rooms.find((item) => item.id === cage.roomId);
              const facility = options.facilities.find((item) => item.id === room?.facilityId);
              const capacity = cage.capacityOverride ?? facility?.maxCageOccupancy ?? 6;
              return (
                <article
                  className={cn("cage-plan-row", count > capacity && "is-over")}
                  key={cage.clientId}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const subjectId = event.dataTransfer.getData("text/plain");
                    if (subjectId) setDestination(subjectId, `new:${cage.clientId}`);
                  }}
                >
                  <div className="cage-plan-summary">
                    <strong>{cage.cageNumber || "New cage"}</strong>
                    <Badge variant={count > capacity ? "danger" : count === capacity ? "warning" : "neutral"}>{count} / {capacity}</Badge>
                    <button aria-label="Remove empty cage" className="icon-action" disabled={count > 0 || cages.length === 1} onClick={() => removeCage(cage.clientId)} type="button"><Trash2 size={15} /></button>
                  </div>
                  <div className="cage-plan-fields">
                    <label><span>Room</span><select value={cage.roomId} onChange={(event) => updateCage(cage.clientId, { roomId: event.target.value })}>{options.rooms.map((item) => <option key={item.id} value={item.id}>{item.roomNumber}</option>)}</select></label>
                    <label><span>Rack</span><select value={cage.rackId} onChange={(event) => updateCage(cage.clientId, { rackId: event.target.value })}>{options.racks.filter((rack) => rack.roomId === cage.roomId).map((rack) => <option key={rack.id} value={rack.id}>{rack.rackNumber}</option>)}</select></label>
                    <label><span>Cage no.</span><Input value={cage.cageNumber} onChange={(event) => updateCage(cage.clientId, { cageNumber: event.target.value })} /></label>
                    <label><span>Capacity (optional)</span><Input max={facility?.maxCageOccupancy ?? 6} min={1} placeholder={`Default ${facility?.maxCageOccupancy ?? 6}`} type="number" value={cage.capacityOverride ?? ""} onChange={(event) => updateCage(cage.clientId, { capacityOverride: event.target.value ? Number(event.target.value) : null })} /></label>
                    <label><span>Preprinted barcode</span><Input placeholder="Leave blank to generate" value={cage.barcode ?? ""} onChange={(event) => updateCage(cage.clientId, { barcode: event.target.value })} /></label>
                    <label><span>Rate</span><select value={cage.chargeCategoryId} onChange={(event) => updateCage(cage.clientId, { chargeCategoryId: event.target.value })}>{options.chargeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                  </div>
                  <div className="cage-drop-list">
                    {subjects.filter((subject) => assignments[subject.id] === `new:${cage.clientId}`).map((subject) => <span draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", subject.id)} key={subject.id}>{subject.label}</span>)}
                    {!count ? <span className="drop-placeholder">Drop animals here</span> : null}
                  </div>
                </article>
              );
            })}
          </div>

          {subjects.length ? (
            <div className="assignment-sheet">
              <div className="assignment-sheet-head"><strong>Animal assignments</strong><span>Drag cards or use destination menus</span></div>
              {subjects.map((subject) => (
                <div className="assignment-row" draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", subject.id)} key={subject.id}>
                  <div><strong>{subject.label}</strong><span>{subject.sex} · {subject.strainLabel}</span></div>
                  <select aria-label={`Destination cage for ${subject.label}`} value={assignments[subject.id]} onChange={(event) => setDestination(subject.id, event.target.value)}>
                    {cages.map((cage) => <option key={cage.clientId} value={`new:${cage.clientId}`}>New · {cage.cageNumber || cage.clientId} · {assignmentCounts[`new:${cage.clientId}`] ?? 0}/{cage.capacityOverride ?? facilityLimit}</option>)}
                    {options.existingCages.filter((cage) => cage.labId === labId && cage.remainingCapacity > 0).map((cage) => <option key={cage.id} value={`existing:${cage.id}`}>{cage.barcode} · {cage.occupantCount}/{cage.capacity} · {cage.sexComposition}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ) : null}

          {capacityErrors.length ? <div className="capacity-error"><strong>Capacity exceeded</strong>{capacityErrors.map((error) => <span key={error}>{error}</span>)}</div> : null}
          <div className="intake-footer">
            <Button variant="ghost" type="button" onClick={() => setStep(1)}><ArrowLeft size={16} /> Source</Button>
            {saveDraftForm}
            <Button disabled={Boolean(capacityErrors.length) || cages.some((cage) => !cage.roomId || !cage.rackId || !cage.cageNumber)} onClick={() => setStep(3)} type="button">Review <ArrowRight size={16} /></Button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="intake-section">
          <div className="intake-section-heading"><div><h2>Review</h2><p>{subjects.length} animals · {activeCages.length} new {activeCages.length === 1 ? "cage" : "cages"}</p></div><Badge variant="success">Ready</Badge></div>
          <div className="intake-review-grid">
            <div><span>Workflow</span><strong>{modeItems.find((item) => item.mode === mode)?.label}</strong></div>
            <div><span>Date</span><strong>{formatDate(operationDate)}</strong></div>
            <div><span>Lab</span><strong>{options.labs.find((lab) => lab.id === labId)?.code}</strong></div>
            {mode === "wean" || mode === "purchase" ? <div className="md:col-span-2"><span>Verified protocol</span><strong>{options.protocols.find((protocol) => protocol.id === protocolAuthorizationId)?.label ?? "Not selected"}</strong></div> : null}
            <div><span>New cages</span><strong>{activeCages.length}</strong></div>
            <div><span>Existing destinations</span><strong>{existingDestinationCount}</strong></div>
            <div><span>Charging</span><strong>{activeCages.length ? `${activeCages.length} new charge ${activeCages.length === 1 ? "period" : "periods"}` : "No new charge period"}</strong></div>
            {mode === "new" ? <div className="md:col-span-2"><span>Reason</span><strong className="wrap-value">{reason}</strong></div> : null}
            {mode === "purchase" ? <><div><span>Vendor</span><strong>{vendor}</strong></div><div><span>Order / receipt</span><strong>{orderReference}</strong></div><div><span>Disposition</span><strong>{disposition}</strong></div><div><span>Animal IDs</span><strong>Generated on confirmation</strong></div></> : null}
          </div>
          <div className="review-cage-list">
            {activeCages.map((cage) => <div key={cage.clientId}><strong>{cage.cageNumber}</strong><span>{options.rooms.find((room) => room.id === cage.roomId)?.roomNumber} / {options.racks.find((rack) => rack.id === cage.rackId)?.rackNumber}</span><Badge variant="neutral">{assignmentCounts[`new:${cage.clientId}`] ?? 0} animals</Badge></div>)}
            {options.existingCages.filter((cage) => (assignmentCounts[`existing:${cage.id}`] ?? 0) > 0).map((cage) => <div key={cage.id}><strong>{cage.barcode}</strong><span>{cage.label}</span><Badge variant="neutral">+{assignmentCounts[`existing:${cage.id}`]}</Badge></div>)}
          </div>
          {saveDraftForm}
          <form action={formAction}>
            <input name="workflowDraftId" type="hidden" value={workflowDraftId} />
            <input name="draftPayload" type="hidden" value={JSON.stringify(draftPayload)} />
            <FormFeedback state={state} />
            <div className="intake-footer">
              <Button variant="ghost" type="button" onClick={() => setStep(2)}><ArrowLeft size={16} /> Cage plan</Button>
              <Button disabled={pending || state.status === "success"} type="submit"><ClipboardCheck size={16} /> {pending ? "Saving..." : intakeConfirmationLabel}</Button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

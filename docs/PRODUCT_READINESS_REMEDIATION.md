# Product Readiness Remediation

Status: M11–M16 verified through safe operational reconciliation; M17 next
Source review: [`2026-08-29-chatgpt-pro-product-review.md`](./reviews/2026-08-29-chatgpt-pro-product-review.md)

## Approved Boundary

Mouse Colony Manager is being completed as a **synthetic-only, repository-contained release**. Milestones M0–M10 and the Strain Directory remain verified against disposable data. M11–M20 may implement working local controls and deterministic provider contracts, but they must not be described as institutional approval, veterinary validation, a production system of record, GLP/Part 11 compliance, or a real-data rollout.

No real colony database exists. Work must use uniquely named loopback `mcm_test_*` targets and synthetic attachments. Real identity, hosting, security accreditation, recovery objectives, finance, device, legal/policy, professional translation, and production pilot decisions remain with their institutional owners.

The maturity labels below mean:

- `repository_complete`: the required behavior and evidence can be completed locally with synthetic data.
- `synthetic_contract_complete`: a fail-closed provider/interface and deterministic simulator can be completed locally, but a real provider remains unselected.
- `institutional_decision_required`: policy, ownership, jurisdiction, or intended-use approval cannot be decided in code.
- `external_validation_required`: local implementation is useful, but qualified institutional, clinical, security, hardware, accessibility, or real-user evidence is required.

## Pro Recommendation Ledger

| Pro item | Maturity disposition | Repository-specific action |
| --- | --- | --- |
| P0-1 Intended use and operating model | `institutional_decision_required` | Keep the synthetic intended-use statement and source-of-truth map explicit; require facility, veterinary, welfare, IT/security, finance, and PI approval before rollout. |
| P0-2 Institutional identity and least privilege | `synthetic_contract_complete` | M12 adds independent time-bounded duties, assurance-aware identity contracts, revocation tests, and a production fail-closed profile; real OIDC/SAML, MFA, provisioning, access review, and break-glass remain external. |
| P0-3 Protocol/licence and competency gates | `external_validation_required` | M13 adds immutable synthetic authorization and competency evidence plus transactional gates; institutional protocol rules, training policy, and authority mappings require approval. |
| P0-4 Veterinary and welfare case management | `external_validation_required` | M14 adds structured cases, observations, orders, administrations, escalation, and veterinarian-only closure; clinical terminology and policy require designated-veterinarian validation. |
| P0-5 Controlled corrections, state machines, and audit | `repository_complete` | M15 adds domain-specific reversal/supersession commands, independent approvals, idempotency, immutable originals, and complete audit evidence. |
| P0-6 Production security and protected storage | `external_validation_required` | M17 adds private authorized local attachment delivery, integrity metadata, provider/scanner contracts, throttling, headers, and fail-closed profiles; real storage, scanning, secret management, and penetration testing remain external. |
| P0-7 Backup, restoration, and resilience | `external_validation_required` | M17 extends the guarded synthetic restore to database, private objects, and outbox reconciliation; production RPO/RTO, monitoring, incident ownership, encrypted backups, and downtime exercises remain external. |
| P0-8 Safe intake, census, quarantine, and transfer | `repository_complete` | M16 adds expected-versus-received manifests, census discrepancies, custody, quarantine linkage, and receiving confirmation without silently rewriting colony truth. |
| P0-9 Production qualification and parallel pilot | `external_validation_required` | M20 completes synthetic qualification and evidence; a real parallel pilot, training, reconciliation, leadership/veterinary go-live approval, and change control remain external. |
| P1-1 Unified My Work | `repository_complete` | M18 projects existing source workflows into one task surface without duplicating workflow state. |
| P1-2 Compliance and management reporting | `external_validation_required` | M18 adds governed report definitions and synthetic reconciliation; institutional definitions and sign-off remain external. |
| P1-3 Billing and finance integration | `synthetic_contract_complete` | M18 adds idempotent export/acknowledgement/replay with a local ledger simulator; real cost-centre policy and finance-system integration remain external. |
| P1-4 Governed integrations and migration tooling | `synthetic_contract_complete` | M18 publishes additive contracts, scoped service behavior, import preview, replay, and reconciliation; real service identity and source-system ownership remain external. |
| P1-5 Biosample and cryostorage custody | `institutional_decision_required` | M18 can add append-only local custody evidence, but the institution must decide whether Mouse Colony Manager or an external LIMS is authoritative. |
| P1-6 Accessibility and complete mobile workflow | `external_validation_required` | M18 completes automated keyboard/focus/touch/mobile coverage; independent WCAG 2.2 AA and supported-device testing remain external. |
| P1-7 Scientific planning validation and scope control | `external_validation_required` | M18 makes planning deterministic, versioned, explainable, reproducible, and explicitly advisory; scientific validation requires governed real pilot data. |
| P2-1 RFID, smart racks, and environmental systems | `synthetic_contract_complete` | M19 adds a vendor-neutral gateway and fake reader with replay, clock, duplicate, revocation, and unknown-ID cases; real hardware validation remains external. |
| P2-2 Advanced breeding and capacity optimisation | `external_validation_required` | M19 may add deterministic explainable recommendations, but calibration and prospective validation require governed historical and pilot data. |
| P2-3 Multi-species, multi-facility, and shared services | `institutional_decision_required` | M19 adds site-aware foundations and mouse policy configuration; non-mouse writes stay unsupported until each species/site policy is approved. |
| P2-4 GLP/Part 11 or equivalent regulated deployment | `external_validation_required` | M19 may add evidence manifests and synthetic attestations, but no feature set constitutes compliance without a separate quality and validated-state programme. |
| P2-5 Offline, kiosk, multilingual, and advanced BI | `synthetic_contract_complete` | M19 adds restricted simulators, externalized messages/pseudo-locale, and privacy-minimized aggregate analytics; real offline operations, translations, kiosk deployment, and BI remain external. |

## Delivery Order

| Milestone | State | Bounded outcome |
| --- | --- | --- |
| M11 | Verified | Preserved the Pro response, reconciled documentation, and locked the synthetic-only boundary. |
| M12 | Verified | Independent duties and identity contracts. |
| M13 | Verified | Protocol/licence and competency gates. |
| M14 | Verified | Veterinary and welfare cases. |
| M15 | Verified | Controlled corrections and immutable history. |
| M16 | Verified | Shipment, census, quarantine, and transfer reconciliation. |
| M17 | Next | Private attachments, security controls, and full synthetic recovery. |
| M18 | Planned | P1 operational capability. |
| M19 | Planned | P2 capability laboratory with fail-closed production boundaries. |
| M20 | Planned | Full synthetic qualification, regenerated guidance, acceptance review, and versioned recovery checkpoint. |

Each milestone is complete only after focused tests, required guarded database evidence, desktop/mobile QA where relevant, a proportionate independent review, tracker/checkpoint updates, and a focused commit. M20 does not authorize production deployment or real-data migration.

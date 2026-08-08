# Authorization Entry-Point Manifest

Every entry point must resolve a current database actor, check an explicit capability, apply lab ownership, return a role-projected DTO, and avoid unauthorized counts or error details. `Pending` means it must be audited before Milestone 1 or 2 can close.

## Pages

| Route | Required capability | Status |
| --- | --- | --- |
| `/` | `dashboard:view`; IT redirects to `/system` | Guarded; active-lab counts, alerts, and work queues implemented |
| `/animals`, `/animals/[animalId]` | `animals:read` | Guarded; canonical `owningLabId` scoping implemented |
| `/cages`, `/cages/[cageId]`, `/cages/labels` | `cages:read` | Guarded; canonical cage ownership and print scoping implemented |
| `/cages/intake` | `cages:manage` | Guarded; command conversion pending |
| `/scan`, `/scan/[barcode]` | `scan:use` | Guarded; actor-scoped lookup and cage operations implemented |
| `/quarantine` | `quarantine:read` | Guarded; active-lab cage and animal scoping implemented |
| `/breeding` | `breeding:read` | Guarded; canonical setup-lab scoping implemented |
| `/experiments` | `experiments:read`; private planning requires `experiments:full` | Guarded; CMU receives an operational-only DTO while lab and Facility users receive lab-scoped research fields |
| `/procedures` | `procedures:operational`; planning requires `procedures:plan`; execution requires `procedures:execute` | Guarded operational DTO; lab users plan within their active lab, CMU/Facility execute, and private experiment/SOP content is excluded |
| `/sops` | `sops:read` | Facility SOPs plus actor-scoped private lab SOPs; mutations reauthorize per command |
| `/samples` | `biosamples:read` | Guarded; canonical sample-lab scoping implemented |
| `/cryostorage` | `cryostorage:read`; lab requests require `cryostorage:request`; facility execution requires `cryostorage:manage` | Guarded; canonical lab inventory plus lab request, requester cancellation, and CMU/Facility execution workflow implemented |
| `/strains` | `strains:discover`; requests require `strains:request`; listing and request decisions require `strains:manage` | Guarded; unit discovery exposes only approved listing fields, while draft management, private request messages, ownership checks, and notification recipients remain lab-scoped |
| `/forecast` | `forecast:read` | Guarded; explicit current actor plus validated lab, responsible-user, and cage scope applied to breeding, supply, demand, and inventory queries |
| `/billing`, `/billing/invoices`, invoice detail | `billing:read` | Guarded; active-lab invoice, period, and direct-ID scoping implemented |
| `/billing/rates` | `billing:read`; edit controls require `billing:manage` | Guarded; active-lab read scoping implemented |
| `/notifications` | `notifications:read` | Guarded; exact materialized recipient, current role/membership reauthorization, personal preferences, and delivery history are actor-scoped |
| `/approvals` | `approvals:read` | Guarded; source/destination lab visibility and role-projected transfer packets implemented |
| `/workbook` | `workbook:read` | Guarded; canonical ownership across every section and nested row implemented |
| `/settings` | `rules:manage` plus `audit:domain` for operational history | Guarded; scientific before/after payloads stay out of the page DTO |
| `/system` | `system:view` plus `audit:security` | Guarded; IT-only security events and technical status never select scientific payloads |
| `/administration/users` | `users:manage` plus Facility Admin governance checks | Guarded; invitations and global account roles only, with privileged decisions consolidated under `/approvals` |
| `/administration/labs` | `labs:manage`; Facility Admin for creation/status/membership, active-lab owner for profile edits | Guarded; reads are facility-wide only for Facility Admin and otherwise restricted to the current owned lab |
| `/activate` | Public, hashed single-use invitation token | Guarded and database tested |
| `/login`, `/access-denied` | Public/safe session handling | Database-revalidated session, generic-denial security events, and sign-out recovery implemented; production provider/MFA pending |

## Server Actions

| Module | Capability / policy | Status |
| --- | --- | --- |
| `animals/actions.ts` | `animals:manage` + target lab | Capability and target ownership guarded |
| `animals/[animalId]/actions.ts` | field-specific animal/experiment capability | Capability and direct animal/experiment ownership guarded |
| `cages/[cageId]/actions.ts` | cage manage, responsibility, transfer, closure capabilities | Capability and cage ownership guarded; responsibility changes are idempotent, expected-versioned, same-lab commands and transfer remains approval-based |
| `cages/animal-transfer-actions.ts` | movement/transfer capability + both labs | Capability guarded; both-lab approval model pending |
| `cages/intake/actions.ts` | `cages:manage` + selected lab | Capability guarded; submitted lab audit pending Milestone 2 |
| `scan/[barcode]/actions.ts` | welfare/move capabilities + cage lab | Capability and target cage ownership guarded |
| `breeding/actions.ts` | breeding manage/lifecycle capability | Capability and canonical setup ownership guarded |
| `experiments/actions.ts` | `experiments:manage`; viewer denied | Capability and canonical experiment/animal ownership guarded |
| `procedures/actions.ts` | `procedures:plan` for create/cancel; `procedures:execute` for outcomes | Capability, active-lab ownership, exact assignment/SOP binding, and optimistic versions guarded |
| `samples/actions.ts` | `biosamples:manage` + lab | Capability and sample/animal/project ownership guarded |
| `cryostorage/actions.ts` | submit/cancel use `cryostorage:request`; execution and direct inventory maintenance use `cryostorage:manage` | Capability, active-lab ownership, idempotent command identity, optimistic request/record versions, and immutable request event/operation history guarded |
| `strains/actions.ts` | create/update/decide use `strains:manage`; contact/material requests use `strains:request` | Capability, active owner-or-manager contact, explicit sharing, idempotent command identity, optimistic listing/request versions, and private notification recipients guarded |
| `billing/actions.ts` | generate/manage/finalize/void capabilities | Capability guarded; lab billing scope pending Milestone 2/7 |
| `settings/actions.ts` | `rules:manage` | Capability guarded |
| `notifications/actions.ts` | `notifications:read` + exact current user recipient/preference | Idempotent read/acknowledge/resolve and personal delivery-preference commands reauthorize the current database actor |
| `administration/users/actions.ts` | `users:manage` plus Facility Admin and two-person rules | Guarded and database tested |
| `administration/labs/actions.ts` | `labs:manage`; current database Facility Admin for membership/status, exact active-lab owner for profile edits | Guarded; membership changes revoke sessions and deactivation blocks active operational work |
| `activate/actions.ts` | public invitation-token boundary | Guarded and database tested |
| `lab-context-actions.ts` | active membership only | Guarded; integration test pending |
| `profile-actions.ts` | local instance and development only | Guarded and unit tested |
| `quarantine/actions.ts` | `quarantine:manage` + case/destination lab; finalization restricted to CMU/Facility Admin | Capability, lab ownership, and elevated finalization guarded |
| `approvals/actions.ts` | source `transfers:request`; destination `transfers:approve`; CMU/Facility `transfers:finalize` | Capability, source/destination ownership, current packet acceptance, and Facility-only override guarded |
| `login/actions.ts` | credential authentication and rate-limit policy | Pending |

## Route Handlers And APIs

| Route group | Status |
| --- | --- |
| Auth.js route | Current DB actor and authorization version implemented; production provider/MFA pending |
| `/api/exports/[entity]`, `/api/v1/exports` | Method capability and actor-scoped export repositories implemented |
| `/api/v1/animals`, detail | Method capability, canonical ownership, and direct-ID filtering implemented |
| `/api/v1/cages`, detail, health notes | Method capability, canonical ownership, and direct-ID filtering implemented |
| `/api/v1/breeding-setups`, `/litters`, `/weanings` | Method capability and setup-lab ownership implemented |
| `/api/v1/experiments`, assignments, assignment detail, reservations | Read/manage split and experiment-lab ownership implemented; list DTO is role-projected and CMU receives operational fields without private notes/results |
| `/api/v1/procedures`, `/api/v1/procedures/[procedureId]/occurrences` | Operational read, lab planning, and CMU/Facility execution capabilities; active-lab ownership, exact SOP version, idempotency, and direct-ID filtering implemented |
| `/api/v1/projects` | Read/manage split and project-lab ownership implemented |
| `/api/v1/samples` | Read/manage split, historical source-lab ownership, optional same-lab experiment linkage, and optimistic versions implemented |
| `/api/v1/cryostorage` | Read/manage split, canonical ownership, and optimistic inventory versions implemented; request submit/cancel/execution uses the browser server-action workflow while the direct API remains manage-only compatibility |
| `/api/v1/genotypes`, genotype import | Mutation capability and active-lab animal lookup implemented |
| `/api/v1/rules` | `rules:manage` guarded |
| `/api/v1/notifications/delivery` | `notifications:deliver`; authenticated notification worker for sends | Guarded queue preview; sends claim exact-recipient outbox jobs and reauthorize audience at claim and completion |
| `/api/v1` index | `dashboard:view` guarded; capability-projected catalog pending Milestone 2 |
| `/scan/lookup` | `scan:use` plus actor-scoped barcode resolution implemented |

## Non-Route Surfaces

| Surface | Status |
| --- | --- |
| CSV builders and generated filenames | Actor-scoped builders implemented for current entities |
| Workbook navigation, sheets, totals, search, sorting | Canonical ownership scoping implemented |
| Printable cage labels and QR payloads | Actor-scoped cage repository implemented |
| Attachment upload, storage metadata, and download | Upload metadata now carries canonical lab ownership; dedicated download service is not present |
| Notification badges, inbox counts, digest/email payloads | Exact per-user recipients, active-lab read projection, urgent welfare email, opt-in routine digests, and delivery history implemented; provider endpoint is deployment-controlled |
| Billing exports and invoice print | Direct invoice reads and print views active-lab scoped; export expansion remains M7 |
| Audit exports and entity history | Pending |
| Search/autocomplete/select option providers | Current page and API selectors are active-lab scoped |
| Background outbox workers | Topic-bounded authenticated worker foundation and notification queue processor implemented; bounded scheduler/observability remains M10 |
| Migration exception review | Not implemented |

## CI Rule

Milestone 1 must add a machine-readable counterpart to this manifest. CI must fail when a new page, action module, Route Handler, export, file endpoint, print surface, or worker has no declared capability and ownership policy.

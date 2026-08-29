# ChatGPT Pro Product Review — Mouse Colony Manager

> Archived verbatim from the completed regular ChatGPT Chat review. All submitted screenshots and application data were synthetic.

## Review metadata

- Conversation: Product Review Assessment
- URL: https://chatgpt.com/c/6a92ef2c-3514-83eb-a274-e1060752c3e3
- Submitted: 2026-08-29
- Displayed model and effort: GPT-5.6 Sol — Pro, 5 of 5
- Displayed completion time: 37m 41s
- Attached files displayed by ChatGPT:
  - 01_entry_inventory.png
  - 02_husbandry_research.png
  - 03_directory_operations.png
  - 04_admin_governance.png
  - Mouse_Colony_Manager_User_Guide(1).pdf
  - README(1).md

## Submitted prompt

Professional Product Review — Mouse Colony Manager

Attachment package: the working user-guide PDF, project README, and four labeled high-resolution contact sheets covering every original screenshot from 01-login.png through 17-technical-console.png. The contact sheets preserve the original screen content and filenames while keeping the entire package within one message.

Perform a professional, end-to-end review of Mouse Colony Manager using the attached working guide, implementation context, and UI evidence. Review it as if deciding what is required for credible use in a university central mouse unit, animal facility, or multi-lab research organization.

Evidence and privacy boundary:
- Every screenshot and every record shown is synthetic demonstration data.
- Do not infer, reconstruct, expose, or report credentials, real colony records, real animal/cage/freezer locations, or private research information.
- Treat the PDF as working user documentation, the README as implementation context, and the screenshots as UI evidence. Explicitly flag inconsistencies between them.
- Do not assume features are production-ready merely because they appear in the guide or screenshots.

Evaluate these areas:
1. Product structure and information architecture: navigation, terminology, dashboards, discoverability, mobile/responsive behavior, and separation of lab, facility, and technical concerns.
2. Roles and access: Lab Owner/Manager, Lab Staff, Lab Viewer, CMU/Facility Staff, Facility Administrator, and IT Head. Check least privilege, approvals, delegation, privacy, cross-lab visibility, and auditability.
3. Operational workflows: onboarding and intake, animal and cage inventory, breeding, litters and weaning, experiments/cohorts, procedures and outcomes, SOP governance, biosamples, cryostorage, quarantine, cross-lab transfers, approvals, billing, notifications, reporting, workbook/forecast/export, strain directory requests, and technical administration.
4. Data model and workflow integrity: identifiers, state machines, validation, traceability, concurrency, corrections, bulk operations, provenance, retention, and audit history. Identify unsafe or ambiguous transitions and missing exception handling.
5. Safety, welfare, privacy, and governance: animal welfare and veterinary escalation, facility policy enforcement, ethical/licensing context, separation of technical and research data, sensitive inventory/location controls, incident handling, and defensible audit trails.
6. Reporting and integrations: operational and management reports, exports, billing interfaces, SSO/identity, barcode or RFID support, API/LIMS integrations, notifications, data import, and interoperability.
7. Reliability and operations: backup, restore testing, disaster recovery, monitoring, logging, data retention, migration strategy, deployment/runbooks, supportability, and recovery from partial failures.
8. Usability and accessibility: beginner onboarding, error prevention and recovery, empty/loading/error states, keyboard and screen-reader use, contrast, touch targets, form burden, performance, and clarity on desktop and mobile.

Benchmark the product against current professional mouse-colony, vivarium, laboratory information management system (LIMS), and animal-facility management software. Use current public information where available, name relevant comparator products, and cite sources. Separate evidence-backed comparison from inference.

Identify:
- What is strong or differentiated.
- What is missing, unsafe, duplicated, over-engineered, or premature.
- What should be added, removed, simplified, deferred, or sequenced differently.
- Which apparent capabilities need validation before production use.

Return a decision-ready report with:
1. Executive summary and a candid maturity/readiness assessment.
2. A feature and workflow gap matrix covering roles, current evidence, professional expectation, risk, and recommendation.
3. A prioritized P0/P1/P2 roadmap. For every item include rationale, user/operational risk, scope, dependencies, acceptance criteria, and relative effort.
4. Concrete improvements to the most important end-to-end workflows, including happy paths, exceptions, approvals, and recovery.
5. Data, security, welfare, privacy, regulatory, operational, and usability risks/unknowns.
6. A practical 90-day delivery sequence followed by a later roadmap.
7. The smallest set of product, policy, compliance, or integration questions that must be answered before implementation.

Be specific and critical. Avoid generic best-practice lists. Tie recommendations to the supplied evidence, distinguish confirmed facts from assumptions, and call out where the evidence is insufficient.

## Pro response (verbatim)

# Professional Product Review — Mouse Colony Manager

## 1. Executive decision

### Overall verdict

**Mouse Colony Manager should not yet be adopted as the production system of record for a university central mouse unit, animal facility, or multi-lab organisation.**

It is best classified as an **advanced functional prototype or early pre-production beta**. The supplied materials demonstrate a coherent product concept, broad workflow coverage, unusually thoughtful role separation, and several sound data-integrity patterns. They do **not**, however, establish the welfare, veterinary, ethical-authorisation, competency, security, retention, resilience, and operational controls required for a defensible institutional deployment.

A **restricted, parallel-run pilot** would be reasonable after the P0 controls in this review are implemented. During that pilot, the existing approved colony, veterinary, protocol, billing, and emergency records must remain authoritative.

The guide itself appropriately states that the software is for recording and coordinating work and does not replace approved SOPs, licences, veterinary direction, or institutional escalation.  It also makes clear that the documentation covers one locally verified build using synthetic data and that production hosting, identity, email, migration, and other deployment details remain unspecified. 

### Readiness by use case

| Intended use                                                           | Decision                                | Reason                                                                                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Synthetic demonstration and workflow review                            | **Ready**                               | The guide, seeded data and screenshots are suitable for stakeholder walkthroughs and UAT design.                                                       |
| Single-lab colony companion, operated in parallel with current records | **Conditional**                         | Possible after institutional login, secure hosting, backups, corrections and welfare escalation are implemented.                                       |
| Central facility operational system of record                          | **No-go**                               | Protocol/licence controls, competency, veterinary records, census reconciliation, production security and resilience are not adequately evidenced.     |
| Authoritative animal-welfare or clinical record                        | **No-go**                               | Cage notes and alerts are not a substitute for clinical case management, treatment plans and veterinary sign-off.                                      |
| GLP or electronically regulated preclinical study system               | **No-go and out of demonstrated scope** | No validated-computer-system programme, formal electronic signatures, controlled validation package or Part 11-style operational evidence is supplied. |
| Institutional LIMS for all research data and samples                   | **No-go**                               | Biosamples and experimental records lack the depth, chain of custody, lineage, integration and governance expected from an enterprise LIMS.            |

### Maturity assessment

| Dimension                                    | Assessment                                | Basis                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product concept and information architecture | **Strong**                                | Clear separation of Home, Colony, Research, Facility and Administration; role-scoped navigation is coherent.                                      |
| Domain breadth                               | **Strong for a prototype**                | Animals, cages, breeding, studies, procedures, samples, cryostorage, quarantine, transfers, billing and technical administration are represented. |
| Workflow and transaction design              | **Promising, not independently verified** | Version checks, review steps, immutable states, idempotency and transactional writes are described.                                               |
| Least privilege and governance               | **Mixed**                                 | Good lab/facility/IT separation, but broad Facility Admin power and missing veterinary, compliance and training roles.                            |
| Welfare and ethical-authorisation controls   | **Insufficient**                          | No complete clinical, humane-endpoint, protocol/licence, actual-severity or competency model is evident.                                          |
| Production security                          | **Insufficiently evidenced**              | Development credentials authentication is documented; institutional SSO, MFA, storage security and security assurance are not.                    |
| Reliability and disaster recovery            | **Insufficiently evidenced**              | CI and automated tests exist, but no backup, restore, failover, RPO/RTO or production runbook evidence is supplied.                               |
| Reporting and integration                    | **Partial**                               | A broad API is described, but exports, finance, protocol, identity and equipment integrations remain incomplete or unspecified.                   |
| Accessibility and mobile                     | **Incomplete**                            | One mobile dashboard is shown; full mobile workflows, keyboard navigation and assistive-technology support are not demonstrated.                  |

### The central conclusion

The principal problem is **not a lack of screens or features**. The product already has more visible breadth than many early colony applications.

The problem is that a professional facility depends on a control layer that determines:

* whether an operation is ethically and legally authorised;
* whether the person performing it is trained and currently competent;
* what happens when an animal may be in pain or distress;
* who may override policy and under what independent authority;
* how incorrect records are corrected without destroying history;
* how the institution continues safely during an outage;
* and how it proves all of this later.

That control layer is not yet sufficiently present or evidenced.

---

## 2. Evidence basis and confidence

### Confirmed by the supplied materials

The guide documents seven broad roles, an active-lab scope for lab users, role-specific menus, server-side permission rechecking, and deliberate handoffs for procedures, transfers, quarantine, cryostorage and privileged access. 

It also documents several good integrity controls:

* uniqueness rules for core identifiers;
* server-confirmed success states;
* stale-record/version detection;
* review or acknowledgement for higher-impact actions;
* irreversible terminal states;
* transaction-like multi-record updates;
* immutable SOP versions and content hashes.  

The README identifies a Next.js, TypeScript, Prisma and PostgreSQL application with Auth.js, Vitest and Playwright.  It describes a substantial set of PostgreSQL-backed write workflows, transactional audit/status records and an authenticated `/api/v1` interface.  It also documents CI and local verification commands. 

### Claimed but not independently validated

The following should be treated as implementation claims, not accepted production evidence:

* atomicity across every compound workflow;
* comprehensive server-side authorisation on every route and API operation;
* correctness of idempotency under retries and worker failures;
* completeness and immutability of audit history;
* isolation of research, facility and technical data;
* correctness of transfer, quarantine and experiment blocker logic;
* scale and performance at institutional data volumes;
* security of uploaded attachments;
* scientific validity of breeding and forecasting recommendations.

No source code review, threat model, schema review, test report, deployment architecture, penetration test or live-system exercise was included in the attachment package.

### Not evidenced

The package does not demonstrate:

* production SSO, MFA or automated account lifecycle management;
* veterinary clinical records;
* protocol/licence and authorised-animal-count enforcement;
* procedure-specific training and competency;
* daily census reconciliation;
* health surveillance test panels and veterinarian-approved quarantine release;
* tamper-evident audit storage or defined retention schedules;
* backup and restore testing;
* disaster recovery and business-continuity procedures;
* production monitoring and service-level objectives;
* accessibility conformance;
* migration from an existing institutional system;
* financial-system posting and reconciliation;
* formal security, privacy or regulatory assessment.

---

## 3. What is strong or differentiated

### 3.1 The overall information architecture is coherent

The sidebar grouping into Colony, Research, Facility and Administration is easy to understand. It is substantially better than organising the application around database tables or exposing every module to every user.

The active-lab concept is also clear: a lab user operates in one selected lab, while facility roles operate unit-wide. The guide explicitly warns that switching the active lab immediately changes the scope of subsequent reads and writes. 

The next improvement is to make the **exact current role and current lab far more prominent**. In several screenshots the top-right selector says only “Lab User,” which is less useful than “Lab Manager — Microglia Imaging Lab.” For high-impact actions, the review page should repeat both.

### 3.2 High-impact writes have a promising design

The product demonstrates better-than-average awareness of transactional risk for an early-stage application:

* stale versions are rejected rather than silently overwritten;
* terminal states do not casually reopen;
* compound operations claim to update related entities together;
* transfer packets become stale when their underlying records change;
* SOP plans freeze the approved version and hash;
* repeated external submissions are described as duplicate-safe.

The cage intake workflow is particularly well structured as **source → cage plan → validation → review → atomic confirmation**, rather than as a series of unrelated edits. 

### 3.3 The cross-lab strain directory is genuinely thoughtful

The Strain Directory exposes broad availability without revealing individual animals, exact quantities, cage or cryostorage locations, research details or direct contact information. It also requires the selected contact to make a listing shared and treats an accepted enquiry as coordination rather than transfer approval. 

This is a credible differentiator for a multi-lab academic environment. Many products can track a colony; fewer explicitly design for safe, private inter-lab discovery.

### 3.4 The transfer handoff is conceptually strong

The sequence of source request, destination decision and central finalisation is appropriate. Ownership does not change merely because the destination accepts, and the system rechecks conditions at finalisation. 

This should be retained, but extended with protocol, welfare, health-status and chain-of-custody requirements.

### 3.5 The research planning features may be differentiating

The experiment screen visibly supports seeded selection, sex and age criteria, group assignment, cage balancing, sibling controls and exclusions. The breeding screen presents expected yield, surplus risk and model/rule details.

These features could support the 3Rs by avoiding unnecessary breeding and improving experimental design. Current NC3Rs tools emphasise randomisation, blinding, sample-size reasoning and transparent experimental plans, while ARRIVE expects explicit animal numbers, sample-size rationale and inclusion/exclusion criteria. ([nc3rs.org.uk][1])

The current feature should nevertheless be presented as **decision support**, not as an authoritative scientific or welfare decision. Its models and assumptions require validation.

### 3.6 The notification delivery design is unusually careful

The README describes a durable outbox, exact recipients, host allowlisting, redirect rejection and a requirement that the downstream provider support idempotency before production sending is enabled. 

That is a sensible design. It still requires operational monitoring, delivery-status reconciliation and escalation channels appropriate to urgent welfare events.

### 3.7 The user guide is unusually good for the product’s maturity

The guide is role-oriented, workflow-oriented and generally cautious. It explains effective dates, stale updates, source verification, irreversible actions and when users should stop rather than repeatedly retry. 

The documentation is stronger than much of the visible production-readiness evidence.

---

## 4. Material inconsistencies and unresolved evidence

These should be resolved before the documents are used for procurement, validation or training.

| Inconsistency                                                                                                                                                       | Why it matters                                                                                                         | Required resolution                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| The guide is verified against build `f30311d`, while the README does not identify a matching release or compatibility statement.                                    | A guide can silently describe a different application state.                                                           | Generate versioned documentation from a tagged release; show application version and documentation version in the UI.                    |
| The guide describes seven operational roles, while the README describes five seeded development profiles.                                                           | It is unclear whether every documented role has an independently tested fixture and permission suite.                  | Provide one test identity per role and a generated route/API authorisation matrix. Do not distribute fixed account secrets.              |
| Screenshot 05 visibly shows a cage at **5/4 occupancy**, while the guide says intake prevents over-capacity plans.                                                  | This may represent a birth, an override, legacy data or a defect; the UI does not make the provenance obvious.         | Show the cause, authorisation, effective period and required resolution. A policy exception must not look like ordinary valid occupancy. |
| The guide states that large mobile tables become cards, but the package shows only the mobile dashboard.                                                            | Responsive support for intake, cage work, alerts and procedures remains unproven.                                      | Supply device-level evidence for all critical cage-side workflows.                                                                       |
| The guide refers broadly to audit history, but only “who did what and when” is clearly promised.                                                                    | A defensible audit trail also needs before/after values, reason, source, correlation, approval and correction linkage. | Publish an audit-event schema and retention/tamper model.                                                                                |
| The guide describes billing, approvals, transfers and technical workflows, while the README’s summary of active write flows does not clearly enumerate all of them. | It is uncertain which screens are fully persisted and transactional versus partially implemented.                      | Produce a feature-to-route-to-command-to-test traceability matrix.                                                                       |
| The guide presents a production-like role model, but the README identifies credentials authentication for development users.                                        | Institutional identity and access are not demonstrated.                                                                | State explicitly that local credentials are development-only and implement the intended production IdP.                                  |
| IT Head may initially land on Access Denied and must manually navigate to `/system`.                                                                                | This is a routing defect and can encourage inappropriate role escalation.                                              | Route each role directly to its permitted landing page.                                                                                  |
| Facility rules can be edited independently and can warn or block, but the screenshot does not show effective dates, version activation or independent review.       | A changed welfare or capacity rule can instantly alter facility behaviour without a controlled policy lifecycle.       | Add draft, review, scheduled activation, rollback and impact preview.                                                                    |

---

## 5. Benchmark against current products

This comparison is based on current public vendor material, not independent hands-on testing. Vendor statements establish market expectations but do not prove that every advertised capability works equally well in practice.

| Comparator category                                           | Publicly described capabilities                                                                                                                                                                                                                                 | Mouse Colony Manager’s relative position                                                                                                                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SoftMouse.NET**                                             | Mouse and rat colony, cage, breeding and litter tracking with mobile access. ([softmouse.net][2])                                                                                                                                                               | Mouse Colony Manager appears broader in facility governance, transfers and billing, but mobile workflow depth is much less evidenced.                                                                               |
| **Transnetyx Colony+AMI**                                     | Cages, tasks, strains, breeding, genotyping integration, predictive alerts, demand forecasting and export. ([Transnetyx][3])                                                                                                                                    | Mouse Colony Manager is directionally competitive on planning concepts, but its prediction quality and vendor-genotyping integration need validation.                                                               |
| **Mosaic Vivarium**                                           | Ordering, protocol/permit assignments, pedigree breeding, barcode/RFID census, cage history, per-diem, work requests and role-based security. ([mosaicvivarium.net][4])                                                                                         | Mouse Colony Manager has a strong transfer/privacy concept but is behind on protocol-linked ordering, formal census, RFID and mature facility billing.                                                              |
| **a-tune tick@lab**                                           | Protocol validation, capacity rules, procurement, finance integration, census and billing, RFID/barcode, smart racks, health history, weight progression and multi-species operations. ([a-tune software AG][5])                                                | This illustrates the breadth expected of an established central-facility platform. Mouse Colony Manager currently covers many headings but not the operational depth or integrations.                               |
| **Cayuse Vivarium**                                           | Protocol-linked ordering, census scanning, invoice compilation, finance integration, staff scheduling and veterinary care; its vet product advertises clinical records, treatment plans, audit trails and optional electronic-signature controls. ([Cayuse][6]) | Mouse Colony Manager is materially behind in veterinary case management, scheduling, protocol linkage and enterprise compliance evidence.                                                                           |
| **Instem Climb / Pristima**                                   | Colony and vivarium tracking integrated with study management, animal-health/adverse-event handling, veterinary alerts, dosing, body weight, clinical observations and welfare reporting. ([instem.com][7])                                                     | Mouse Colony Manager’s experiment planner is promising, but its in-life observation and welfare model is substantially shallower.                                                                                   |
| **Enterprise LIMS platforms such as LabVantage or Benchling** | Chain of custody, time-stamped audit trails, sample lineage, structured reviews, electronic signatures and system/instrument integration are normal LIMS expectations. ([LabVantage][8])                                                                        | Mouse Colony Manager should not attempt to become a general LIMS until its biosample lineage, audit assurance, integration and governance are much deeper. Linking to an established ELN/LIMS is likely preferable. |

### Competitive interpretation

Mouse Colony Manager is potentially differentiated by:

* privacy-conscious inter-lab strain discovery;
* explicit source/destination/central transfer handoffs;
* strong documentation;
* version-aware compound workflows;
* combined colony, facility and research planning in a relatively clean interface.

It is currently behind mature facility platforms in:

* veterinary medicine and welfare case management;
* protocol/licence and approved-count enforcement;
* competency and training;
* ordering and procurement;
* formal census;
* finance integration;
* RFID and infrastructure integration;
* compliance reporting;
* operational support and validation.

It is behind mature LIMS platforms in:

* sample lineage and custody;
* electronic review/signature;
* controlled data correction;
* instrument integration;
* validation and audit assurance.

---

## 6. Feature and workflow gap matrix

Risk definitions:

* **Critical:** could contribute to animal harm, unauthorised work, loss of essential records, a major security incident or an indefensible regulatory position.
* **High:** likely to cause material operational, scientific, privacy or financial failure.
* **Medium:** substantial usability or efficiency limitation, but normally recoverable through controlled manual work.

| Area and roles                                                                                    | Current evidence                                                                                                                                                            | Professional expectation                                                                                                                                                                                                                                                                                   | Risk            | Recommendation                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Identity and onboarding** — all roles, Facility Admin, IT                                       | Invite, activate, deactivate and role-change controls exist. README describes development credentials authentication.                                                       | Institutional SSO, MFA, joiner/mover/leaver process, rapid revocation, access review and break-glass controls. NIST’s AAL2 baseline requires MFA where users view or alter personal or proprietary information. ([NIST Pages][9])                                                                          | **Critical**    | Implement OIDC/SAML, MFA, controlled provisioning, session policy, access recertification and emergency access before live data.                                                                                   |
| **Role model and separation of duties** — all                                                     | Good separation among lab, CMU, Facility Admin and IT. Facility Admin can nevertheless plan and execute procedures and holds rules, users, billing and override powers.     | Capability- and competency-based permissions, independent welfare/compliance roles, narrow administrative powers and controlled delegation.                                                                                                                                                                | **Critical**    | Add designated veterinarian, welfare/AWB, protocol/compliance, training administrator and billing roles. Convert Facility Admin’s exceptional powers to audited break-glass or separately assignable capabilities. |
| **Viewer and project privacy** — Lab Viewer, Facility Admin, CMU                                  | Lab Viewer appears to have full experiment read access and broad Workbook/Billing visibility; Facility Admin has full experiment access.                                    | Project-level and field-level access; operational staff should see only data necessary to perform their role.                                                                                                                                                                                              | **High**        | Separate operational study information from private hypotheses, results and research notes. Add project-scoped and operations-only viewer profiles.                                                                |
| **Training and competency** — researchers, animal-care staff, executors                           | No training record or competency gate is demonstrated.                                                                                                                      | EU requirements include education, training, maintained competence and supervision until competence is demonstrated. ([EUR-Lex][10])                                                                                                                                                                       | **Critical**    | Store procedure/species/role-specific competency, trainer, evidence, expiry and supervision status. Gate procedure execution and relevant husbandry actions.                                                       |
| **Protocol, project licence and ethical authorisation** — Lab Owner, researchers, CMU, compliance | Projects and experiments are present, but no authoritative licence/protocol identifier, approved counts, severity, expiry, amendment or personnel authorisation is evident. | Authorisation should govern animal origin/numbers, procedures, analgesia, humane endpoints, design, severity, reuse and personnel competence. ([EUR-Lex][10])                                                                                                                                              | **Critical**    | Integrate with or implement an authoritative protocol/licence register. Block orders, breeding demand, reservations and procedures outside the current authorisation.                                              |
| **Animal intake and origin** — Lab Staff, CMU, Facility Admin                                     | Receive-mice and generic Add mouse paths exist. Intake records vendor/receipt and cage planning, while Add mouse can create a live animal directly.                         | Every animal should have an explicit source event: on-site birth, approved purchase, internal transfer, external import or controlled legacy migration.                                                                                                                                                    | **High**        | Replace broad “Add mouse” with source-specific intake. Retain a restricted legacy/correction import only with review and provenance.                                                                               |
| **Animal identifiers** — all operational users                                                    | Facility Animal ID and Lab ID are both described as system-unique.                                                                                                          | Facility ID should be globally unique; local IDs are normally unique within their lab or namespace. Alias, previous-ID and external/vendor-ID history is needed.                                                                                                                                           | **High**        | Make Lab ID unique within lab, preserve immutable facility ID, and support aliases, prior identifiers and barcode replacements.                                                                                    |
| **Corrections** — managers, compliance, IT support                                                | Terminal states remain immutable and users are told to stop after an incorrect weaning, but a controlled correction workflow is not described.                              | Incorrect records must be corrected without deletion, with linked original/new values, reason, authority and downstream reconciliation.                                                                                                                                                                    | **Critical**    | Add correction commands and reversal/supersession events for every high-impact entity. Never instruct users merely to add explanatory free text.                                                                   |
| **Cage census and reconciliation** — CMU, Facility Admin                                          | Cage inventory, moves, scanning and capacity rules exist. No periodic census workflow is demonstrated. Screenshot 05 shows an unexplained over-capacity condition.          | Barcode/RFID census, missing/extra cage handling, occupancy reconciliation, discrepancy ownership and sign-off are standard facility needs.                                                                                                                                                                | **Critical**    | Implement room/rack census sessions, discrepancy queues and controlled capacity exceptions with expiry and rationale.                                                                                              |
| **Welfare and veterinary care** — animal-care staff, vet, researchers                             | Cage health notes record type, severity, observation, action and follow-up. Alerts and follow-up queues are visible.                                                        | Clinical cases, triage, body weight/condition, diagnosis, treatment orders, medication administration, humane endpoints, post-operative checks, adverse events, veterinarian closure and emergency escalation. The Directive requires daily checks and rapid correction of avoidable harm. ([EUR-Lex][10]) | **Critical**    | Build a veterinary/welfare case module before claiming welfare-record capability. Urgent cases must have escalation beyond an ordinary notification.                                                               |
| **Breeding, litters and weaning** — lab and CMU                                                   | Good base state machine, chronology and sex-specific weaning destinations.                                                                                                  | Full pedigree, pup losses, fostering, litter merging, delayed/partial weaning, breeder rotation, neonatal outcomes and controlled corrections.                                                                                                                                                             | **High**        | Keep the current core; add common exception states and correction workflows before expanding the predictive model.                                                                                                 |
| **Breeding recommendations** — managers                                                           | Cross suggestions expose expected yield, surplus risk, model status and cautions in Screenshot 06. README describes fertility scoring.                                      | Transparent assumptions, model version, validation, confidence, excluded cases, human approval and monitoring for unintended surplus.                                                                                                                                                                      | **High**        | Mark as advisory; document rules separately from predictive estimates; validate retrospectively before operational reliance.                                                                                       |
| **Experiment/cohort planning** — researchers, managers                                            | Strong filters, seeded selection and balancing controls; planning is separated from reservation.                                                                            | Protocol count control, sample-size rationale, inclusion/exclusion criteria, randomisation provenance, blinding, amendments, replacement animals and actual-versus-planned use.                                                                                                                            | **High**        | Retain the planner but link every cohort to authorisation and an immutable design record. Record algorithm version and seed.                                                                                       |
| **Procedure execution and SOPs** — planners, executors, approvers                                 | Exact approved SOP version/hash is frozen; outcomes are Completed, Not performed or Aborted. Procedure outcome does not alter lifecycle state automatically.                | Competent performer, planned and actual anaesthesia/analgesia, dose/route, deviation, actual severity, humane endpoint, post-procedure checks and explicit downstream status/follow-up.                                                                                                                    | **Critical**    | Replace job-title-only execution permission with procedure-specific authorisation. Add structured execution and recovery fields and required follow-up tasks.                                                      |
| **SOP governance** — Owner, Manager, Facility Admin                                               | Immutable versions and independent approval are good.                                                                                                                       | Effective date, review date, withdrawal, impact assessment, training requirement, acknowledgement expiry and controlled emergency change.                                                                                                                                                                  | **High**        | Add a complete controlled-document lifecycle. Do not allow a rule or SOP change to become operational without an activation decision.                                                                              |
| **Quarantine and health surveillance** — CMU, Facility Admin, vet                                 | Hold, observations, follow-ups, release request and destination blockers exist.                                                                                             | Source health reports, barrier/pathogen profiles, tests and results, sentinel schedules, positive-case management, treatment/retest, veterinarian release and outbreak controls.                                                                                                                           | **Critical**    | Make health-status compatibility and veterinarian approval explicit release prerequisites.                                                                                                                         |
| **Cross-lab transfers** — source/destination managers, CMU                                        | Strong three-stage transfer with stale-packet handling and atomic finalisation.                                                                                             | Protocol availability, authorised counts, health compatibility, chain of custody, billing transfer, welfare history and classified research confidentiality.                                                                                                                                               | **High**        | Extend the packet. Safety and welfare information must follow the animal and must not be hidden in a source-private note.                                                                                          |
| **Biosamples and cryostorage** — lab, CMU, Facility Admin                                         | Basic source animal, sample status, storage, quantity and request processing are present.                                                                                   | Aliquot and derivative lineage, container/position uniqueness, moves, freeze-thaw history, chain of custody, shipment, reconciliation, temperature incidents and witnessed disposal.                                                                                                                       | **High**        | Either build proper custody/lineage or narrow the feature to a simple inventory that integrates with the institution’s LIMS/biobank system.                                                                        |
| **Work queue, notifications and approvals** — all                                                 | Dashboard work queue, Notifications and Approvals are separate. Notifications support read, acknowledge and resolve.                                                        | One owned work model with assignee, due date, priority, delegation, escalation, source state, SLA and closure controlled by the source workflow.                                                                                                                                                           | **High**        | Consolidate into “My Work.” Do not permit an independent Resolve action where the underlying record remains unresolved.                                                                                            |
| **Billing** — Facility Admin, CMU, labs                                                           | Rates, cage charges, draft invoices, adjustments, finalisation and voiding are represented.                                                                                 | Cost centre/grant, rate-effective dates, services, procurement, internal/external pricing, invoice approval, disputes, finance posting and reconciliation.                                                                                                                                                 | **High**        | Add a separate billing administrator role and integrate with the authoritative finance system rather than recreating an ERP.                                                                                       |
| **Reports and exports** — managers, facility, compliance                                          | Animals, cages, alerts, experiments and audit exports exist. Procedures, biosamples, cryostorage and full Workbook exports are explicitly absent.                           | Census, authorised-versus-used animals, mortality, actual severity, welfare response, training, quarantine, breeding performance, exceptions, billing and regulatory submissions.                                                                                                                          | **High**        | Define a report catalogue with source fields, privacy classification, sign-off and reconciliation tests.                                                                                                           |
| **API and external integrations** — IT, service owners                                            | README lists broad authenticated APIs and duplicate-safe intake operations.                                                                                                 | OpenAPI contract, scoped service identities, OAuth/mTLS, rate limits, versioning, event delivery, reconciliation, sandbox and deprecation policy.                                                                                                                                                          | **Critical**    | Treat the API as an enterprise boundary. Add security scopes, integration audit, idempotency receipts and failed-message reconciliation.                                                                           |
| **Attachment storage** — all uploaders, IT                                                        | Uploaded files are stored locally under a web application path for the MVP.                                                                                                 | Private object storage, encryption, malware scanning, authorised retrieval, retention, deletion controls and immutable evidence where required.                                                                                                                                                            | **Critical**    | Remove production attachments from the public web tree before any live use.                                                                                                                                        |
| **Audit, retention and privacy** — compliance, facility, IT                                       | Operational and technical histories are separated; the guide describes command identities, version checks and audit records.                                                | Before/after values, reason, actor, role, lab, time zone, source channel, correlation, approvals, access/export events, tamper protection and retention. EU animal records have a minimum five-year retention requirement; AWB advice records have a three-year minimum. ([EUR-Lex][10])                   | **Critical**    | Create a signed data-retention and audit specification and test retrieval for inspection scenarios.                                                                                                                |
| **Reliability and recovery** — IT, facility leadership                                            | Automated verification and a technical queue console are documented.                                                                                                        | Backups, point-in-time recovery, restore tests, RPO/RTO, failover, monitoring, capacity, incident response and downtime procedures. Periodic restore and contingency testing are standard resilience controls. ([NIST][11])                                                                                | **Critical**    | Implement and exercise operational recovery before importing live records.                                                                                                                                         |
| **Application security** — IT and all users                                                       | No formal security-assurance evidence is supplied.                                                                                                                          | Threat modelling, secure SDLC, vulnerability scanning, dependency control, penetration testing and a defined verification baseline such as OWASP ASVS. ([OWASP Foundation][12])                                                                                                                            | **Critical**    | Complete a security review and independent test; remediate all critical/high findings before pilot.                                                                                                                |
| **Accessibility and mobile** — all                                                                | Consistent desktop layout and one useful mobile dashboard are visible; dense tables and small controls dominate desktop screens.                                            | WCAG 2.2 AA, keyboard-only operation, assistive-technology semantics, non-colour status cues, accessible authentication, focus visibility and adequate touch targets. ([W3C][13])                                                                                                                          | **Medium–High** | Conduct automated and manual accessibility testing across all P0 workflows and representative mobile devices.                                                                                                      |

---

## 7. What should be added, removed, simplified and deferred

| Action                                                 | Recommendation                                                                                                                                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Add now**                                            | Veterinary/welfare cases; project licence/protocol records; competency and training; formal census; controlled corrections; SSO/MFA; secure attachment storage; retention; backup/restore; downtime and incident procedures. |
| **Remove from distributable production documentation** | Fixed development account details or shared credential statements. The README currently contains seeded account information intended for development.                                                                        |
| **Remove from production architecture**                | Locally served uploaded evidence under the application’s public file tree.                                                                                                                                                   |
| **Remove as a normal workflow**                        | Unrestricted generic “Add mouse.” Convert it into explicit birth, purchase, transfer, import or controlled legacy-intake events.                                                                                             |
| **Remove**                                             | The IT `/system` landing workaround. Correct role-based routing instead.                                                                                                                                                     |
| **Simplify**                                           | Dashboard Work Queue, Notifications and Approvals into a single owned “My Work” model, while retaining separate filtered views.                                                                                              |
| **Simplify**                                           | Facility rule editing. Replace direct per-row updates with a draft/review/effective-date lifecycle and an impact preview.                                                                                                    |
| **Simplify**                                           | Experiment records to the operational information the facility genuinely needs. Store hypotheses and detailed results in an ELN/LIMS and link to them.                                                                       |
| **Clarify**                                            | “Lab User” in the top bar, “Workbook,” “Promotion,” “Available,” “Resolved,” “Active” and “Allocated.” Show exact role and state consequences at point of action.                                                            |
| **Defer**                                              | Further predictive breeding optimisation until underlying breeding records, welfare controls and model validation are stable.                                                                                                |
| **Defer**                                              | Advanced long-range forecasting until supply/demand data have been reconciled against real facility outcomes.                                                                                                                |
| **Defer**                                              | RFID, smart racks, environmental sensors, multi-species and multi-site expansion until the P0 data model is stable.                                                                                                          |
| **Defer unless contractually required**                | Part 11/GLP validation. It would require a separate intended-use statement, quality system, validation plan and operational controls, not merely extra fields.                                                               |

---

# 8. Prioritised roadmap

Effort is relative:

* **S:** approximately one to two engineering weeks;
* **M:** approximately three to six;
* **L:** approximately six to twelve;
* **XL:** cross-team or multi-quarter work.

These are planning classes, not delivery promises.

## P0 — required before a credible live pilot

| Item                                                       | Rationale and operational risk                                                                                                                                                                            | Scope                                                                                                                                                                           | Dependencies                                                                                 | Acceptance criteria                                                                                                                                                                                                      | Effort   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| **P0-1: Approve intended use and operating model**         | The application cannot be safely designed until it is clear whether it is a lab tool, facility system of record, veterinary record, study system or LIMS. Ambiguous scope produces incompatible controls. | Intended-use statement; source-of-truth map; RACI; jurisdiction; data classes; regulated/non-regulated boundaries; signed go-live criteria.                                     | Facility director, designated vet, AWB/compliance, IT/security, finance, PI representatives. | A signed document identifies every authoritative record, integration boundary, role, approver and excluded use.                                                                                                          | **M**    |
| **P0-2: Institutional identity and least privilege**       | Local credentials and broad roles create account, delegation and insider risk.                                                                                                                            | OIDC/SAML; MFA; controlled provisioning; revocation; session policy; exact role display; access review; break-glass; project/field permissions.                                 | Institutional IdP and security team.                                                         | Every UI route and API operation has an automated allow/deny test for every role; privileged access requires MFA and is independently reviewable; deactivation invalidates active access.                                | **L**    |
| **P0-3: Protocol/licence and competency gates**            | A technically valid transaction may still be unauthorised.                                                                                                                                                | Protocol/licence identifiers, dates, animal limits, species/strain, procedures, severity, endpoints, named personnel, amendments, training and supervision.                     | Institutional protocol source or approved interim registry.                                  | Purchase, breeding demand, reservation, procedure and transfer cannot proceed outside current authority; every override has an authorised approver and durable reason.                                                   | **XL**   |
| **P0-4: Veterinary and welfare case management**           | Current cage notes do not support continuous clinical care or humane-endpoint decisions.                                                                                                                  | Clinical cases, observations, measurements, triage, treatment orders, administrations, post-op checks, adverse events, endpoints, escalation and closure.                       | Designated veterinarian and facility welfare policy.                                         | An urgent observation creates a time-bound escalation; treatment and follow-up are traceable; only an authorised role can close a clinical case; overdue critical cases cannot be hidden by marking a notification read. | **XL**   |
| **P0-5: Controlled corrections, state machines and audit** | Incorrect births, weanings, moves, euthanasia or transfers must not be fixed by duplicate records or destructive edits.                                                                                   | Formal transition registry; reversal/supersession commands; before/after audit; reason; time zone; source; correlation; approval; retention; export history.                    | P0-1 governance decisions.                                                                   | Every high-impact state has documented prerequisites, side effects, terminal rules and correction path; audit reconstruction reproduces the complete decision history.                                                   | **L–XL** |
| **P0-6: Production security and protected storage**        | Attachments, credentials, APIs and sensitive facility locations require production-grade protection.                                                                                                      | Secret management; encrypted transport/storage; private object storage; malware scanning; security headers; API limits; dependency scanning; secure logging; penetration test.  | Hosting and security architecture.                                                           | No uploaded file is publicly addressable; secrets are not stored in distributable files; independent testing reports no unresolved critical or high-risk issue; security logging is operational.                         | **L**    |
| **P0-7: Backup, restoration and operational resilience**   | Loss or prolonged unavailability of colony and welfare records creates direct operational risk.                                                                                                           | RPO/RTO; automated backups; point-in-time recovery; restore environment; monitoring; alerting; queue recovery; migration rollback; incident and downtime runbooks.              | Production hosting design and support owner.                                                 | A documented restore drill reconstructs the database and protected files within the approved RTO and data-loss tolerance; staff successfully execute a downtime-and-reconciliation exercise.                             | **L**    |
| **P0-8: Safe intake, census, quarantine and transfer**     | These workflows establish physical truth. Errors propagate into welfare, billing, studies and authorised counts.                                                                                          | Source-specific intake; health documents; barcode lifecycle; census; discrepancy management; explicit capacity exception; quarantine testing and vet release; transfer custody. | Protocol, welfare and role work above.                                                       | UAT covers duplicate delivery, unknown data, damaged shipment, capacity change, positive quarantine result, stale transfer and partial failure without orphaned or contradictory records.                                | **XL**   |
| **P0-9: Production qualification and parallel pilot**      | Feature completion does not establish operational safety.                                                                                                                                                 | Realistic-scale performance; security; accessibility; migration rehearsal; role UAT; report reconciliation; training; support; change control.                                  | All preceding P0 items.                                                                      | Two complete operational cycles reconcile against the existing authoritative records; zero unresolved critical defects; restore and incident exercises pass; facility leadership and vet sign go/no-go.                  | **M–L**  |

## P1 — required for central-unit adoption after pilot

| Item                                                          | Rationale and risk                                                                                 | Scope                                                                                                                                             | Dependencies                                      | Acceptance criteria                                                                                                                                   | Effort                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **P1-1: Unified My Work service**                             | Separate queue, notification and approval surfaces can create duplicate or ownerless work.         | Common task entity, owner, due date, escalation, delegation, source status, comments and SLA metrics.                                             | Stable state machines.                            | Each operational obligation has one source of truth; closing the source workflow closes the task; overdue work is reportable by team and severity.    | **L**                                  |
| **P1-2: Compliance and management reporting**                 | Management cannot demonstrate usage, welfare response or exceptions from current exports.          | Census, authorised-versus-used counts, mortality, actual severity, welfare, breeding, quarantine, training, SOP, inventory and exception reports. | Protocol, welfare and audit models.               | Each report has an approved definition and reconciles to source records; role/field restrictions are tested.                                          | **L**                                  |
| **P1-3: Billing and finance integration**                     | Manual invoice transfer creates reconciliation and segregation-of-duties risk.                     | Cost centres, grants, effective rates, service charges, approvals, disputes, posting, credit and finance reconciliation.                          | Institutional finance requirements.               | A closed billing period reconciles cage census and service records to the finance export, with no unexplained balance.                                | **L–XL**                               |
| **P1-4: Governed integration platform and migration tooling** | The API is broad but not yet an enterprise integration contract.                                   | OpenAPI, service accounts/scopes, OAuth or mTLS, event webhooks, idempotency receipts, import preview, migration mapping and reconciliation.      | Security and source-system decisions.             | Every integration has an owner, contract tests, failure queue, replay process and reconciliation report; migration is repeatable and non-destructive. | **L**                                  |
| **P1-5: Biosample and cryostorage custody**                   | Current status fields are insufficient where the application is expected to be authoritative.      | Parent/child lineage, aliquots, position constraints, moves, freeze-thaw, shipment, reconciliation, incident and disposal witness.                | Decision whether to build or integrate with LIMS. | A sample can be traced from animal and collection event through every container, location, allocation and disposition.                                | **XL** if built; **M–L** if integrated |
| **P1-6: Accessibility and complete mobile workflow**          | Cage-side work must be usable on institutionally supported devices and by users with disabilities. | WCAG 2.2 AA, keyboard, screen reader, focus, target sizes, non-colour cues, mobile forms, scan fallback, network error recovery.                  | Stable P0 workflows and component library.        | Independent accessibility testing; all P0 workflows complete by keyboard and supported mobile devices; no critical accessibility defect.              | **L**                                  |
| **P1-7: Scientific planning validation and scope control**    | Advanced planning may create misplaced trust and duplicate ELN/LIMS functionality.                 | Model documentation, versioning, back-testing, ARRIVE/EDA fields, randomisation provenance, research-data boundary and external links.            | Real pilot data and scientific governance.        | Planner output is reproducible, advisory and independently reviewed; private results remain in the designated research system.                        | **M–L**                                |

## P2 — later strategic capabilities

| Item                                                        | Rationale                                                                                                    | Scope                                                                                                                                       | Acceptance criteria                                                                                                       | Effort                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **P2-1: RFID, smart racks and environmental systems**       | Reduces manual census and enables infrastructure alerts, but should follow stable physical-record workflows. | RFID, rack readers, cage-card printers, environmental and equipment integrations.                                                           | Device events reconcile deterministically with manual census and have an exception workflow.                              | **XL**                   |
| **P2-2: Advanced breeding and capacity optimisation**       | Could improve reduction and resource use, but depends on reliable historic data.                             | Forecast calibration, uncertainty, scenario analysis, model governance and outcome monitoring.                                              | Retrospective and prospective validation shows defined performance; no automatic animal-creation decision.                | **L–XL**                 |
| **P2-3: Multi-species, multi-facility and shared services** | Significant market expansion but increases policy, identifier and permissions complexity.                    | Species-specific husbandry, facility hierarchy, cross-site transfer and local policy packs.                                                 | Existing mouse workflows remain unchanged under regression testing; every species/site has approved policy configuration. | **XL**                   |
| **P2-4: GLP/Part 11 or equivalent regulated deployment**    | Requires a separate quality and validation programme.                                                        | Intended use, validation plan, requirements traceability, e-signatures, validated infrastructure, change control, SOPs and periodic review. | Formal quality approval and validated-state maintenance, not merely feature presence.                                     | **XL / programme-level** |
| **P2-5: Offline, kiosk, multilingual and advanced BI**      | Valuable after core operational reliability is established.                                                  | Controlled offline capture, conflict reconciliation, kiosk mode, localisation and analytics warehouse.                                      | No loss of audit/provenance during offline or translated operation.                                                       | **L–XL**                 |

---

# 9. Concrete redesign of the most important workflows

## 9.1 Order or receive animals → quarantine/holding → reconciled inventory

### Recommended happy path

1. A requester selects an active protocol/licence and project.
2. The system verifies species, strain, approved remaining numbers, requester authority and receiving capacity.
3. An order or expected-delivery record is approved before arrival.
4. At arrival, staff scan or open the expected delivery rather than creating animals independently.
5. They record supplier, source establishment, transport details, health report, arrival condition, discrepancies and actual animals.
6. The system proposes quarantine or direct-holding disposition using source and barrier rules.
7. Cage and animal identifiers are generated or reconciled with pre-issued labels.
8. A review page shows authorised count consumed, destination, capacity, health disposition, billing and all created records.
9. One idempotent confirmation creates the intake event, animals, cages, protocol usage, billing and tasks.
10. A post-intake reconciliation report compares ordered, shipped, received, quarantined and rejected numbers.

### Required exceptions

* delivery arrives without an expected order;
* actual sex, age or count differs;
* duplicate vendor or animal identifier;
* animal arrives unwell or dead;
* health report missing or incompatible;
* quarantine capacity unavailable;
* damaged or unreadable labels;
* network unavailable;
* only part of the delivery can be accepted.

### Approvals

An unauthorised delivery should become a controlled exception requiring facility and protocol-owner review, not a normal Add mouse operation. A health-status exception should require veterinary direction.

### Recovery

The intake must be resumable. A failed confirmation returns an idempotency receipt or explicit failure with no partial animal/cage creation. If a physical label has already been applied, the system must preserve and reconcile that identifier rather than generating a replacement silently.

---

## 9.2 Daily husbandry observation → clinical escalation → treatment → closure

### Recommended happy path

1. Staff scan a cage and confirm physical location and occupants.
2. They record a normal husbandry check or an observation using a structured body-system and severity model.
3. Any non-trivial observation opens a welfare/clinical case rather than only a notification.
4. The rules engine assigns urgency, response target and responsible team.
5. Urgent cases alert the designated veterinary/on-call route and remain visible until accepted.
6. The veterinarian or authorised clinician records assessment, diagnosis/differential, treatment or monitoring plan, endpoints and review time.
7. Medication administrations and measurements are recorded as individual events.
8. The system schedules follow-up checks and escalates missed checks.
9. Closure requires an authorised conclusion and documents outcome, actual severity and any project impact.

### Required exceptions

* animal cannot be located;
* cage identity and system occupants disagree;
* multiple animals affected;
* urgent welfare event during system downtime;
* animal found dead;
* unplanned euthanasia;
* adverse event associated with a study;
* treatment cannot be administered;
* responsible investigator cannot be contacted.

### Approvals and escalation

A researcher should not be able to resolve a veterinary case simply by resolving an alert. Likewise, a Facility Admin role should not implicitly confer veterinary authority.

### Recovery

Provide an approved downtime form containing cage/animal ID, observation time, reporter and action. On service restoration, back-entry records both the actual event time and the later system-entry time and requires reconciliation.

---

## 9.3 Breeding setup → litter → pup events → weaning

### Recommended happy path

1. Confirm protocol breeding authority, line, target genotype and breeder competency.
2. Check sire/dam identity, pedigree, age, current workload, health, cage and genetic compatibility.
3. Record the physical setup and mating-cage change atomically.
4. Record pregnancy checks or expected-litter information where used locally.
5. Record litter birth, live/dead pups and relevant neonatal outcomes.
6. Support subsequent litter-count adjustments as events, not edits to the original birth count.
7. At weaning, record observed sex counts, animal IDs, markings/genotyping samples and destinations.
8. Reconcile pups at birth, interim losses and animals created.
9. Close or continue the setup explicitly.

### Required exceptions

* unknown sire;
* mixed or fostered litter;
* litter merged or split;
* partial or delayed weaning;
* unexpected mortality/cannibalism;
* pups euthanised before weaning;
* insufficient cage capacity;
* sex uncertain;
* an incorrect litter or weaning is recorded.

### Recovery

An incorrect weaning should use a correction command that reverses or supersedes the resulting animals and movements under authorised review. The current advice merely to stop and ask a manager is safe as temporary guidance, but not an adequate production correction mechanism.

---

## 9.4 Experiment planning → reservation → authorised procedure → follow-up

### Recommended happy path

1. Create or import the approved study plan and link it to an active protocol/licence.
2. Record authorised procedures, severity, endpoints, permitted personnel and approved animal limits.
3. Define cohort criteria, sample-size rationale, inclusion/exclusion criteria and planned randomisation/blinding.
4. Generate a candidate cohort and preserve exclusions, seed and algorithm version.
5. A reviewer approves the final plan.
6. Promotion to reserved rechecks live animal state, protocol count, genotype, conflicts and welfare status.
7. Procedure scheduling verifies the performer’s current competency and freezes the SOP version.
8. Execution captures actual performer, date/time, dose/route, anaesthesia/analgesia, deviations, outcome and actual severity.
9. The result generates required recovery observations, biosamples, terminal disposition or availability review.
10. Study usage and remaining authorised counts update from actual events.

### Required exceptions

* animal becomes unwell after reservation;
* genotype changes;
* study start is delayed;
* replacement animal is required;
* protocol expires or is amended;
* procedure is aborted;
* unplanned mortality or humane endpoint occurs;
* actual severity exceeds expectation;
* performer competency has expired.

### Recovery

Do not let a completed procedure remain disconnected from required post-procedure care or terminal status. The current rule that a procedure occurrence does not itself change lifecycle status is reasonable for avoiding hidden transitions, but it should create an explicit downstream task where a status decision is expected.

---

## 9.5 Quarantine and cross-lab transfer

### Recommended happy path

1. Create a versioned packet containing source, destination, animals/material, protocol authority, health status, welfare history, proposed placement, billing date and chain-of-custody details.
2. Source approval confirms that the information is complete.
3. Destination approval confirms scientific need, licence capacity and proposed housing.
4. Quarantine/veterinary review confirms health compatibility and required testing.
5. Central operations performs a final live recheck immediately before physical movement.
6. Physical custody is scanned at dispatch and receipt.
7. Ownership, location, billing and authorised counts change together.
8. The destination confirms receipt and condition.

### Required exceptions

* source or destination changes;
* animal develops a welfare concern;
* protocol capacity changes;
* health alert appears;
* receiving cage is no longer available;
* only part of the packet moves;
* movement is cancelled after dispatch;
* animal identifiers do not match at receipt.

### Privacy rule

A source-private research note is reasonable, but **no welfare, health, quarantine, treatment, licence or safety information may be classified as source-private**. The packet needs field-level confidentiality classes.

---

## 9.6 Biosample collection → storage → allocation or disposal

### Recommended happy path

1. Generate or reserve the physical label before collection.
2. Link the sample to animal, study assignment, procedure and actual collection time.
3. Record sample type, material, preservation method, container and amount.
4. Support parent sample, aliquot, derivative and pooled-sample relationships.
5. Scan the sample into a unique freezer/box/position.
6. Every move, allocation, partial consumption, freeze-thaw and shipment creates an event.
7. Disposal records reason, amount and authorised witness where required.
8. Periodic physical inventory reconciles system and storage.

### Required exceptions

* label mismatch or unreadable tube;
* amount differs from expected;
* storage position already occupied;
* freezer excursion;
* sample temporarily removed;
* split or pooled material;
* shipment lost or received damaged;
* sample found without a system record.

### Product-boundary decision

Where the institution already has a biobank or LIMS, Mouse Colony Manager should create the collection event and hand over a durable external sample identifier rather than duplicating the complete custody system.

---

## 9.7 Incorrect action or partial technical failure

Every compound operation should expose four outcomes:

1. **Committed:** all intended records were written.
2. **Rejected:** no records were written because validation failed.
3. **Already committed:** the same idempotency identity was previously completed.
4. **Indeterminate:** the client lost confirmation and must query transaction status rather than resubmit blindly.

For an indeterminate result, the UI should display a privacy-safe correlation ID and a “Check status” action. It should never tell the user simply to repeat an irreversible operation.

A correction must contain:

* original record and event;
* corrected value or superseding event;
* reason;
* person requesting correction;
* person approving, where required;
* affected downstream records;
* reconciliation result;
* timestamps for the actual event, original entry and correction.

---

# 10. Principal risks and unknowns

| Category                            | Risk or unknown                                                                                                                | Consequence                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Animal welfare**                  | Cage notes may be mistaken for a complete welfare record. No veterinarian-owned case lifecycle is evident.                     | Delayed treatment, missed humane endpoint, incomplete continuity of care.                         |
| **Ethical and legal authorisation** | Studies and procedures are not visibly constrained by licence/protocol limits and personnel authority.                         | Unauthorised animal use or procedures and inability to demonstrate compliance.                    |
| **Competency**                      | Role membership appears to grant operational power without procedure-specific competency.                                      | An otherwise authorised user may perform work they are not trained to perform.                    |
| **Separation of duties**            | Facility Admin combines users, rules, billing, operations, procedure execution, overrides and approvals.                       | A single compromised or mistaken account can create and conceal high-impact changes.              |
| **Data integrity**                  | No complete correction model or tamper-evidence specification is supplied.                                                     | Duplicate animals, irreconcilable histories or audit records that cannot defend an investigation. |
| **Identity namespace**              | Global Lab ID uniqueness may force artificial naming and encourage workarounds.                                                | Duplicate aliases, inconsistent labels and migration difficulty.                                  |
| **Physical reconciliation**         | No formal cage census or sample reconciliation workflow is shown.                                                              | System inventory can diverge from physical cages and storage.                                     |
| **Quarantine**                      | Release appears based mainly on hold time, observations and blockers, without structured test evidence or vet approval.        | Incompatible or infected animals could enter a barrier.                                           |
| **Research privacy**                | Facility Admin and Lab Viewer visibility may be broader than operational necessity.                                            | Unnecessary access to unpublished research, experiment notes or sensitive collaborations.         |
| **Location privacy**                | Cage, freezer and technical information are operationally sensitive. Export and support controls are mostly policy statements. | Uncontrolled disclosure of facility or research assets.                                           |
| **Attachment security**             | MVP files are stored locally under a web application path.                                                                     | Accidental direct access, insecure backup, malware or uncontrolled retention.                     |
| **Notification safety**             | Email and in-app notifications may be treated as the escalation mechanism.                                                     | Missed urgent welfare work during provider or worker failure.                                     |
| **Billing**                         | Cage periods and adjustments exist without demonstrated finance reconciliation or independent billing role.                    | Disputed invoices, duplicate charges or weak financial controls.                                  |
| **API security**                    | A wide API surface is described without an authorisation/scoping and lifecycle specification.                                  | Data leakage, unsafe external writes or untraceable automation failures.                          |
| **Resilience**                      | No tested backup, restore, failover or downtime process is supplied.                                                           | Loss of access to current welfare, location and study records.                                    |
| **Migration**                       | Real-data migration is explicitly deployment-specific.                                                                         | Duplicates, lost lineage, incorrect active states and untrustworthy opening balances.             |
| **Accessibility**                   | Dense tables, small controls and status colours dominate the visual design; assistive-technology behaviour is unknown.         | Exclusion, increased error rate and failed institutional accessibility review.                    |
| **Performance**                     | No realistic scale figures or load testing are provided.                                                                       | Slow cage-side operation and unsafe repeated submissions during busy periods.                     |
| **Supportability**                  | Technical console covers queues and migrations but no complete support/on-call model is documented.                            | Prolonged incidents and unclear responsibility.                                                   |
| **Model risk**                      | Breeding and supply recommendations may be accepted because they appear numerical and precise.                                 | Excess breeding, inadequate cohorts or misleading expectations.                                   |

---

# 11. Capabilities that require direct production validation

The following should have explicit evidence rather than being accepted from the guide or screenshots.

| Capability                     | Required validation                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Server-side permissions        | Automated matrix tests across every page, server action and API method for all roles, labs and inactive memberships.          |
| Active-lab isolation           | Cross-lab privacy tests, including guessed URLs, API identifiers, exports, search, attachments and stale browser sessions.    |
| Compound transaction atomicity | Fault injection between each database step; prove no orphan animal, cage, billing, assignment or audit state.                 |
| Idempotency                    | Repeated requests, delayed responses, worker retries and concurrent identical submissions.                                    |
| Optimistic concurrency         | Simultaneous edits across animals, cages, experiments, rules, approvals and transfers.                                        |
| SOP immutability               | Verify content, hash, approval, assignment and procedure snapshot cannot be changed retrospectively.                          |
| Rule engine                    | Boundary testing for age, capacity, sex mix, holding, quarantine, protocol counts and effective dates.                        |
| Audit reconstruction           | Rebuild a complete entity history including correction, actor, role, source, approval and export.                             |
| Transfer confidentiality       | Red-team tests proving source-private research material is hidden while mandatory welfare/safety material follows the animal. |
| Notification delivery          | Provider outage, duplicate response, delayed delivery, bounce, retry exhaustion, dead-letter and escalation testing.          |
| Mobile scanning                | Supported iOS/Android devices, permission denial, damaged labels, low light, manual fallback and interrupted network.         |
| Performance                    | Institutional-scale animals, cages, history, samples, alerts, imports and simultaneous users.                                 |
| Forecast and breeding models   | Retrospective validation, calibration, uncertainty, versioning, rule/model separation and monitored outcomes.                 |
| Backup and recovery            | Database plus attachments, point-in-time restoration, queue reconciliation and post-restore integrity checks.                 |
| Data migration                 | Repeatable dry run, identifier mapping, opening-state reconciliation and signed exception report.                             |

---

# 12. Practical 90-day delivery sequence

A realistic 90-day objective is **controlled pilot readiness**, not full central-unit replacement.

This sequence assumes at least two product engineers, one QA/automation engineer, fractional DevOps/security support and sustained access to facility, veterinary, welfare, compliance and research representatives.

## Days 1–15: decide the product’s contract

**Deliverables**

* signed intended-use and source-of-truth map;
* jurisdiction and institutional policy baseline;
* role/capability/RACI matrix;
* veterinarian, AWB/compliance and training roles;
* data classification and retention requirements;
* P0 state-machine catalogue;
* threat model and deployment architecture;
* prioritised list of existing systems to integrate;
* freeze on new prediction, analytics and UI-expansion features.

**Exit gate**

No unresolved disagreement over who is allowed to perform, approve, correct or inspect each critical action.

## Days 16–35: establish security and data-integrity foundations

**Deliverables**

* production SSO and MFA;
* exact-role and active-lab indicators;
* endpoint-level permission tests;
* protected object storage;
* secret management;
* correction/audit schema;
* consistent timezone-qualified timestamps;
* retention and export logging;
* backup, point-in-time recovery and central monitoring;
* corrected IT landing route;
* removal of distributable fixed development credentials.

**Exit gate**

Security review finds no design-blocking issue; a complete entity history can be reconstructed in a test environment.

## Days 36–60: implement the institutional control layer

**Deliverables**

* protocol/licence and approved-count model;
* competency and supervision model;
* veterinary/welfare case workflow;
* urgent escalation and follow-up;
* controlled facility-rule lifecycle;
* procedure execution record with actual welfare-relevant details;
* downstream follow-up/status tasks;
* source-specific intake;
* structured quarantine tests and veterinary release.

**Exit gate**

Representative unauthorised or welfare-unsafe actions are blocked regardless of UI route or API source.

## Days 61–75: physical truth and exception handling

**Deliverables**

* cage census and discrepancy reconciliation;
* explicit capacity exceptions;
* transfer chain of custody;
* resumable/intentionally idempotent intake;
* correction workflows for animal, cage, litter, weaning, procedure and sample;
* partial-failure status lookup;
* downtime forms and back-entry reconciliation;
* first compliance/management reports.

**Exit gate**

A simulated delivery, quarantine, litter, welfare event, procedure, transfer and correction completes without unexplained or orphaned records.

## Days 76–90: qualification and controlled pilot decision

**Deliverables**

* representative data migration rehearsal;
* full role-based UAT;
* cross-lab privacy testing;
* penetration test and remediation;
* WCAG and mobile tests;
* performance and concurrency tests;
* backup restoration exercise;
* notification-provider failure exercise;
* two-cycle parallel reconciliation plan;
* user training and support runbook;
* pilot go/no-go meeting.

**Exit gate**

Pilot begins only when there are:

* no unresolved critical defects;
* no unresolved high-risk security findings;
* signed veterinary, facility, compliance and IT approval;
* successful restore and downtime exercises;
* documented rollback to the existing authoritative process.

---

## Later roadmap

### Months 4–6

Focus on:

* unified My Work;
* protocol and finance integrations;
* complete report catalogue;
* biosample/LIMS integration;
* full migration tooling;
* accessibility remediation;
* mobile cage-side workflows;
* billing reconciliation;
* work scheduling and staffing.

### Months 7–12

Focus on:

* RFID and cage census hardware;
* rack and environmental integrations;
* advanced cryostorage;
* validated forecasting and breeding optimisation;
* multi-facility architecture;
* analytics warehouse;
* scheduled institutional reporting.

### Beyond 12 months

Only after a separate business and quality decision:

* multi-species;
* GLP/Part 11 validation;
* offline operation;
* multilingual deployment;
* external customer billing;
* sophisticated AI-assisted planning.

---

# 13. Smallest set of questions that must be answered before implementation

1. **What is the intended legal and operational status of this product?**
   Is it a convenience tool, the central facility record, the veterinary record, the protocol-usage record, a study system, a LIMS, or some combination?

2. **Which jurisdictional, accreditation and institutional policies apply?**
   For example, Ireland/EU scientific-animal-protection requirements, institutional AWB policy, local project authorisations, finance controls and any GLP requirement.

3. **Which existing systems remain authoritative?**
   Identity, protocol/licence, training, finance, veterinary, ELN/LIMS, genotyping, environmental monitoring and institutional reporting.

4. **Who has formal authority for each sensitive decision?**
   Protocol owner, designated veterinarian, animal-care and welfare officer, AWB/compliance reviewer, competent procedure performer, facility operations, billing and system administrator.

5. **What information must follow an animal, and what may remain research-private?**
   Welfare, treatment, health, quarantine and authorisation information should not be hidden as lab-private context.

6. **What are the approved escalation and humane-endpoint processes?**
   Including response targets, on-call contacts, treatment authority, unplanned euthanasia, found-dead review and system downtime.

7. **What identity, hosting and data-protection architecture is mandated?**
   IdP, MFA, data residency, encryption, attachment storage, audit access, retention, privacy assessment and support access.

8. **What physical identifiers and infrastructure already exist?**
   Cage-card format, barcode/RFID standard, animal identifiers, rooms/racks, label printers, scanners and freezer location conventions.

9. **What migration data and opening-state quality are available?**
   Current animals, historical events, cages, breeders, protocols, samples, billing balances, duplicate IDs and records that cannot be cleanly mapped.

10. **What are the required resilience and support commitments?**
    RPO, RTO, maintenance windows, on-call owner, incident severity, downtime procedure, restore frequency and acceptable loss of cage-side availability.

11. **What billing model is authoritative?**
    Per-diem, service charges, grants/cost centres, rate changes, internal versus external clients, disputes and finance-system posting.

12. **Which advanced features are truly part of the first institutional release?**
    Forecasting, breeding optimisation, biosamples, cryostorage, research results, RFID and multi-species should not distract from welfare, authorisation and data integrity.

---

# Final recommendation

Mouse Colony Manager has the beginnings of a credible and potentially distinctive academic colony-management product. Its strongest qualities are the coherent role-oriented structure, transactional thinking, transfer handoffs, privacy-aware strain directory and unusually careful documentation.

The current package does **not** support a claim that it is ready to become the authoritative system for a central mouse unit. The product presently models many **records and screens**, but not yet the complete institutional system of authority, welfare, competence, correction and operational recovery surrounding those records.

The recommended decision is:

> **Approve continued development and a controlled parallel pilot, conditional on completion of P0. Do not approve central-facility production replacement, authoritative veterinary use, or regulated-study use at this stage.**

[1]: https://nc3rs.org.uk/our-portfolio/experimental-design-assistant-eda "https://nc3rs.org.uk/our-portfolio/experimental-design-assistant-eda"
[2]: https://www.softmouse.net/ "https://www.softmouse.net/"
[3]: https://transnetyx.com/services/colony "https://transnetyx.com/services/colony"
[4]: https://mosaicvivarium.net/ "https://mosaicvivarium.net/"
[5]: https://www.a-tune.com/products-services-software/animal-research-facility-software/ "https://www.a-tune.com/products-services-software/animal-research-facility-software/"
[6]: https://www.cayuse.com/vivarium-management/ "https://www.cayuse.com/vivarium-management/"
[7]: https://www.instem.com/solutions/study-management/climb/climb-colony-management/ "https://www.instem.com/solutions/study-management/climb/climb-colony-management/"
[8]: https://www.labvantage.com/blog/the-importance-of-maintaining-chain-of-custody-and-audit-trails/ "https://www.labvantage.com/blog/the-importance-of-maintaining-chain-of-custody-and-audit-trails/"
[9]: https://pages.nist.gov/800-63-4/sp800-63.html "https://pages.nist.gov/800-63-4/sp800-63.html"
[10]: https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A02010L0063-20190626&utm_source=chatgpt.com "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A02010L0063-20190626&utm_source=chatgpt.com"
[11]: https://www.nist.gov/document/election-security-series-data-integrity-and-recovery-fact-sheet "https://www.nist.gov/document/election-security-series-data-integrity-and-recovery-fact-sheet"
[12]: https://owasp.org/www-project-application-security-verification-standard/ "https://owasp.org/www-project-application-security-verification-standard/"
[13]: https://www.w3.org/TR/WCAG22/ "https://www.w3.org/TR/WCAG22/"

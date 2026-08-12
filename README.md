# ESSA AP Automation Platform

Enterprise Accounts Payable orchestration platform (AP Portal) built from the
**ESSA AP Automation Solution Architecture v0.2** and the **Detailed Process
Sequence Diagrams v0.1**.

The platform receives invoice bundles from three controlled channels, checks
document completeness, extracts structured data with (mock) Azure OpenAI GPT,
executes configurable deterministic validations including N-way cross-document
reconciliation with SAP reference and biometric attendance data, routes
human-in-the-loop review, exceptions, overrides and Delegation-of-Authority
approvals, hands validated invoices to the SAP integration boundary, and
tracks the returned lifecycle (Draft → Validated → In Progress → Parked →
Posted → Paid) with a complete append-only audit trail.

## Quick start

Requires Node.js ≥ 20.

```bash
npm install
npm run dev
```

- Web portal: http://localhost:5173
- API: http://localhost:4400/api/v1 (health: `/api/v1/health`)

The first start seeds a realistic demo dataset (32+ invoices across Material /
Service / Manpower / Catering / Non-PO categories, 15 vendors, 20+ validation
rules with N-way operands, DoA matrix, attendance data, audit trail). To reset:

```bash
npm run seed:reset   # removes server/data/db.json; restart to reseed
```

### Demo sign-in

Entra ID SSO is **simulated**: pick a user on the login screen to experience
that role (AP Processor, AP Reviewer, DoA Approvers, Tax Reviewer, AP Manager,
Administrator, Support, Auditor). Navigation and actions are permission-driven
in the UI **and** enforced by backend authorization on every protected route.

### Things to try

1. **Upload an invoice** (Invoice Processing → Upload Invoice) against an open
   PO — watch it flow live through classification → extraction → validation →
   approval on the invoice Timeline tab.
2. **HITL review** — open an invoice flagged `Extraction Review`, correct or
   accept low-confidence fields (reason mandatory), complete review and watch
   validation re-run.
3. **N-way validation** — open a Manpower invoice → Validation tab → expand
   R-MNP-001 to see the 4-way Timesheet = Summary = SES = Biometric operands.
4. **Override** — as Meera (AP Manager), override a failed rule with a
   mandatory reason; the previous run is retained and revalidation resumes the
   workflow.
5. **Approve** — work the approval queue (AP Review → DoA → Tax Review →
   Manager); rejection requires a reason and raises an exception.
6. **SAP degraded mode** — SAP Integration page → simulate `DEGRADED` /
   `UNAVAILABLE`; validated invoices queue safely and resume on reconnect.
7. **Biometric push** — Attendance page → "Simulate MIS push" exercises the
   inbound ESSA-MIS API (validate → dedupe → normalize → persist).
8. **Configuration governance** — Administration → Invoice Configuration:
   create a draft version, edit documents/fields/rules, publish with an
   effective date. Published versions are immutable.

## Architecture

```
essa-ap-automation/
├─ server/            Node.js + TypeScript modular backend (Express)
│  ├─ src/core/       correlation, RBAC, audit (append-only), structured
│  │                  logging, async job queue (Service-Bus replaceable)
│  ├─ src/modules/    rule-engine (generic evaluators + N-way + plugin
│  │                  registry), pipeline orchestration
│  ├─ src/routes/     REST /api/v1 (auth, invoices, exceptions, approvals,
│  │                  vendors, integrations, configuration, audit, reports)
│  ├─ src/integrations/  MOCK adapters: Azure GPT, SharePoint, SAP
│  ├─ src/db/seed/    realistic demo dataset (scenario-driven, runs the
│  │                  real pipeline for consistency)
│  └─ db/schema.sql   full PostgreSQL DDL (target data architecture)
└─ web/               React 18 + TypeScript + Tailwind portal
   ├─ src/components/ ESSA design system (tokens, DataTable, StatusBadge…)
   └─ src/pages/      40+ screens: dashboard, invoice workbench, exceptions,
                      approvals, vendors, SAP/biometric, admin configuration,
                      audit, technical logs, reports
```

### Key architecture principles implemented

| Principle | Implementation |
|---|---|
| Configuration before code | Categories/documents/fields/prompts/mappings/rules/workflows are versioned metadata with draft → test → publish governance |
| Deterministic before AI | All financial checks run in the rule engine; GPT (mock) only extracts/classifies |
| Two independent document controls | `CategoryDocument.requirementType` (availability) vs `DocumentField.mandatory` (content) |
| Hybrid rule engine | Generic evaluators + N-way operands; custom logic only via approved TypeScript plugin handler keys — no executable code in data |
| SAP dependency isolation | Typed adapters, idempotent handoffs, retry/backoff, dead-letter, degraded-mode banners; technical failures never become business rejections |
| Audit by design | Append-only audit events with who/what/when/why/before/after/correlation ID; separate structured technical logs |
| Least privilege | Entra (mock) authentication + portal RBAC; backend authorization on every protected operation |

### Swapping mocks for production services

Each mock adapter is isolated behind an interface:

| Mock | Production replacement |
|---|---|
| `server/src/routes/auth.ts` + auth middleware | Microsoft Entra ID OIDC validation |
| `integrations/azure-gpt.mock.ts` | Azure OpenAI GPT deployment (prompt/schema from configuration) |
| `integrations/sharepoint.mock.ts` | Microsoft Graph / SharePoint |
| `integrations/sap.mock.ts` | Agreed SAP interface contract (reference data, handoff, status) |
| `core/jobs.ts` (in-process queue) | Azure Service Bus |
| `core/store.ts` (embedded snapshot store) | PostgreSQL repositories against `db/schema.sql` |

Secrets belong in environment variables / Azure Key Vault — none are stored in
source.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | API (:4400) + web (:5173) with hot reload |
| `npm run build` | Type-check and build both workspaces |
| `npm run typecheck` | Strict TypeScript checks |
| `npm run seed:reset` | Reset the demo dataset |

---
Confidential — internal ESSA project deliverable (demo build).

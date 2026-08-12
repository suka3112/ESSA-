-- ============================================================================
-- ESSA AP Automation Platform - PostgreSQL schema (target data architecture)
-- ----------------------------------------------------------------------------
-- This DDL is the production data model per the Solution Architecture v0.2
-- (§18 Data Architecture, Appendix B). The demo runtime uses an embedded
-- store exposing the same repository surface; swap the store implementation
-- (server/src/core/store.ts) for a PostgreSQL-backed repository to deploy
-- against this schema. Document binaries live in SharePoint (P11) - the
-- database stores metadata and stable repository references only.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ap;

-- ------------------------------------------------------- identity & access
CREATE TABLE ap.app_user (
  id              TEXT PRIMARY KEY,
  entra_object_id TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  department      TEXT,
  title           TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ap.role (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE ap.permission (
  code        TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE ap.role_permission (
  role_id         TEXT NOT NULL REFERENCES ap.role(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES ap.permission(code),
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE ap.user_role (
  user_id TEXT NOT NULL REFERENCES ap.app_user(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES ap.role(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE ap.user_group (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE ap.user_group_member (
  group_id TEXT NOT NULL REFERENCES ap.user_group(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES ap.app_user(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

-- ----------------------------------------------------------- configuration
CREATE TABLE ap.configuration_version (
  id             TEXT PRIMARY KEY,
  version_no     TEXT NOT NULL UNIQUE,
  label          TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('DRAFT','TESTING','ACTIVE','RETIRED')),
  effective_from DATE,
  effective_to   DATE,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by    TEXT,
  approved_at    TIMESTAMPTZ,
  published_by   TEXT,
  published_at   TIMESTAMPTZ,
  notes          TEXT
);

CREATE TABLE ap.invoice_category (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  po_based    BOOLEAN NOT NULL DEFAULT TRUE,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE ap.document_type (
  id                      TEXT PRIMARY KEY,
  code                    TEXT NOT NULL UNIQUE,
  name                    TEXT NOT NULL,
  purpose                 TEXT,
  default_extraction_mode TEXT NOT NULL CHECK (default_extraction_mode IN ('AVAILABILITY_ONLY','EXTRACT_ONLY','EXTRACT_AND_VALIDATE')),
  active                  BOOLEAN NOT NULL DEFAULT TRUE
);

-- Two independent document controls: document mandatory vs field mandatory (§12)
CREATE TABLE ap.category_document (
  id                          TEXT PRIMARY KEY,
  config_version_id           TEXT NOT NULL REFERENCES ap.configuration_version(id),
  category_id                 TEXT NOT NULL REFERENCES ap.invoice_category(id),
  document_type_id            TEXT NOT NULL REFERENCES ap.document_type(id),
  requirement_type            TEXT NOT NULL CHECK (requirement_type IN ('MANDATORY','OPTIONAL','CONDITIONAL')),
  condition_expr              TEXT,
  check_mode                  TEXT NOT NULL CHECK (check_mode IN ('AVAILABILITY_ONLY','EXTRACT_ONLY','EXTRACT_AND_VALIDATE')),
  content_check_required      BOOLEAN NOT NULL,
  availability_check_required BOOLEAN NOT NULL DEFAULT TRUE,
  allow_multiple              BOOLEAN NOT NULL DEFAULT FALSE,
  missing_severity            TEXT NOT NULL,
  blocking                    BOOLEAN NOT NULL DEFAULT TRUE,
  override_allowed            BOOLEAN NOT NULL DEFAULT FALSE,
  sequence                    INT NOT NULL,
  active                      BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (config_version_id, category_id, document_type_id)
);

CREATE TABLE ap.document_field (
  id                   TEXT PRIMARY KEY,
  config_version_id    TEXT NOT NULL REFERENCES ap.configuration_version(id),
  category_id          TEXT NOT NULL REFERENCES ap.invoice_category(id),
  document_type_id     TEXT NOT NULL REFERENCES ap.document_type(id),
  field_code           TEXT NOT NULL,
  label                TEXT NOT NULL,
  data_type            TEXT NOT NULL CHECK (data_type IN ('TEXT','NUMBER','CURRENCY','DATE','BOOLEAN','CODE','LIST','PERCENTAGE')),
  mandatory            BOOLEAN NOT NULL DEFAULT FALSE,
  extraction_required  BOOLEAN NOT NULL DEFAULT TRUE,
  confidence_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.700,
  manual_edit_allowed  BOOLEAN NOT NULL DEFAULT TRUE,
  display_order        INT NOT NULL,
  sap_mapped           BOOLEAN NOT NULL DEFAULT FALSE,
  active               BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE ap.prompt_template (
  id                     TEXT PRIMARY KEY,
  document_type_id       TEXT NOT NULL REFERENCES ap.document_type(id),
  name                   TEXT NOT NULL,
  version                TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('DRAFT','TESTING','ACTIVE','RETIRED')),
  system_instruction     TEXT NOT NULL,
  extraction_instruction TEXT NOT NULL,
  output_schema          JSONB NOT NULL,
  confidence_threshold   NUMERIC(4,3) NOT NULL,
  effective_date         DATE,
  test_sample_count      INT NOT NULL DEFAULT 0,
  created_by             TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ap.extraction_profile (
  id                 TEXT PRIMARY KEY,
  document_type_id   TEXT NOT NULL REFERENCES ap.document_type(id),
  engine             TEXT NOT NULL DEFAULT 'AZURE_OPENAI_GPT',
  model_deployment   TEXT NOT NULL,
  prompt_template_id TEXT NOT NULL REFERENCES ap.prompt_template(id),
  review_threshold   NUMERIC(4,3) NOT NULL,
  version            TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('DRAFT','TESTING','ACTIVE','RETIRED'))
);

CREATE TABLE ap.field_mapping (
  id                TEXT PRIMARY KEY,
  config_version_id TEXT NOT NULL REFERENCES ap.configuration_version(id),
  category_id       TEXT NOT NULL REFERENCES ap.invoice_category(id),
  document_type_id  TEXT NOT NULL REFERENCES ap.document_type(id),
  field_code        TEXT NOT NULL,
  field_label       TEXT NOT NULL,
  sap_field         TEXT NOT NULL,
  sap_description   TEXT,
  match_type        TEXT NOT NULL CHECK (match_type IN ('EXACT_MATCH','AMOUNT_MATCH','DATE_MATCH','CODE_MATCH','LIST_MATCH','RANGE_MATCH')),
  tolerance_rule    TEXT,
  mandatory         BOOLEAN NOT NULL DEFAULT TRUE,
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
);

-- ------------------------------------------------------------- rule engine
CREATE TABLE ap.validation_rule (
  id                TEXT PRIMARY KEY,
  config_version_id TEXT NOT NULL REFERENCES ap.configuration_version(id),
  rule_code         TEXT NOT NULL,
  rule_name         TEXT NOT NULL,
  description       TEXT,
  scope             TEXT NOT NULL CHECK (scope IN ('GLOBAL','CATEGORY','DOCUMENT','FIELD','CROSS_DOCUMENT')),
  category_id       TEXT REFERENCES ap.invoice_category(id),
  document_type_id  TEXT REFERENCES ap.document_type(id),
  rule_type         TEXT NOT NULL,
  comparator        TEXT,
  tolerance_type    TEXT,
  tolerance_value   NUMERIC(18,4),
  severity          TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','ERROR','HARD_FAIL')),
  blocking          BOOLEAN NOT NULL DEFAULT TRUE,
  override_allowed  BOOLEAN NOT NULL DEFAULT FALSE,
  override_role     TEXT,
  priority          INT NOT NULL,
  handler_key       TEXT,          -- approved plugin key only; never executable code
  handler_params    JSONB,
  effective_from    DATE,
  version           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  UNIQUE (config_version_id, rule_code)
);

-- N-way model: a rule is a header plus 2..N operands (§14.3)
CREATE TABLE ap.rule_operand (
  id                 TEXT PRIMARY KEY,
  rule_id            TEXT NOT NULL REFERENCES ap.validation_rule(id) ON DELETE CASCADE,
  alias              TEXT NOT NULL,
  label              TEXT NOT NULL,
  source_type        TEXT NOT NULL CHECK (source_type IN ('DOCUMENT_FIELD','SAP','BIOMETRIC','CONFIG','MASTER','CALCULATED')),
  document_type_code TEXT,
  field_code         TEXT,
  sap_entity         TEXT,
  sap_field          TEXT,
  aggregation        TEXT,
  constant_value     TEXT,
  sequence           INT NOT NULL
);

CREATE TABLE ap.custom_rule_binding (
  rule_id         TEXT PRIMARY KEY REFERENCES ap.validation_rule(id) ON DELETE CASCADE,
  handler_key     TEXT NOT NULL,
  parameters_json JSONB
);

-- ------------------------------------------------------ invoice transaction
CREATE TABLE ap.invoice (
  id                    TEXT PRIMARY KEY,
  invoice_number        TEXT NOT NULL,
  vendor_code           TEXT NOT NULL,
  vendor_name           TEXT NOT NULL,
  category_id           TEXT NOT NULL REFERENCES ap.invoice_category(id),
  invoice_date          DATE NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL,
  amount                NUMERIC(18,2) NOT NULL,
  subtotal              NUMERIC(18,2) NOT NULL,
  tax_amount            NUMERIC(18,2) NOT NULL,
  currency              TEXT NOT NULL,
  po_number             TEXT,
  department            TEXT NOT NULL,
  company_code          TEXT NOT NULL,
  source                TEXT NOT NULL CHECK (source IN ('EMAIL','SHAREPOINT','MANUAL_UPLOAD')),
  stage                 TEXT NOT NULL,
  lifecycle             TEXT NOT NULL CHECK (lifecycle IN ('DRAFT','VALIDATED','IN_PROGRESS','PARKED','POSTED','PAID')),
  processing_flag       TEXT,
  sla_due_at            TIMESTAMPTZ,
  sla_breached          BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_to           TEXT REFERENCES ap.app_user(id),
  priority              TEXT NOT NULL DEFAULT 'NORMAL',
  config_version_id     TEXT NOT NULL REFERENCES ap.configuration_version(id),
  correlation_id        TEXT NOT NULL,
  description           TEXT,
  sap_document_no       TEXT,
  sap_fiscal_year       TEXT,
  payment_status        TEXT,
  payment_date          DATE,
  payment_ref           TEXT,
  tax_review_required   BOOLEAN NOT NULL DEFAULT FALSE,
  extraction_confidence NUMERIC(4,3),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_lifecycle ON ap.invoice(lifecycle);
CREATE INDEX idx_invoice_vendor    ON ap.invoice(vendor_code);
CREATE INDEX idx_invoice_received  ON ap.invoice(received_at DESC);

CREATE TABLE ap.invoice_line (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES ap.invoice(id) ON DELETE CASCADE,
  line_no    INT NOT NULL,
  description TEXT NOT NULL,
  quantity   NUMERIC(18,3) NOT NULL,
  uom        TEXT,
  unit_price NUMERIC(18,4) NOT NULL,
  amount     NUMERIC(18,2) NOT NULL,
  po_item    TEXT,
  tax_code   TEXT
);

-- SharePoint is the binary repository; only metadata + references here (§19)
CREATE TABLE ap.invoice_document (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES ap.invoice(id) ON DELETE CASCADE,
  document_type_id  TEXT NOT NULL REFERENCES ap.document_type(id),
  file_name         TEXT NOT NULL,
  pages             INT,
  size_kb           INT,
  mime_type         TEXT,
  source            TEXT NOT NULL,
  sharepoint_url    TEXT NOT NULL,
  checksum          TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('AVAILABLE','MISSING','SUPERSEDED','REJECTED')),
  extraction_status TEXT NOT NULL,
  requirement_type  TEXT NOT NULL,
  check_mode        TEXT NOT NULL,
  version           INT NOT NULL DEFAULT 1,
  superseded_by_id  TEXT,
  uploaded_by       TEXT NOT NULL,
  uploaded_at       TIMESTAMPTZ NOT NULL
);

-- --------------------------------------------------------------- extraction
CREATE TABLE ap.extraction_run (
  id                   TEXT PRIMARY KEY,
  invoice_id           TEXT NOT NULL REFERENCES ap.invoice(id) ON DELETE CASCADE,
  document_id          TEXT NOT NULL REFERENCES ap.invoice_document(id),
  document_type_id     TEXT NOT NULL,
  profile_version      TEXT NOT NULL,
  prompt_version       TEXT NOT NULL,
  model_deployment     TEXT NOT NULL,
  status               TEXT NOT NULL,
  started_at           TIMESTAMPTZ NOT NULL,
  completed_at         TIMESTAMPTZ,
  duration_ms          INT,
  tokens_in            INT,
  tokens_out           INT,
  field_count          INT NOT NULL DEFAULT 0,
  low_confidence_count INT NOT NULL DEFAULT 0,
  correlation_id       TEXT NOT NULL,
  error                TEXT
);

CREATE TABLE ap.extracted_field (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES ap.invoice(id) ON DELETE CASCADE,
  document_id       TEXT NOT NULL REFERENCES ap.invoice_document(id),
  extraction_run_id TEXT NOT NULL REFERENCES ap.extraction_run(id),
  document_type_id  TEXT NOT NULL,
  field_code        TEXT NOT NULL,
  label             TEXT NOT NULL,
  data_type         TEXT NOT NULL,
  raw_value         TEXT,
  value             TEXT,
  confidence        NUMERIC(4,3) NOT NULL,
  confidence_band   TEXT NOT NULL CHECK (confidence_band IN ('HIGH','MEDIUM','LOW')),
  page              INT,
  evidence          TEXT,
  validation_status TEXT NOT NULL,
  mandatory         BOOLEAN NOT NULL DEFAULT FALSE
);

-- corrections never overwrite history (§15)
CREATE TABLE ap.field_correction (
  id             TEXT PRIMARY KEY,
  field_id       TEXT NOT NULL REFERENCES ap.extracted_field(id) ON DELETE CASCADE,
  previous_value TEXT,
  new_value      TEXT NOT NULL,
  corrected_by   TEXT NOT NULL REFERENCES ap.app_user(id),
  reason         TEXT NOT NULL,
  corrected_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------- validation
CREATE TABLE ap.validation_run (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES ap.invoice(id) ON DELETE CASCADE,
  config_version_id TEXT NOT NULL,
  trigger_type      TEXT NOT NULL,
  status            TEXT NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL,
  completed_at      TIMESTAMPTZ,
  started_by        TEXT NOT NULL,
  summary           JSONB NOT NULL,
  outcome           TEXT NOT NULL CHECK (outcome IN ('PASS','FAIL','PENDING')),
  correlation_id    TEXT NOT NULL
);

CREATE TABLE ap.validation_result (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES ap.validation_run(id) ON DELETE CASCADE,
  invoice_id       TEXT NOT NULL,
  rule_id          TEXT NOT NULL,
  rule_code        TEXT NOT NULL,
  rule_name        TEXT NOT NULL,
  rule_type        TEXT NOT NULL,
  severity         TEXT NOT NULL,
  blocking         BOOLEAN NOT NULL,
  override_allowed BOOLEAN NOT NULL,
  result           TEXT NOT NULL CHECK (result IN ('PASS','WARNING','FAIL','HARD_FAIL','PENDING','OVERRIDDEN','SKIPPED')),
  expected         TEXT,
  actual           TEXT,
  tolerance        TEXT,
  difference_pct   NUMERIC(9,4),
  operand_values   JSONB NOT NULL,   -- operand evidence retained for audit/explanation
  message          TEXT,
  rule_version     TEXT NOT NULL,
  override_json    JSONB             -- by / role / reason / at / previous_result
);

-- --------------------------------------------------------------- exceptions
CREATE TABLE ap.exception (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  invoice_id     TEXT NOT NULL REFERENCES ap.invoice(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  severity       TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','WAITING','RESOLVED','CLOSED')),
  title          TEXT NOT NULL,
  detail         TEXT,
  rule_code      TEXT,
  field_code     TEXT,
  document_type_id TEXT,
  assigned_to    TEXT REFERENCES ap.app_user(id),
  created_at     TIMESTAMPTZ NOT NULL,
  sla_due_at     TIMESTAMPTZ,
  resolved_at    TIMESTAMPTZ,
  resolution     TEXT,
  retry_count    INT NOT NULL DEFAULT 0,
  technical      BOOLEAN NOT NULL DEFAULT FALSE,
  correlation_id TEXT NOT NULL
);

CREATE TABLE ap.exception_action (
  id           TEXT PRIMARY KEY,
  exception_id TEXT NOT NULL REFERENCES ap.exception(id) ON DELETE CASCADE,
  at           TIMESTAMPTZ NOT NULL,
  by_user      TEXT NOT NULL,
  action       TEXT NOT NULL,
  note         TEXT
);

-- ----------------------------------------------------------------- workflow
CREATE TABLE ap.workflow_definition (
  id                TEXT PRIMARY KEY,
  config_version_id TEXT NOT NULL,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  category_id       TEXT REFERENCES ap.invoice_category(id),
  steps             JSONB NOT NULL,
  status            TEXT NOT NULL,
  version           TEXT NOT NULL
);

CREATE TABLE ap.workflow_instance (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES ap.invoice(id) ON DELETE CASCADE,
  definition_id   TEXT NOT NULL REFERENCES ap.workflow_definition(id),
  status          TEXT NOT NULL,
  current_step_no INT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ
);

CREATE TABLE ap.workflow_step_instance (
  id           TEXT PRIMARY KEY,
  instance_id  TEXT NOT NULL REFERENCES ap.workflow_instance(id) ON DELETE CASCADE,
  invoice_id   TEXT NOT NULL,
  step_no      INT NOT NULL,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,
  assigned_to  TEXT,
  delegated_to TEXT,
  status       TEXT NOT NULL,
  due_at       TIMESTAMPTZ,
  sla_breached BOOLEAN NOT NULL DEFAULT FALSE,
  acted_by     TEXT,
  acted_at     TIMESTAMPTZ,
  comment      TEXT,
  channel      TEXT
);

CREATE TABLE ap.doa_entry (
  id               TEXT PRIMARY KEY,
  department       TEXT NOT NULL,
  level_no         INT NOT NULL,
  role             TEXT NOT NULL,
  approver_user_id TEXT NOT NULL REFERENCES ap.app_user(id),
  min_amount       NUMERIC(18,2) NOT NULL,
  max_amount       NUMERIC(18,2),
  currency         TEXT NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------------- vendor
-- SAP is the vendor master source of truth; snapshot is read-only (§10)
CREATE TABLE ap.vendor_snapshot (
  code                TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  legal_name          TEXT,
  address             TEXT,
  city                TEXT,
  state               TEXT,
  country             TEXT,
  gstin               TEXT,
  pan                 TEXT,
  bank_account_masked TEXT,
  bank_name           TEXT,
  payment_terms       TEXT,
  currency            TEXT,
  company_codes       TEXT[],
  classification      TEXT,
  sap_status          TEXT NOT NULL,
  last_sync_at        TIMESTAMPTZ NOT NULL,
  sap_ref             TEXT NOT NULL,
  email               TEXT,
  phone               TEXT
);

CREATE TABLE ap.vendor_portal_control (
  vendor_code   TEXT PRIMARY KEY REFERENCES ap.vendor_snapshot(code),
  negative_flag BOOLEAN NOT NULL DEFAULT FALSE,
  ap_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  reason        TEXT,
  remarks       TEXT,
  updated_by    TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE ap.vendor_control_history (
  id          TEXT PRIMARY KEY,
  vendor_code TEXT NOT NULL REFERENCES ap.vendor_snapshot(code),
  action      TEXT NOT NULL CHECK (action IN ('NEGATIVE_MARKED','NEGATIVE_REMOVED','ENABLED','DISABLED')),
  reason      TEXT,
  by_user     TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------- SAP integration
CREATE TABLE ap.sap_purchase_order (
  po_number    TEXT PRIMARY KEY,
  vendor_code  TEXT NOT NULL,
  vendor_name  TEXT NOT NULL,
  company_code TEXT NOT NULL,
  department   TEXT,
  currency     TEXT NOT NULL,
  po_type      TEXT NOT NULL,
  status       TEXT NOT NULL,
  total_amount NUMERIC(18,2) NOT NULL,
  open_amount  NUMERIC(18,2) NOT NULL,
  valid_from   DATE,
  valid_to     DATE,
  items        JSONB NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ap.sap_grn (
  grn_number     TEXT PRIMARY KEY,
  po_number      TEXT NOT NULL,
  posting_date   DATE NOT NULL,
  total_quantity NUMERIC(18,3) NOT NULL,
  amount         NUMERIC(18,2) NOT NULL,
  movement_type  TEXT,
  items          JSONB NOT NULL
);

CREATE TABLE ap.sap_ses (
  ses_number          TEXT PRIMARY KEY,
  po_number           TEXT NOT NULL,
  posting_date        DATE NOT NULL,
  service_description TEXT,
  quantity            NUMERIC(18,3) NOT NULL,
  uom                 TEXT,
  amount              NUMERIC(18,2) NOT NULL,
  accepted_amount     NUMERIC(18,2) NOT NULL,
  status              TEXT NOT NULL
);

-- idempotent outbound handoff (outbox pattern, §17.3/17.5)
CREATE TABLE ap.sap_handoff (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES ap.invoice(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL,
  attempts        INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL,
  last_attempt_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  sap_document_no TEXT,
  sap_fiscal_year TEXT,
  message         TEXT,
  error_code      TEXT,
  correlation_id  TEXT NOT NULL,
  payload_summary JSONB NOT NULL
);

-- -------------------------------------------------------- biometric (push)
CREATE TABLE ap.attendance_batch (
  id             TEXT PRIMARY KEY,
  source         TEXT NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL,
  record_count   INT NOT NULL,
  accepted       INT NOT NULL,
  duplicates     INT NOT NULL,
  rejected       INT NOT NULL,
  status         TEXT NOT NULL,
  correlation_id TEXT NOT NULL
);

CREATE TABLE ap.attendance_record (
  id            TEXT PRIMARY KEY,
  batch_id      TEXT NOT NULL REFERENCES ap.attendance_batch(id),
  source        TEXT NOT NULL,
  site          TEXT,
  vendor_code   TEXT NOT NULL,
  employee_id   TEXT NOT NULL,
  employee_name TEXT,
  att_date      DATE NOT NULL,
  present       BOOLEAN NOT NULL,
  hours         NUMERIC(6,2) NOT NULL,
  ot_hours      NUMERIC(6,2) NOT NULL DEFAULT 0,
  meal_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  pushed_at     TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL,
  UNIQUE (vendor_code, employee_id, att_date)
);
CREATE INDEX idx_attendance_vendor_month ON ap.attendance_record(vendor_code, att_date);

-- ------------------------------------------------------------ notifications
CREATE TABLE ap.notification (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES ap.app_user(id),
  category   TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  invoice_id TEXT,
  entity_ref TEXT,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  channel    TEXT NOT NULL
);

CREATE TABLE ap.notification_rule (
  id                TEXT PRIMARY KEY,
  config_version_id TEXT NOT NULL,
  event             TEXT NOT NULL,
  label             TEXT NOT NULL,
  channels          TEXT[] NOT NULL,
  recipients        TEXT NOT NULL,
  template          TEXT NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------- audit & technical logging
-- Append-only: application role has INSERT/SELECT only; no UPDATE/DELETE (§20)
CREATE TABLE ap.audit_event (
  id             TEXT PRIMARY KEY,
  event_time     TIMESTAMPTZ NOT NULL,
  actor_type     TEXT NOT NULL,
  actor_id       TEXT NOT NULL,
  actor_name     TEXT NOT NULL,
  actor_role     TEXT,
  event_type     TEXT NOT NULL,
  category       TEXT NOT NULL,
  action         TEXT NOT NULL,
  module         TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  entity_ref     TEXT,
  invoice_id     TEXT,
  result         TEXT NOT NULL,
  reason         TEXT,
  old_value      JSONB,
  new_value      JSONB,
  correlation_id TEXT NOT NULL,
  source         TEXT NOT NULL,
  ip             TEXT
);
CREATE INDEX idx_audit_time     ON ap.audit_event(event_time DESC);
CREATE INDEX idx_audit_invoice  ON ap.audit_event(invoice_id);
CREATE INDEX idx_audit_corr     ON ap.audit_event(correlation_id);
REVOKE UPDATE, DELETE ON ap.audit_event FROM PUBLIC;

CREATE TABLE ap.technical_log (
  id             TEXT PRIMARY KEY,
  ts             TIMESTAMPTZ NOT NULL,
  level          TEXT NOT NULL,
  service        TEXT NOT NULL,
  module         TEXT NOT NULL,
  event          TEXT NOT NULL,
  message        TEXT NOT NULL,
  correlation_id TEXT,
  transaction_id TEXT,
  request_id     TEXT,
  job_id         TEXT,
  invoice_id     TEXT,
  integration    TEXT,
  status         TEXT,
  duration_ms    INT,
  error_code     TEXT,
  retry_count    INT,
  environment    TEXT NOT NULL
);
CREATE INDEX idx_techlog_corr ON ap.technical_log(correlation_id);

CREATE TABLE ap.integration_job (
  id             TEXT PRIMARY KEY,
  job_type       TEXT NOT NULL,
  ref_id         TEXT,
  invoice_id     TEXT,
  status         TEXT NOT NULL,
  attempts       INT NOT NULL DEFAULT 0,
  max_attempts   INT NOT NULL DEFAULT 3,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL,
  next_retry_at  TIMESTAMPTZ,
  correlation_id TEXT NOT NULL,
  detail         TEXT,
  error          TEXT
);

CREATE TABLE ap.timeline_event (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES ap.invoice(id) ON DELETE CASCADE,
  at             TIMESTAMPTZ NOT NULL,
  actor_type     TEXT NOT NULL,
  actor_name     TEXT NOT NULL,
  event          TEXT NOT NULL,
  title          TEXT NOT NULL,
  detail         TEXT,
  status         TEXT NOT NULL,
  reference      TEXT,
  correlation_id TEXT
);

CREATE TABLE ap.email_ingestion_item (
  id          TEXT PRIMARY KEY,
  sender      TEXT NOT NULL,
  subject     TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  attachments JSONB NOT NULL,
  status      TEXT NOT NULL,
  invoice_id  TEXT,
  error       TEXT
);

CREATE TABLE ap.sharepoint_monitor_item (
  id          TEXT PRIMARY KEY,
  folder      TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  modified_at TIMESTAMPTZ NOT NULL,
  size_kb     INT,
  status      TEXT NOT NULL,
  invoice_id  TEXT
);

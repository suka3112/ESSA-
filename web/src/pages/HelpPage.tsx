import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { Card, PageHeader } from '@/components/ui';

const FAQS: { q: string; a: string }[] = [
  { q: 'How do invoices enter the platform?', a: 'Through three controlled channels: the AP shared mailbox (invoice@essa.co.in), continuously monitored SharePoint folders, and the manual portal upload fallback. All three converge into the same security check → classification → completeness → extraction → validation pipeline. Email bodies are never treated as invoice data — only attachments are processed, and one PDF must contain exactly one invoice.' },
  { q: 'What is the difference between document availability and field validation?', a: 'They are two independent controls. Document availability checks whether a configured document (e.g. Attendance Sheet) is present in the bundle — some documents are availability-only and are never sent to the AI. Field mandatory rules apply to the content of documents that are extraction-enabled. An optional document can still carry mandatory fields when it is supplied.' },
  { q: 'When does an invoice go to human review (HITL)?', a: 'When AI extraction returns a field below the configured confidence threshold, when schema validation fails, or when configured review criteria trigger. Reviewers accept or correct each flagged field — every correction records the previous value, reviewer, reason and timestamp, then validation re-runs automatically.' },
  { q: 'What does an N-way validation rule do?', a: 'A rule is a header plus 2..N operands, so it can reconcile several sources at once — e.g. Timesheet hours = Manhour Summary = SES accepted manhours = biometric attendance hours (within 1%). Operands can come from document fields, SAP reference data (PO/GRN/SES), biometric data pushed by ESSA MIS, or configured values.' },
  { q: 'Who can override a failed validation?', a: 'Only rules configured as override-allowed can be overridden, and only by the authorized role (typically AP Manager). A mandatory reason is captured, the previous result is retained, an audit event is written, and revalidation runs with the override applied. Hard-fail controls (e.g. negative-flagged vendor) cannot be overridden.' },
  { q: 'What happens when SAP is down?', a: 'Nothing is lost and nothing is rejected. The portal stays fully available through direct Entra login. SAP-dependent validations show as Pending SAP Validation, validated invoices queue for handoff with retry/backoff, and technical failures surface as retryable integration exceptions — never business rejections.' },
  { q: 'What is the invoice lifecycle?', a: 'Draft → Validated → In Progress → Parked → Posted → Paid. Draft covers everything until mandatory completeness and validations pass. Statuses from Parked onward are confirmed by the SAP interface; the portal never invents SAP states.' },
  { q: 'How is configuration changed safely?', a: 'Configuration (categories, document types, fields, prompts, mappings, rules, workflows, notifications) is versioned. Admins create a draft version, test it against samples, obtain review, then publish with an effective date. Published versions are immutable — every invoice records the configuration version it was processed with.' },
  { q: 'Where does attendance data come from?', a: 'ESSA MIS pushes biometric attendance/availability to the platform\'s secure inbound API — the platform never polls the biometric systems. Batches are authenticated, schema-validated, deduplicated and normalized before the rule engine consumes them.' },
  { q: 'Who do I contact for support?', a: 'Raise a ticket with the IT Service Desk quoting the correlation ID shown on any error message or in the invoice timeline. Support users can trace the same correlation ID across audit events, technical logs and integration jobs.' },
];

export default function HelpPage() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Help & FAQs' }]}
        title="Help & FAQs"
        description="How the ESSA AP Automation platform processes, validates and posts vendor invoices."
      />
      <Card pad={false}>
        <div className="divide-y divide-line-soft">
          {FAQS.map((f, i) => (
            <div key={i}>
              <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-essa-50/50" aria-expanded={open === i}>
                <span className="text-sm font-medium text-ink">{f.q}</span>
                <ChevronDown size={15} className={clsx('shrink-0 text-ink-muted transition-transform', open === i && 'rotate-180')} />
              </button>
              {open === i && <p className="px-4 pb-4 text-xs leading-relaxed text-ink-secondary">{f.a}</p>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

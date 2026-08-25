/**
 * SAP Mapping tab — visualises the mapping process for this invoice:
 * extracted field → normalized value → configured SAP field → reference
 * comparison (match type + tolerance) → result.
 */
import { ArrowRight } from 'lucide-react';
import { titleCase } from '@/lib/format';
import { Badge, Card, DataTable, StatusBadge, type Column } from '@/components/ui';
import type { InvoiceDetail, MappingRow } from './types';

const STEPS = [
  { label: 'Extract', detail: 'Azure GPT reads the document fields' },
  { label: 'Normalize', detail: 'Dates → ISO, amounts → decimal, codes → uppercase' },
  { label: 'Map', detail: 'Configured SAP field (Admin → SAP Field Mapping)' },
  { label: 'Compare', detail: 'Against SAP reference data per match type + tolerance' },
  { label: 'Result', detail: 'Matched / Mismatch / Awaiting SAP confirmation' },
];

export function MappingTab({ detail }: { detail: InvoiceDetail }) {
  const rows = detail.mappingEvaluation ?? [];
  const summary = {
    matched: rows.filter((r) => r.result === 'MATCHED').length,
    mismatch: rows.filter((r) => r.result === 'MISMATCH').length,
    awaiting: rows.filter((r) => r.result === 'AWAITING_SAP').length,
    captured: rows.filter((r) => r.result === 'CAPTURED').length,
    missing: rows.filter((r) => r.result === 'NOT_EXTRACTED').length,
  };

  const columns: Column<MappingRow>[] = [
    { key: 'doc', header: 'Document', render: (r) => <span className="text-xs">{r.documentTypeName}</span> },
    {
      key: 'field', header: 'Extracted Field', render: (r) => (
        <div>
          <span className="font-medium">{r.fieldLabel}</span>
          {r.mandatory && <span className="ml-1 text-semantic-error">*</span>}
          <span className="block font-mono text-2xs text-ink-faint">{r.fieldCode}</span>
        </div>
      ),
    },
    {
      key: 'extracted', header: 'Extracted Value', render: (r) => (
        <div className="max-w-44">
          <p className="truncate font-medium" title={r.extractedValue ?? undefined}>{r.extractedValue ?? <span className="text-ink-faint">not extracted</span>}</p>
          {r.confidence != null && <p className="text-2xs text-ink-faint">confidence {(r.confidence * 100).toFixed(0)}%</p>}
        </div>
      ),
    },
    {
      key: 'sap', header: 'SAP Field', render: (r) => (
        <div>
          <span className="font-mono text-xs text-essa-700">{r.sapField}</span>
          <span className="block text-2xs text-ink-muted">{r.sapDescription}</span>
        </div>
      ),
    },
    { key: 'match', header: 'Match Type', render: (r) => <Badge tone="neutral">{titleCase(r.matchType)}</Badge> },
    { key: 'tol', header: 'Tolerance', render: (r) => <span className="text-xs">{r.toleranceRule}</span> },
    {
      key: 'ref', header: 'SAP Reference', render: (r) => (
        <div className="max-w-44">
          <p className="truncate font-medium" title={String(r.referenceValue ?? '')}>
            {r.referenceValue == null ? <span className="text-ink-faint">—</span> : typeof r.referenceValue === 'number' ? r.referenceValue.toLocaleString('en-US') : r.referenceValue}
          </p>
          <p className="truncate text-2xs text-ink-muted">{r.referenceSource}</p>
        </div>
      ),
    },
    {
      key: 'result', header: 'Result', render: (r) => (
        <div>
          <StatusBadge value={r.result} label={r.result === 'AWAITING_SAP' ? 'AWAITING SAP' : r.result === 'NOT_EXTRACTED' ? 'NOT EXTRACTED' : r.result} />
          {r.differencePct != null && r.differencePct > 0 && (
            <span className={`block text-2xs ${r.result === 'MISMATCH' ? 'text-semantic-error' : 'text-ink-muted'}`}>diff {r.differencePct}%</span>
          )}
        </div>
      ),
    },
    { key: 'note', header: 'Note', render: (r) => <span className="block max-w-56 text-2xs text-ink-muted">{r.note}</span> },
  ];

  return (
    <div className="space-y-4">
      {/* mapping process explainer */}
      <Card title="Mapping process" pad={false}>
        <div className="flex flex-wrap items-stretch gap-2 p-4">
          {STEPS.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2">
              {i > 0 && <ArrowRight size={14} className="shrink-0 text-essa-500" />}
              <div className="w-40 rounded-lg border border-line bg-canvas p-2.5">
                <p className="text-xs font-semibold text-essa-700">{i + 1}. {s.label}</p>
                <p className="mt-0.5 text-2xs leading-snug text-ink-muted">{s.detail}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="border-t border-line-soft px-4 py-2 text-2xs text-ink-muted">
          Mappings come from the versioned configuration ({detail.invoice.configVersionId}) — Administration → Invoice Configuration → SAP Field Mapping &amp; Validation. Posting-side fields (BKPF/BSEG) are carried in the handoff payload and confirmed when SAP returns the document reference.
        </p>
      </Card>

      {/* summary chips */}
      <div className="flex flex-wrap gap-2">
        <Badge tone="success">{summary.matched} matched</Badge>
        {summary.mismatch > 0 && <Badge tone="error">{summary.mismatch} mismatch</Badge>}
        {summary.awaiting > 0 && <Badge tone="pending">{summary.awaiting} awaiting SAP</Badge>}
        {summary.captured > 0 && <Badge tone="info">{summary.captured} captured</Badge>}
        {summary.missing > 0 && <Badge tone="neutral">{summary.missing} not extracted</Badge>}
      </div>

      <Card title={`Field mapping evaluation (${rows.length} mappings)`} pad={false}>
        <DataTable
          dense
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          empty={<p className="py-8 text-center text-xs text-ink-muted">No active SAP field mappings are configured for this invoice category.</p>}
        />
      </Card>
    </div>
  );
}

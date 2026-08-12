import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Trash2, UploadCloud } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { Button, Card, Field, Input, PageHeader, Select, useToast, Badge } from '@/components/ui';

interface Lookups {
  categories: { id: string; code: string; name: string; poBased: boolean }[];
  documentTypes: { id: string; code: string; name: string }[];
  vendors: { code: string; name: string }[];
  departments: string[];
}

interface StagedFile {
  fileName: string;
  sizeKb: number;
  documentTypeId: string;
}

function guessDocType(fileName: string, types: Lookups['documentTypes']): string {
  const n = fileName.toLowerCase();
  const find = (code: string) => types.find((t) => t.code === code)?.id ?? '';
  if (/(invoice|inv[_-])/.test(n)) return find('INVOICE');
  if (/po|purchase/.test(n)) return find('PURCHASE_ORDER');
  if (/grn|receipt/.test(n)) return find('GRN');
  if (/ses|service.?entry/.test(n)) return find('SES');
  if (/timesheet/.test(n)) return find('TIMESHEET');
  if (/manhour/.test(n)) return find('MANHOUR_SUMMARY');
  if (/attendance/.test(n)) return find('ATTENDANCE_SHEET');
  if (/meal/.test(n)) return find('MEAL_SUMMARY');
  if (/tax|gst/.test(n)) return find('TAX_INVOICE');
  if (/challan|delivery/.test(n)) return find('DELIVERY_CHALLAN');
  if (/dept|confirmation/.test(n)) return find('DEPT_CONFIRMATION');
  return find('SUPPORTING_DOC');
}

export default function UploadInvoicePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: lookups } = useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookups>('/lookups') });
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState({ vendorCode: '', categoryId: '', amount: '', poNumber: '', department: '', description: '', invoiceDate: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      if (!lookups) return;
      const next = Array.from(list)
        .filter((f) => /\.(pdf|png|jpe?g|tiff?)$/i.test(f.name))
        .map((f) => ({
          fileName: f.name,
          sizeKb: Math.max(1, Math.round(f.size / 1024)),
          documentTypeId: guessDocType(f.name, lookups.documentTypes),
        }));
      const rejected = Array.from(list).length - next.length;
      if (rejected > 0) toast.push({ tone: 'warning', title: `${rejected} file(s) rejected`, detail: 'Only PDF and image formats are accepted per file security policy.' });
      const dupes = next.filter((n) => files.some((f) => f.fileName === n.fileName));
      if (dupes.length) toast.push({ tone: 'warning', title: 'Duplicate file skipped', detail: dupes.map((d) => d.fileName).join(', ') });
      setFiles((prev) => [...prev, ...next.filter((n) => !prev.some((p) => p.fileName === n.fileName))]);
    },
    [lookups, files, toast]
  );

  const category = lookups?.categories.find((c) => c.id === form.categoryId);

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ invoiceId: string; invoiceNumber: string; correlationId: string }>('/invoices/upload', {
        vendorCode: form.vendorCode,
        categoryId: form.categoryId,
        amount: Number(form.amount),
        poNumber: form.poNumber || undefined,
        department: form.department || undefined,
        description: form.description || undefined,
        invoiceDate: form.invoiceDate || undefined,
        files,
      }),
    onSuccess: (r) => {
      toast.push({ tone: 'success', title: `Invoice ${r.invoiceNumber} created`, detail: `Classification and extraction started · ${r.correlationId}` });
      navigate(`/invoices/${r.invoiceId}?tab=timeline`);
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Upload failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  const valid = form.vendorCode && form.categoryId && Number(form.amount) > 0 && files.length > 0 && files.every((f) => f.documentTypeId);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        breadcrumb={[{ label: 'Home', to: '/' }, { label: 'Invoices', to: '/invoices' }, { label: 'Upload Invoice' }]}
        title="Manual Portal Upload"
        description="Fallback intake channel. Uploads pass the same security checks and processing pipeline as mailbox and SharePoint ingestion. One PDF = one invoice."
      />

      <Card title="1 · Documents">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className={clsx(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
            dragOver ? 'border-essa-500 bg-essa-50' : 'border-line-strong bg-canvas'
          )}
        >
          <UploadCloud size={28} className="text-essa-600" />
          <p className="text-sm font-medium">Drag &amp; drop invoice and supporting documents</p>
          <p className="text-xs text-ink-muted">PDF, PNG, JPG, TIFF · file signature and malware checks apply · duplicates rejected</p>
          <label className="cursor-pointer">
            <span className="inline-flex h-8 items-center rounded-md border border-essa-600 px-3 text-sm font-medium text-essa-700 hover:bg-essa-50">
              <FileUp size={14} className="mr-1.5" /> Browse files
            </span>
            <input type="file" multiple className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff" onChange={(e) => e.target.files && addFiles(e.target.files)} />
          </label>
        </div>

        {files.length > 0 && (
          <ul className="mt-3 divide-y divide-line-soft rounded-md border border-line">
            {files.map((f, i) => (
              <li key={f.fileName} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <CheckCircle2 size={14} className="text-essa-600" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{f.fileName}</span>
                <span className="text-2xs text-ink-faint">{f.sizeKb} KB</span>
                <Select
                  value={f.documentTypeId}
                  onChange={(e) => setFiles((prev) => prev.map((p, pi) => (pi === i ? { ...p, documentTypeId: e.target.value } : p)))}
                  aria-label={`Document type for ${f.fileName}`}
                  className="!h-7 !text-xs"
                >
                  <option value="">Classify…</option>
                  {lookups?.documentTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
                <button aria-label={`Remove ${f.fileName}`} onClick={() => setFiles((prev) => prev.filter((_, pi) => pi !== i))} className="rounded p-1 text-ink-faint hover:bg-semantic-errorBg hover:text-semantic-error">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="2 · Invoice header">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Vendor" required>
            <Select value={form.vendorCode} onChange={set('vendorCode')} className="w-full">
              <option value="">Select vendor…</option>
              {lookups?.vendors.map((v) => (
                <option key={v.code} value={v.code}>{v.name} ({v.code})</option>
              ))}
            </Select>
          </Field>
          <Field label="Invoice category" required>
            <Select value={form.categoryId} onChange={set('categoryId')} className="w-full">
              <option value="">Select category…</option>
              {lookups?.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Gross amount (incl. GST)" required>
            <Input type="number" min={1} value={form.amount} onChange={set('amount')} placeholder="e.g. 590000" />
          </Field>
          <Field label={`PO number ${category?.poBased ? '(required for this category)' : '(optional)'}`}>
            <Input value={form.poNumber} onChange={set('poNumber')} placeholder="45000…" />
          </Field>
          <Field label="Department">
            <Select value={form.department} onChange={set('department')} className="w-full">
              <option value="">Auto / vendor default</option>
              {lookups?.departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </Field>
          <Field label="Invoice date">
            <Input type="date" value={form.invoiceDate} onChange={set('invoiceDate')} />
          </Field>
          <Field label="Description">
            <Input value={form.description} onChange={set('description')} placeholder="Short description of goods/services" />
          </Field>
        </div>
        {form.amount && (
          <p className="mt-3 text-xs text-ink-muted">
            Gross <span className="font-semibold text-ink">{fmtMoney(Number(form.amount))}</span>
            {Number(form.amount) >= 1_000_000 && <Badge tone="info" className="ml-2">Tax review will be required</Badge>}
          </p>
        )}
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => navigate('/invoices')}>Cancel</Button>
        <Button disabled={!valid} loading={submit.isPending} onClick={() => submit.mutate()}>
          <UploadCloud size={15} /> Create invoice &amp; start processing
        </Button>
      </div>
    </div>
  );
}

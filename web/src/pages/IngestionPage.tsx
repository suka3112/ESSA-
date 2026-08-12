import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderSync, Inbox, Mail } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { Badge, Button, Card, DataTable, StatusBadge, Tabs, useToast, type Column } from '@/components/ui';

interface EmailItem { id: string; sender: string; subject: string; receivedAt: string; attachments: { fileName: string; sizeKb: number }[]; status: string; invoiceId?: string; invoiceNumber?: string; error?: string }
interface SpItem { id: string; folder: string; fileName: string; modifiedAt: string; sizeKb: number; status: string; invoiceId?: string; invoiceNumber?: string }

/**
 * Ingestion channels view — embedded inside the Invoice Workbench
 * (/invoices?view=ingestion). Intake is part of invoice processing,
 * not a standalone destination.
 */
export default function IngestionChannelsView() {
  const [tab, setTab] = useState('email');
  const toast = useToast();
  const qc = useQueryClient();

  const email = useQuery({
    queryKey: ['ingestion-email'],
    queryFn: () => api.get<{ items: EmailItem[]; mailbox: string; state: string }>('/ingestion/email'),
    refetchInterval: 12_000,
  });
  const sp = useQuery({
    queryKey: ['ingestion-sp'],
    queryFn: () => api.get<{ items: SpItem[]; monitoredFolders: string[]; state: string }>('/ingestion/sharepoint'),
    refetchInterval: 12_000,
  });

  const simulate = useMutation({
    mutationFn: () => api.post<{ invoiceNumber: string }>('/ingestion/email/simulate'),
    onSuccess: (r) => {
      toast.push({ tone: 'success', title: `Invoice ${r.invoiceNumber} created from mailbox`, detail: 'Watch it progress through classification → extraction → validation.' });
      qc.invalidateQueries({ queryKey: ['ingestion-email'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });

  const emailColumns: Column<EmailItem>[] = [
    { key: 'sender', header: 'Sender', render: (e) => <span className="block max-w-52 truncate text-xs font-medium">{e.sender}</span> },
    { key: 'subject', header: 'Subject', render: (e) => <span className="block max-w-72 truncate text-xs" title={e.subject}>{e.subject}</span> },
    { key: 'received', header: 'Received', render: (e) => <span className="whitespace-nowrap text-2xs">{fmtDateTime(e.receivedAt)}</span> },
    {
      key: 'attachments', header: 'Attachments', render: (e) => (
        <span className="text-2xs text-ink-muted">{e.attachments.length ? e.attachments.map((a) => a.fileName).join(', ') : '—'}</span>
      ),
    },
    { key: 'status', header: 'Status', render: (e) => <StatusBadge value={e.status} /> },
    {
      key: 'invoice', header: 'Invoice', render: (e) =>
        e.invoiceId ? <Link to={`/invoices/${e.invoiceId}`} className="font-medium text-essa-700 hover:underline">{e.invoiceNumber}</Link> : e.error ? <span className="block max-w-52 truncate text-2xs text-semantic-error" title={e.error}>{e.error}</span> : '—',
    },
  ];

  const spColumns: Column<SpItem>[] = [
    { key: 'folder', header: 'Folder', render: (s) => <Badge tone="neutral">{s.folder}</Badge> },
    { key: 'fileName', header: 'File', render: (s) => <span className="block max-w-72 truncate text-xs font-medium">{s.fileName}</span> },
    { key: 'modified', header: 'Detected', render: (s) => <span className="whitespace-nowrap text-2xs">{fmtRelative(s.modifiedAt)}</span> },
    { key: 'size', header: 'Size', align: 'right', render: (s) => <span className="text-2xs">{s.sizeKb} KB</span> },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge value={s.status} /> },
    { key: 'invoice', header: 'Invoice', render: (s) => (s.invoiceId ? <Link to={`/invoices/${s.invoiceId}`} className="font-medium text-essa-700 hover:underline">{s.invoiceNumber}</Link> : '—') },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          Three controlled intake sources converge into one processing pipeline: the M365 AP mailbox, continuously monitored SharePoint folders and the manual portal upload fallback.
        </p>
        <Button size="sm" variant="secondary" loading={simulate.isPending} onClick={() => simulate.mutate()}>
          <Mail size={13} /> Simulate incoming vendor email
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <Card>
          <p className="flex items-center gap-1.5 text-2xs font-medium uppercase text-ink-muted"><Mail size={12} /> AP Mailbox</p>
          <p className="mt-1 text-sm font-semibold">{email.data?.mailbox}</p>
          <div className="mt-1"><StatusBadge value={email.data?.state ?? '—'} /></div>
        </Card>
        <Card>
          <p className="flex items-center gap-1.5 text-2xs font-medium uppercase text-ink-muted"><FolderSync size={12} /> SharePoint Monitor</p>
          <p className="mt-1 text-2xs text-ink-secondary">{sp.data?.monitoredFolders.join(' · ')}</p>
          <div className="mt-1"><StatusBadge value={sp.data?.state ?? '—'} /></div>
        </Card>
        <Card>
          <p className="flex items-center gap-1.5 text-2xs font-medium uppercase text-ink-muted"><Inbox size={12} /> File security policy</p>
          <p className="mt-1 text-2xs text-ink-muted">Attachment-only processing · type/signature/malware checks · one PDF = one invoice · cloud links rejected · duplicate intake protection.</p>
        </Card>
      </div>

      <Card pad={false}>
        <div className="px-3 pt-2">
          <Tabs tabs={[{ key: 'email', label: 'Email Queue' }, { key: 'sharepoint', label: 'SharePoint Monitor' }]} active={tab} onChange={setTab} />
        </div>
        {tab === 'email' ? (
          <DataTable dense columns={emailColumns} rows={email.data?.items ?? []} rowKey={(e) => e.id} loading={email.isLoading} />
        ) : (
          <DataTable dense columns={spColumns} rows={sp.data?.items ?? []} rowKey={(s) => s.id} loading={sp.isLoading} />
        )}
      </Card>
    </div>
  );
}

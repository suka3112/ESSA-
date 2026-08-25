import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Field, Textarea, useToast } from '@/components/ui';

interface ExceptionLike {
  id: string;
  code: string;
  status: string;
  technical: boolean;
  /** When false the Override action is disabled (non-overrideable exception). */
  overrideAllowed?: boolean;
}

/**
 * Exception actions (design review): a single Override action with mandatory
 * remarks. "Investigate" and person-assignment were removed (investigation is
 * user work; assignment is group-based), and the duplicate in-popup Close
 * button is gone — the top close / Esc closes the panel. Technical exceptions
 * keep Retry; upload-resolvable ones can open the Add-Document dialog.
 */
export function ExceptionActions({ exception, onChanged, onAddDocument }: { exception: ExceptionLike; onChanged: () => void; onAddDocument?: () => void }) {
  const { hasPerm } = useAuth();
  const toast = useToast();
  const [note, setNote] = useState('');

  const act = useMutation({
    mutationFn: (payload: { action: string; note?: string }) => api.post(`/exceptions/${exception.id}/action`, payload),
    onSuccess: (_d, v) => {
      toast.push({ tone: 'success', title: `Exception ${v.action === 'RESOLVE' ? 'overridden' : v.action.toLowerCase()} recorded` });
      onChanged();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Action failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (!hasPerm('EXCEPTION_MANAGE') || ['CLOSED'].includes(exception.status)) return null;
  const isOpen = !['RESOLVED', 'CLOSED'].includes(exception.status);
  if (!isOpen) return null;
  const overrideable = exception.overrideAllowed !== false;

  return (
    <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Actions</p>
      <Field label="Justification (mandatory for override, audited)">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this exception being overridden?" />
      </Field>
      <div className="flex flex-wrap gap-2">
        {overrideable ? (
          <Button size="sm" variant="warning" disabled={!note.trim()} loading={act.isPending} onClick={() => act.mutate({ action: 'RESOLVE', note })}>
            Override
          </Button>
        ) : (
          <span className="self-center text-2xs text-ink-muted">This exception cannot be overridden — correct the underlying data or upload the required document.</span>
        )}
        {exception.technical && (
          <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => act.mutate({ action: 'RETRY', note: note || undefined })}>
            Retry
          </Button>
        )}
        {onAddDocument && (
          <Button size="sm" variant="secondary" onClick={onAddDocument}>
            Upload document
          </Button>
        )}
      </div>
    </div>
  );
}

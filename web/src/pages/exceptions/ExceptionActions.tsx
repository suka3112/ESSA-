import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Field, Select, Textarea, useToast } from '@/components/ui';

interface ExceptionLike {
  id: string;
  code: string;
  status: string;
  technical: boolean;
}

/** Shared exception action bar: assign / investigate / retry / resolve / close. */
export function ExceptionActions({ exception, onChanged }: { exception: ExceptionLike; onChanged: () => void }) {
  const { hasPerm } = useAuth();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const [users, setUsers] = useState<{ id: string; name: string; title: string; enabled: boolean }[]>([]);
  useEffect(() => {
    api.get<{ users: { id: string; name: string; title: string; enabled: boolean }[] }>('/lookups').then((r) => setUsers(r.users.filter((u) => u.enabled)));
  }, []);

  const act = useMutation({
    mutationFn: (payload: { action: string; note?: string; userId?: string }) => api.post(`/exceptions/${exception.id}/action`, payload),
    onSuccess: (_d, v) => {
      toast.push({ tone: 'success', title: `Exception ${v.action.toLowerCase()} recorded` });
      onChanged();
    },
    onError: (e) => toast.push({ tone: 'error', title: 'Action failed', detail: e instanceof ApiError ? e.body.message : String(e) }),
  });

  if (!hasPerm('EXCEPTION_MANAGE') || ['CLOSED'].includes(exception.status)) return null;
  const isOpen = !['RESOLVED', 'CLOSED'].includes(exception.status);

  return (
    <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Actions</p>
      {isOpen && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Assign to">
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-48">
              <option value="">Select user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </Field>
          <Button size="sm" variant="secondary" disabled={!assignee} loading={act.isPending} onClick={() => act.mutate({ action: 'ASSIGN', userId: assignee, note })}>
            Assign
          </Button>
          <Button size="sm" variant="secondary" onClick={() => act.mutate({ action: 'INVESTIGATE', note })}>
            Investigate
          </Button>
          {exception.technical && (
            <Button size="sm" variant="warning" onClick={() => act.mutate({ action: 'RETRY', note })}>
              Retry
            </Button>
          )}
        </div>
      )}
      <Field label={isOpen ? 'Resolution / note' : 'Closing note'}>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the audit trail" />
      </Field>
      <div className="flex gap-2">
        {isOpen && (
          <Button size="sm" disabled={!note.trim()} loading={act.isPending} onClick={() => act.mutate({ action: 'RESOLVE', note })}>
            Resolve
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={isOpen && !note.trim() && exception.status !== 'RESOLVED'} onClick={() => act.mutate({ action: 'CLOSE', note: note || undefined })}>
          Close
        </Button>
      </div>
    </div>
  );
}

import type { MouseEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui';

interface ExceptionLike {
  id: string;
  code: string;
  status: string;
  technical: boolean;
  assignedTo?: string;
  assignedToName?: string;
}

const CLOSED_STATUSES = ['RESOLVED', 'CLOSED'];

/**
 * Single in-row action (design review): everything collapses into one "Open"
 * action — Override / Retry / upload live inside the exception detail.
 * "Investigate" was removed (that's user work, not a system action) and
 * assignment is group-based, so no Assign here either.
 */
export function ExceptionRowActions({
  exception,
  onOpen,
}: {
  exception: ExceptionLike;
  onOpen: () => void;
  onChanged?: () => void;
}) {
  const { hasPerm } = useAuth();
  const run = (fn: () => void) => (ev: MouseEvent) => {
    ev.stopPropagation();
    fn();
  };
  const isOpen = !CLOSED_STATUSES.includes(exception.status);
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant={isOpen ? 'secondary' : 'ghost'} onClick={run(onOpen)} title={`Open exception ${exception.code}`} aria-label={`Open exception ${exception.code}`}>
        Open <ArrowRight size={12} />
      </Button>
      {!isOpen && <span className="text-2xs text-ink-faint">No action needed</span>}
      {isOpen && !hasPerm('EXCEPTION_MANAGE') && <span className="text-2xs text-ink-faint">View only</span>}
    </div>
  );
}

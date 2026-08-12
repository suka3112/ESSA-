let counters: Record<string, number> = {};

export function initCounters(saved?: Record<string, number>) {
  if (saved) counters = { ...saved };
}

export function getCounters() {
  return { ...counters };
}

function next(key: string, start = 1): number {
  counters[key] = (counters[key] ?? start - 1) + 1;
  return counters[key];
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export const ids = {
  uuid(): string {
    return 'xxxxxxxx-4xxx'.replace(/[x]/g, () => ((Math.random() * 16) | 0).toString(16)) + '-' + Date.now().toString(36);
  },
  invoice(): string {
    return `INV-2026-${pad(next('invoice', 1000), 5)}`;
  },
  exception(): string {
    return `EXC-${pad(next('exception', 100), 5)}`;
  },
  correlation(): string {
    return `COR-${pad(next('correlation', 100000), 6)}`;
  },
  transaction(): string {
    return `TXN-${pad(next('txn', 10000), 6)}`;
  },
  request(): string {
    return `REQ-${pad(next('req', 10000), 6)}`;
  },
  job(): string {
    return `JOB-${pad(next('job', 1000), 6)}`;
  },
  audit(): string {
    return `AUD-${pad(next('audit', 10000), 7)}`;
  },
  handoff(): string {
    return `HDF-${pad(next('handoff', 100), 5)}`;
  },
  run(): string {
    return `RUN-${pad(next('run', 1000), 6)}`;
  },
  generic(prefix: string): string {
    return `${prefix}-${pad(next(prefix.toLowerCase(), 1000), 6)}`;
  },
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoAgo(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

export function isoIn(msAhead: number): string {
  return new Date(Date.now() + msAhead).toISOString();
}

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

export function fmtMoney(amount: number | undefined | null, currency = 'INR'): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function fmtNumber(n: number | undefined | null, digits = 0): string {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: digits });
}

export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtRelative(iso: string | undefined | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  const min = Math.round(abs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ${suffix}`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ${suffix}`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ${suffix}`;
  return fmtDate(iso);
}

export function fmtPct(v: number | undefined | null, digits = 1): string {
  if (v == null) return '—';
  return `${v.toFixed(digits)}%`;
}

// Display-label overrides for internal enum codes (code values stay unchanged).
const LABEL_OVERRIDES: Record<string, string> = {
  MISSING_DOCUMENTS: 'Missing Supporting Documents',
  MISSING_DOCUMENT: 'Missing Supporting Document',
};

export function titleCase(s: string | undefined | null): string {
  if (!s) return '—';
  if (LABEL_OVERRIDES[s]) return LABEL_OVERRIDES[s];
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

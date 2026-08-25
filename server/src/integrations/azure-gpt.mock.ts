/**
 * MOCK ADAPTER - Azure OpenAI GPT extraction.
 *
 * Production implementation calls the ESSA-approved Azure OpenAI GPT
 * deployment with the versioned prompt package and schema-constrained output
 * (see architecture §13). This mock returns deterministic structured output
 * derived from the invoice context so the demo behaves end-to-end.
 * Swap via integrations/index.ts without touching business modules.
 */
import type { DocumentField, FieldDataType, Invoice } from '../core/types';
import { getDb } from '../core/store';

export interface MockExtractionField {
  fieldCode: string;
  label: string;
  dataType: FieldDataType;
  value: string;
  confidence: number;
  page: number;
  evidence: string;
  mandatory: boolean;
}

export interface MockExtractionResult {
  fields: MockExtractionField[];
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h = (h ^= h >>> 16) >>> 0;
    return h / 4294967296;
  };
}

/** Derive a plausible extracted value for a configured field from invoice context. */
function deriveValue(invoice: Invoice, field: DocumentField, rnd: () => number, docTypeCode?: string): string {
  // Cross-document consistency: values that participate in N-way reconciliation
  // are derived from the same invoice truth so seeded scenarios reconcile.
  const mealCount = Math.max(50, Math.round(invoice.subtotal / 150));
  if (docTypeCode === 'MEAL_SUMMARY' && field.fieldCode === 'UNIT_RATE') {
    return (invoice.subtotal / mealCount).toFixed(2);
  }
  if (docTypeCode === 'SES' && field.fieldCode === 'QUANTITY' && invoice.categoryId === 'cat-manpower') {
    return String(Math.round(invoice.subtotal / 450));
  }
  switch (field.fieldCode) {
    case 'INVOICE_NUMBER': return invoice.invoiceNumber;
    case 'INVOICE_DATE': return invoice.invoiceDate;
    case 'VENDOR_CODE': return invoice.vendorCode;
    case 'VENDOR_NAME': return invoice.vendorName;
    // Indonesian tax id (NPWP) format — the platform runs on ESSA Indonesia.
    case 'VENDOR_TAX_NUMBER':
      return `${Math.floor(10 + rnd() * 89)}.${Math.floor(100 + rnd() * 899)}.${Math.floor(100 + rnd() * 899)}.${Math.floor(1 + rnd() * 8)}-${Math.floor(100 + rnd() * 899)}.000`;
    case 'PO_NUMBER': return invoice.poNumber ?? '';
    case 'INVOICE_AMOUNT': return String(invoice.amount);
    case 'INVOICE_SUBTOTAL': return String(invoice.subtotal);
    case 'TAX_AMOUNT': return String(invoice.taxAmount);
    case 'CURRENCY': return invoice.currency;
    // Non-PO invoices carry a cost object rather than a PO (BPD §10.4).
    case 'COST_CENTER': return 'CC-' + Math.floor(1100 + rnd() * 3900);
    case 'DESCRIPTION': return invoice.description;
    case 'GRN_NUMBER': {
      // The document carries the real GRN number - read it from reference data
      const grn = invoice.poNumber ? getDb().sapGrns.find((g) => g.poNumber === invoice.poNumber) : undefined;
      return grn?.grnNumber ?? `50${Math.floor(10000000 + rnd() * 89999999)}`;
    }
    case 'SES_NUMBER': {
      const ses = invoice.poNumber ? getDb().sapSes.find((s) => s.poNumber === invoice.poNumber) : undefined;
      return ses?.sesNumber ?? `10${Math.floor(10000000 + rnd() * 89999999)}`;
    }
    case 'TOTAL_HOURS': return String(Math.round(invoice.subtotal / 450));
    case 'OT_HOURS': return String(Math.round((invoice.subtotal / 450) * 0.08));
    case 'HEADCOUNT': return String(Math.max(4, Math.round(invoice.amount / 260000)));
    case 'MEAL_COUNT': return String(Math.max(50, Math.round(invoice.subtotal / 150)));
    case 'UNIT_RATE': return (invoice.subtotal / Math.max(1, Math.round(invoice.subtotal / 42000))).toFixed(2);
    case 'QUANTITY': return String(Math.max(1, Math.round(invoice.subtotal / 42000)));
    case 'PERIOD_FROM': return invoice.invoiceDate.slice(0, 8) + '01';
    case 'PERIOD_TO': return invoice.invoiceDate;
    case 'PROGRESS_PCT': return String(Math.min(100, 60 + Math.floor(rnd() * 40)));
    default:
      if (field.dataType === 'DATE') return invoice.invoiceDate;
      if (field.dataType === 'NUMBER' || field.dataType === 'CURRENCY') return String(Math.round(invoice.amount * (0.1 + rnd() * 0.9)));
      if (field.dataType === 'BOOLEAN') return rnd() > 0.5 ? 'true' : 'false';
      return `${field.label} value`;
  }
}

export function mockExtractDocument(
  invoice: Invoice,
  documentTypeCode: string,
  fields: DocumentField[],
  opts: { degradeFieldCodes?: string[]; qualityBias?: number } = {}
): MockExtractionResult {
  const rnd = seededRandom(invoice.id + documentTypeCode);
  const bias = opts.qualityBias ?? 0;
  const out: MockExtractionField[] = fields.map((f, idx) => {
    const degraded = opts.degradeFieldCodes?.includes(f.fieldCode) ?? false;
    let confidence = 0.9 + rnd() * 0.09 + bias;
    if (degraded) confidence = 0.42 + rnd() * 0.3;
    else if (rnd() > 0.9) confidence = 0.72 + rnd() * 0.14;
    confidence = Math.min(0.995, Math.max(0.2, confidence));
    return {
      fieldCode: f.fieldCode,
      label: f.label,
      dataType: f.dataType,
      value: deriveValue(invoice, f, rnd, documentTypeCode),
      confidence: Math.round(confidence * 1000) / 1000,
      page: 1 + Math.floor(rnd() * 2),
      evidence: `"${f.label}" region detected on page ${1 + Math.floor(rnd() * 2)} of ${documentTypeCode.toLowerCase().replace(/_/g, ' ')}`,
      mandatory: f.mandatory,
    };
  });
  return {
    fields: out,
    tokensIn: 2200 + Math.floor(rnd() * 1800),
    tokensOut: 400 + Math.floor(rnd() * 350),
    durationMs: 1400 + Math.floor(rnd() * 2400),
  };
}

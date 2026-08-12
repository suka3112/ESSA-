/**
 * SAP field-mapping evaluation for the invoice workbench.
 *
 * Applies the configured "SAP Field Mapping & Validation" rows (admin
 * configuration) to a specific invoice: for every active mapping in the
 * invoice's category, it resolves the extracted value, the SAP-side
 * reference value (vendor master / PO / GRN / SES reference data) and the
 * comparison result per match type + tolerance. Fields that only exist on
 * the SAP side after posting (e.g. BKPF/BSEG document fields) are shown as
 * carried in the handoff payload and confirmed once SAP returns a document.
 */
import type { Invoice } from '../../core/types';
import { getDb } from '../../core/store';

export type MappingResult = 'MATCHED' | 'MISMATCH' | 'CAPTURED' | 'AWAITING_SAP' | 'NOT_EXTRACTED';

export interface MappingEvaluationRow {
  id: string;
  documentTypeName: string;
  fieldCode: string;
  fieldLabel: string;
  extractedValue: string | null;
  confidence?: number;
  sapField: string;
  sapDescription: string;
  matchType: string;
  toleranceRule: string;
  mandatory: boolean;
  referenceSource: string;
  referenceValue: string | number | null;
  differencePct?: number;
  result: MappingResult;
  note: string;
}

function num(v: unknown): number | null {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null;
}

export function evaluateFieldMappings(invoice: Invoice): MappingEvaluationRow[] {
  const db = getDb();
  const mappings = db.fieldMappings.filter(
    (m) => m.status === 'ACTIVE' && m.categoryId === invoice.categoryId
  );
  const fields = db.extractedFields.filter((f) => f.invoiceId === invoice.id);
  const vendor = db.vendors.find((v) => v.code === invoice.vendorCode);
  const po = invoice.poNumber ? db.sapPurchaseOrders.find((p) => p.poNumber === invoice.poNumber) : undefined;
  const grns = invoice.poNumber ? db.sapGrns.filter((g) => g.poNumber === invoice.poNumber) : [];
  const ses = invoice.poNumber ? db.sapSes.filter((s) => s.poNumber === invoice.poNumber) : [];
  const posted = Boolean(invoice.sapDocumentNo);

  return mappings.map((m) => {
    const docType = db.documentTypes.find((d) => d.id === m.documentTypeId);
    const field = fields.find((f) => f.fieldCode === m.fieldCode && f.documentTypeId === m.documentTypeId);
    const extracted = field?.value ?? null;

    // ---- resolve the SAP-side reference for this mapping -------------------
    let referenceSource = '—';
    let referenceValue: string | number | null = null;
    let postingSide = false; // value that only exists in SAP after posting

    switch (m.fieldCode) {
      case 'VENDOR_CODE':
        referenceSource = 'Vendor master (LFA1)';
        referenceValue = vendor?.code ?? null;
        break;
      case 'VENDOR_NAME':
        referenceSource = 'Vendor master (LFA1)';
        referenceValue = vendor?.name ?? null;
        break;
      case 'PO_NUMBER':
        referenceSource = 'Purchase order (EKPO)';
        referenceValue = po?.poNumber ?? null;
        break;
      case 'CURRENCY':
        referenceSource = po ? 'Purchase order (EKKO)' : 'Company defaults';
        referenceValue = po?.currency ?? 'INR';
        break;
      case 'GRN_NUMBER':
        referenceSource = 'Goods receipt (MSEG)';
        referenceValue = grns[0]?.grnNumber ?? null;
        break;
      case 'SES_NUMBER':
        referenceSource = 'Service entry sheet (ESSR)';
        referenceValue = ses[0]?.sesNumber ?? null;
        break;
      case 'TOTAL_HOURS':
        referenceSource = 'SES accepted quantity';
        referenceValue = ses.length ? ses.reduce((s, x) => s + x.quantity, 0) : null;
        break;
      default:
        // Invoice header values (number, date, amounts) are posting-side SAP
        // fields - they are carried in the handoff payload and confirmed by
        // the returned SAP document.
        postingSide = true;
        referenceSource = 'SAP document (after posting)';
        referenceValue = posted ? extracted : null;
        break;
    }

    // ---- evaluate ----------------------------------------------------------
    let result: MappingResult;
    let note: string;
    let differencePct: number | undefined;

    if (extracted == null || extracted === '') {
      result = 'NOT_EXTRACTED';
      note = 'Field not extracted yet - extraction runs once the document is available.';
    } else if (postingSide) {
      result = posted ? 'MATCHED' : 'AWAITING_SAP';
      note = posted
        ? `Confirmed by SAP document ${invoice.sapDocumentNo}/${invoice.sapFiscalYear ?? ''}.`
        : 'Mapped into the handoff payload; confirmed when SAP returns the document reference.';
    } else if (referenceValue == null) {
      result = 'CAPTURED';
      note = 'No SAP reference available for comparison - value captured for posting.';
    } else {
      switch (m.matchType) {
        case 'AMOUNT_MATCH': {
          const a = num(extracted);
          const b = num(referenceValue);
          if (a == null || b == null) {
            result = 'CAPTURED';
            note = 'Non-numeric value - captured for posting.';
            break;
          }
          const diffPct = b === 0 ? (a === 0 ? 0 : 100) : Math.abs((a - b) / b) * 100;
          differencePct = Math.round(diffPct * 100) / 100;
          const tolMatch = /([\d.]+)\s*%/.exec(m.toleranceRule);
          const tol = tolMatch ? Number(tolMatch[1]) : 2;
          result = diffPct <= tol ? 'MATCHED' : 'MISMATCH';
          note = result === 'MATCHED'
            ? `Within tolerance (${m.toleranceRule}) - difference ${differencePct}%.`
            : `Difference ${differencePct}% exceeds ${m.toleranceRule}.`;
          break;
        }
        case 'DATE_MATCH': {
          const a = new Date(String(extracted)).getTime();
          const b = new Date(String(referenceValue)).getTime();
          if (Number.isNaN(a) || Number.isNaN(b)) {
            result = 'CAPTURED';
            note = 'Date could not be compared - captured for posting.';
            break;
          }
          const days = Math.abs(a - b) / 86400000;
          const tolMatch = /([\d.]+)\s*day/.exec(m.toleranceRule);
          const tol = tolMatch ? Number(tolMatch[1]) : 3;
          result = days <= tol ? 'MATCHED' : 'MISMATCH';
          note = result === 'MATCHED' ? `Within ${m.toleranceRule}.` : `Deviation ${days.toFixed(0)} days exceeds ${m.toleranceRule}.`;
          break;
        }
        case 'LIST_MATCH': {
          const list = m.toleranceRule.split('|').map((s) => s.trim().toUpperCase());
          result = list.includes(String(extracted).trim().toUpperCase()) ? 'MATCHED' : 'MISMATCH';
          note = result === 'MATCHED' ? `Value is in the allowed list (${m.toleranceRule}).` : `Value not in allowed list (${m.toleranceRule}).`;
          break;
        }
        default: {
          // EXACT_MATCH / CODE_MATCH / RANGE_MATCH fallback: exact comparison
          result =
            String(extracted).trim().toUpperCase() === String(referenceValue).trim().toUpperCase()
              ? 'MATCHED'
              : 'MISMATCH';
          note = result === 'MATCHED' ? 'Exact match with SAP reference.' : 'Extracted value differs from SAP reference.';
        }
      }
    }

    return {
      id: m.id,
      documentTypeName: docType?.name ?? m.documentTypeId,
      fieldCode: m.fieldCode,
      fieldLabel: m.fieldLabel,
      extractedValue: extracted,
      confidence: field?.confidence,
      sapField: m.sapField,
      sapDescription: m.sapDescription,
      matchType: m.matchType,
      toleranceRule: m.toleranceRule,
      mandatory: m.mandatory,
      referenceSource,
      referenceValue,
      differencePct,
      result,
      note,
    };
  });
}

/**
 * Hybrid rule engine: generic configuration-driven evaluators plus an
 * injected custom plugin registry (no executable code is ever stored in
 * configuration - only approved handler keys and safe parameters).
 *
 * A rule is a header plus N operands (supports A=B=C=D, SUM(A)=B, A<=B,
 * percent-difference and formula/custom evaluation).
 */
import type {
  ExtractedField,
  Invoice,
  OperandValue,
  RuleOperand,
  RuleResultOutcome,
  ValidationRule,
} from '../../core/types';
import { getDb } from '../../core/store';
import { customRulePlugins } from './plugins';

export interface ValidationContext {
  invoice: Invoice;
  fields: ExtractedField[];
  availableDocTypeCodes: Set<string>;
}

export interface RuleEvaluation {
  rule: ValidationRule;
  result: RuleResultOutcome;
  expected: string;
  actual: string;
  tolerance: string;
  differencePct?: number;
  operandValues: OperandValue[];
  message: string;
}

// ---------- operand resolution ----------
function fieldValue(ctx: ValidationContext, docTypeCode: string | undefined, fieldCode: string | undefined): { value: string | number | null; detail?: string } {
  const db = getDb();
  const docType = db.documentTypes.find((d) => d.code === docTypeCode);
  const candidates = ctx.fields.filter(
    (f) => f.fieldCode === fieldCode && (!docType || f.documentTypeId === docType.id)
  );
  if (!candidates.length) return { value: null, detail: 'Field not extracted' };
  const f = candidates[0];
  const raw = f.value;
  if (f.dataType === 'NUMBER' || f.dataType === 'CURRENCY' || f.dataType === 'PERCENTAGE') {
    const n = Number(String(raw).replace(/[,\s]/g, ''));
    return { value: Number.isFinite(n) ? n : null, detail: `From ${docTypeCode ?? 'document'} p.${f.page}` };
  }
  return { value: raw, detail: `From ${docTypeCode ?? 'document'} p.${f.page}` };
}

function sapValue(ctx: ValidationContext, op: RuleOperand): { value: string | number | null; detail?: string } {
  const db = getDb();
  const inv = ctx.invoice;
  const po = inv.poNumber ? db.sapPurchaseOrders.find((p) => p.poNumber === inv.poNumber) : undefined;
  switch (op.sapEntity) {
    case 'PO': {
      if (!po) return { value: null, detail: 'PO not found in SAP reference data' };
      switch (op.sapField) {
        case 'TOTAL_AMOUNT': return { value: po.totalAmount, detail: `PO ${po.poNumber}` };
        case 'OPEN_AMOUNT': return { value: po.openAmount, detail: `PO ${po.poNumber}` };
        case 'VENDOR_CODE': return { value: po.vendorCode, detail: `PO ${po.poNumber}` };
        case 'PO_NUMBER': return { value: po.poNumber, detail: `PO ${po.poNumber}` };
        case 'CURRENCY': return { value: po.currency, detail: `PO ${po.poNumber}` };
        case 'VALID_TO': return { value: po.validTo, detail: `PO ${po.poNumber}` };
        case 'STATUS': return { value: po.status, detail: `PO ${po.poNumber}` };
        default: return { value: null, detail: `Unknown PO field ${op.sapField}` };
      }
    }
    case 'GRN': {
      const grns = db.sapGrns.filter((g) => g.poNumber === inv.poNumber);
      if (!grns.length) return { value: null, detail: 'No GRN found for PO' };
      if (op.aggregation === 'SUM' || !op.sapField || op.sapField === 'AMOUNT') {
        return { value: grns.reduce((s, g) => s + g.amount, 0), detail: `${grns.length} GRN(s)` };
      }
      if (op.sapField === 'QUANTITY') {
        return { value: grns.reduce((s, g) => s + g.totalQuantity, 0), detail: `${grns.length} GRN(s)` };
      }
      return { value: grns[0].grnNumber, detail: `GRN ${grns[0].grnNumber}` };
    }
    case 'SES': {
      const ses = db.sapSes.filter((s) => s.poNumber === inv.poNumber);
      if (!ses.length) return { value: null, detail: 'No SES found for PO' };
      if (op.sapField === 'QUANTITY') return { value: ses.reduce((sum, s) => sum + s.quantity, 0), detail: `${ses.length} SES` };
      return { value: ses.reduce((sum, s) => sum + s.acceptedAmount, 0), detail: `${ses.length} SES` };
    }
    case 'VENDOR': {
      const v = db.vendors.find((x) => x.code === inv.vendorCode);
      if (!v) return { value: null, detail: 'Vendor not in SAP snapshot' };
      switch (op.sapField) {
        case 'CODE': return { value: v.code, detail: v.name };
        case 'NAME': return { value: v.name, detail: v.code };
        case 'GSTIN': return { value: v.gstin, detail: v.code };
        case 'STATUS': return { value: v.sapStatus, detail: v.code };
        default: return { value: null };
      }
    }
    case 'PERIOD': {
      return { value: 'OPEN', detail: 'Accounting period status' };
    }
    default:
      return { value: null, detail: 'Unsupported SAP entity' };
  }
}

function biometricValue(ctx: ValidationContext, op: RuleOperand): { value: string | number | null; detail?: string } {
  const db = getDb();
  const inv = ctx.invoice;
  const month = inv.invoiceDate.slice(0, 7);
  const records = db.attendanceRecords.filter(
    (r) => r.vendorCode === inv.vendorCode && r.date.startsWith(month) && r.status === 'ACCEPTED'
  );
  if (!records.length) return { value: null, detail: 'No attendance data pushed for period' };
  switch (op.aggregation) {
    case 'COUNT':
      return { value: records.filter((r) => r.present).length, detail: `${records.length} attendance records (${month})` };
    case 'SUM':
    default: {
      if (op.fieldCode === 'OT_HOURS') return { value: records.reduce((s, r) => s + r.otHours, 0), detail: `${records.length} records` };
      if (op.fieldCode === 'MEAL_COUNT') return { value: records.filter((r) => r.mealEligible && r.present).length, detail: `${records.length} records` };
      return { value: records.reduce((s, r) => s + r.hours, 0), detail: `${records.length} attendance records (${month})` };
    }
  }
}

export function resolveOperand(ctx: ValidationContext, op: RuleOperand): OperandValue {
  let resolved: { value: string | number | null; detail?: string };
  switch (op.sourceType) {
    case 'DOCUMENT_FIELD':
      resolved = fieldValue(ctx, op.documentTypeCode, op.fieldCode);
      break;
    case 'SAP':
      resolved = sapValue(ctx, op);
      break;
    case 'BIOMETRIC':
      resolved = biometricValue(ctx, op);
      break;
    case 'CONFIG':
    case 'MASTER':
      resolved = { value: op.constantValue ?? null, detail: 'Configured value' };
      break;
    case 'CALCULATED':
      resolved = { value: op.constantValue ?? null, detail: 'Calculated value' };
      break;
    default:
      resolved = { value: null };
  }
  return {
    alias: op.alias,
    label: op.label,
    source: op.sourceType === 'DOCUMENT_FIELD'
      ? `${op.documentTypeCode ?? 'DOC'}.${op.fieldCode}`
      : op.sourceType === 'SAP'
        ? `SAP.${op.sapEntity}.${op.sapField ?? op.aggregation ?? ''}`
        : op.sourceType,
    value: resolved.value,
    detail: resolved.detail,
  };
}

// ---------- evaluators ----------
function toNum(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function outcomeFor(rule: ValidationRule, pass: boolean): RuleResultOutcome {
  if (pass) return 'PASS';
  switch (rule.severity) {
    case 'INFO': return 'PASS';
    case 'WARNING': return 'WARNING';
    case 'ERROR': return 'FAIL';
    case 'HARD_FAIL': return 'HARD_FAIL';
  }
}

function fmt(v: string | number | null): string {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return String(v);
}

export function evaluateRule(ctx: ValidationContext, rule: ValidationRule, operands: RuleOperand[]): RuleEvaluation {
  const ops = operands.sort((a, b) => a.sequence - b.sequence).map((o) => resolveOperand(ctx, o));
  const toleranceLabel =
    rule.toleranceType === 'PERCENT' ? `≤ ${rule.toleranceValue}%`
      : rule.toleranceType === 'ABSOLUTE' ? `± ${rule.toleranceValue}`
        : rule.toleranceType === 'DAYS' ? `± ${rule.toleranceValue} days`
          : 'Exact';

  const base: Omit<RuleEvaluation, 'result' | 'message' | 'expected' | 'actual'> = {
    rule, tolerance: toleranceLabel, operandValues: ops,
  };

  // Missing operand values -> PENDING unless rule is a PRESENCE check
  const missing = ops.filter((o) => o.value == null);

  switch (rule.ruleType) {
    case 'PRESENCE': {
      const target = ops[0];
      const present = target?.value != null && String(target.value).trim() !== '';
      return {
        ...base,
        result: outcomeFor(rule, present),
        expected: 'Value present',
        actual: present ? fmt(target.value) : 'Missing',
        message: present ? `${target.label} is present` : `${target?.label ?? 'Value'} is missing`,
      };
    }
    case 'EXACT_MATCH': {
      if (missing.length) {
        return { ...base, result: 'PENDING', expected: 'All values available', actual: `${missing.map((m) => m.label).join(', ')} unavailable`, message: 'Reference data not available - pending SAP validation' };
      }
      const [a, ...rest] = ops;
      const pass = rest.every((o) => String(o.value).trim().toUpperCase() === String(a.value).trim().toUpperCase());
      return {
        ...base,
        result: outcomeFor(rule, pass),
        expected: fmt(a.value),
        actual: rest.map((o) => fmt(o.value)).join(' / '),
        message: pass ? `${rule.ruleName}: values match` : `${rule.ruleName}: values differ`,
      };
    }
    case 'AMOUNT_TOLERANCE':
    case 'N_WAY':
    case 'AGGREGATION': {
      if (missing.length) {
        return { ...base, result: 'PENDING', expected: 'All operand values available', actual: `${missing.map((m) => m.label).join(', ')} unavailable`, message: `Cannot reconcile - ${missing.map((m) => m.label).join(', ')} unavailable` };
      }
      const nums = ops.map((o) => toNum(o.value));
      if (nums.some((n) => n == null)) {
        return { ...base, result: 'PENDING', expected: 'Numeric values', actual: 'Non-numeric operand', message: 'Operand values are not numeric' };
      }
      const values = nums as number[];
      if (rule.comparator === 'LEFT_LTE_RIGHT') {
        const pass = values[0] <= values[1] * (1 + (rule.toleranceType === 'PERCENT' ? (rule.toleranceValue ?? 0) / 100 : 0)) + (rule.toleranceType === 'ABSOLUTE' ? rule.toleranceValue ?? 0 : 0);
        return {
          ...base,
          result: outcomeFor(rule, pass),
          expected: `${ops[0].label} ≤ ${ops[1].label} (${fmt(values[1])})`,
          actual: fmt(values[0]),
          message: pass ? `${ops[0].label} within ${ops[1].label}` : `${ops[0].label} (${fmt(values[0])}) exceeds ${ops[1].label} (${fmt(values[1])})`,
        };
      }
      // ALL_EQUAL / DIFF_WITHIN_TOLERANCE
      const ref = values[0];
      let maxDiffPct = 0;
      let pass = true;
      for (const v of values.slice(1)) {
        const diffPct = ref === 0 ? (v === 0 ? 0 : 100) : Math.abs((v - ref) / ref) * 100;
        maxDiffPct = Math.max(maxDiffPct, diffPct);
        if (rule.toleranceType === 'PERCENT') {
          if (diffPct > (rule.toleranceValue ?? 0)) pass = false;
        } else if (rule.toleranceType === 'ABSOLUTE') {
          if (Math.abs(v - ref) > (rule.toleranceValue ?? 0)) pass = false;
        } else if (v !== ref) pass = false;
      }
      return {
        ...base,
        result: outcomeFor(rule, pass),
        expected: fmt(ref),
        actual: values.slice(1).map((v) => fmt(v)).join(' / '),
        differencePct: Math.round(maxDiffPct * 100) / 100,
        message: pass
          ? `${rule.ruleName}: reconciled (max diff ${maxDiffPct.toFixed(2)}%)`
          : `${rule.ruleName}: difference ${maxDiffPct.toFixed(2)}% exceeds tolerance ${toleranceLabel}`,
      };
    }
    case 'DATE_TOLERANCE': {
      if (missing.length) {
        return { ...base, result: 'PENDING', expected: 'Dates available', actual: 'Missing date value', message: 'Date value unavailable' };
      }
      const dates = ops.map((o) => new Date(String(o.value)).getTime());
      if (dates.some((d) => Number.isNaN(d))) {
        return { ...base, result: 'PENDING', expected: 'Valid dates', actual: 'Unparseable date', message: 'Date value could not be parsed' };
      }
      const diffDays = Math.abs(dates[0] - dates[1]) / 86400000;
      const pass = diffDays <= (rule.toleranceValue ?? 0);
      return {
        ...base,
        result: outcomeFor(rule, pass),
        expected: `Within ${rule.toleranceValue} days of ${fmt(ops[1].value)}`,
        actual: `${fmt(ops[0].value)} (${diffDays.toFixed(0)} days)`,
        message: pass ? 'Date within allowed deviation' : `Date differs by ${diffDays.toFixed(0)} days (allowed ${rule.toleranceValue})`,
      };
    }
    case 'RANGE': {
      const v = toNum(ops[0]?.value ?? null);
      if (v == null) return { ...base, result: 'PENDING', expected: 'Numeric value', actual: '—', message: 'Value unavailable' };
      const min = toNum(ops[1]?.value ?? null) ?? Number.NEGATIVE_INFINITY;
      const max = toNum(ops[2]?.value ?? null) ?? Number.POSITIVE_INFINITY;
      const pass = v >= min && v <= max;
      return {
        ...base,
        result: outcomeFor(rule, pass),
        expected: `${fmt(min)} – ${fmt(max)}`,
        actual: fmt(v),
        message: pass ? 'Value within range' : `Value ${fmt(v)} outside range ${fmt(min)}–${fmt(max)}`,
      };
    }
    case 'LIST_MEMBERSHIP': {
      const v = ops[0]?.value;
      const list = String(ops[1]?.value ?? '').split('|').map((s) => s.trim().toUpperCase());
      if (v == null) return { ...base, result: 'PENDING', expected: list.join(', '), actual: '—', message: 'Value unavailable' };
      const pass = list.includes(String(v).trim().toUpperCase());
      return {
        ...base,
        result: outcomeFor(rule, pass),
        expected: `One of: ${list.join(', ')}`,
        actual: fmt(v),
        message: pass ? 'Value is in the allowed list' : `Value ${fmt(v)} is not in the allowed list`,
      };
    }
    case 'CONDITIONAL': {
      // condition operand (0) -> when truthy, operand 1 must be present/truthy
      const cond = ops[0];
      const target = ops[1];
      const condTrue = cond?.value != null && String(cond.value).toUpperCase() !== 'FALSE' && String(cond.value) !== '0' && String(cond.value).trim() !== '';
      if (!condTrue) {
        return { ...base, result: 'SKIPPED', expected: 'Condition not met', actual: fmt(cond?.value ?? null), message: `Condition not met - rule not applicable` };
      }
      const pass = target?.value != null && String(target.value).trim() !== '';
      return {
        ...base,
        result: outcomeFor(rule, pass),
        expected: `${target?.label ?? 'Value'} required when ${cond.label}`,
        actual: pass ? fmt(target.value) : 'Missing',
        message: pass ? 'Conditional requirement satisfied' : `${target?.label ?? 'Value'} required because ${cond.label}`,
      };
    }
    case 'FORMULA':
    case 'CUSTOM': {
      const plugin = rule.handlerKey ? customRulePlugins[rule.handlerKey] : undefined;
      if (!plugin) {
        return { ...base, result: 'PENDING', expected: 'Registered plugin', actual: rule.handlerKey ?? 'none', message: `Custom handler ${rule.handlerKey ?? ''} not registered` };
      }
      const r = plugin(ctx, ops, rule.handlerParams ?? {});
      return { ...base, ...r, result: r.pass ? 'PASS' : outcomeFor(rule, false) };
    }
    default:
      return { ...base, result: 'PENDING', expected: '—', actual: '—', message: `Unsupported rule type ${rule.ruleType}` };
  }
}

/** Select applicable active rules for an invoice and evaluate them in priority order. */
export function evaluateInvoice(ctx: ValidationContext): RuleEvaluation[] {
  const db = getDb();
  const rules = db.validationRules
    .filter((r) => r.status === 'ACTIVE')
    .filter((r) => r.configVersionId === ctx.invoice.configVersionId)
    .filter((r) => !r.categoryId || r.categoryId === ctx.invoice.categoryId)
    .sort((a, b) => a.priority - b.priority);
  return rules.map((rule) => {
    const operands = db.ruleOperands.filter((o) => o.ruleId === rule.id);
    return evaluateRule(ctx, rule, operands);
  });
}

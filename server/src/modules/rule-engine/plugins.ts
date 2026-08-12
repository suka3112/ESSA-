/**
 * Custom TypeScript rule plugin registry.
 *
 * The database never stores executable code - validation rules may reference
 * an approved handler key with safe JSON parameters. New algorithms are
 * introduced by deploying a plugin here, after which admins can reuse it
 * through configuration.
 */
import type { OperandValue } from '../../core/types';
import type { ValidationContext } from './engine';
import { getDb } from '../../core/store';

export interface PluginResult {
  pass: boolean;
  expected: string;
  actual: string;
  message: string;
  differencePct?: number;
}

export type CustomRulePlugin = (
  ctx: ValidationContext,
  operands: OperandValue[],
  params: Record<string, unknown>
) => PluginResult;

function num(v: string | number | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

export const customRulePlugins: Record<string, CustomRulePlugin> = {
  /** Invoice amount must equal subtotal + tax within tolerance. */
  TOTALS_ARITHMETIC: (_ctx, ops, params) => {
    const total = num(ops.find((o) => o.alias === 'TOTAL')?.value);
    const subtotal = num(ops.find((o) => o.alias === 'SUBTOTAL')?.value);
    const tax = num(ops.find((o) => o.alias === 'TAX')?.value);
    const tolPct = num(params.tolerancePct as number) || 0.5;
    if ([total, subtotal, tax].some(Number.isNaN)) {
      return { pass: false, expected: 'Subtotal + Tax', actual: 'Unavailable', message: 'Amount fields unavailable for arithmetic check' };
    }
    const derived = subtotal + tax;
    const diffPct = derived === 0 ? 0 : Math.abs((total - derived) / derived) * 100;
    const pass = diffPct <= tolPct;
    return {
      pass,
      expected: derived.toLocaleString('en-IN', { maximumFractionDigits: 2 }),
      actual: total.toLocaleString('en-IN', { maximumFractionDigits: 2 }),
      differencePct: Math.round(diffPct * 100) / 100,
      message: pass ? 'Invoice totals arithmetic reconciles' : `Invoice amount differs from subtotal + tax by ${diffPct.toFixed(2)}%`,
    };
  },

  /** Vendor must not carry the portal negative flag and must be AP-enabled. */
  VENDOR_NOT_NEGATIVE: (ctx) => {
    const db = getDb();
    const control = db.vendorControls.find((c) => c.vendorCode === ctx.invoice.vendorCode);
    const negative = control?.negativeFlag ?? false;
    const disabled = control ? !control.apEnabled : false;
    const pass = !negative && !disabled;
    return {
      pass,
      expected: 'Vendor enabled, no negative flag',
      actual: negative ? 'Negative-flagged' : disabled ? 'AP automation disabled' : 'Enabled',
      message: pass
        ? 'Vendor is enabled for AP automation'
        : negative
          ? `Vendor ${ctx.invoice.vendorCode} carries a negative flag${control?.reason ? ` (${control.reason})` : ''}`
          : `Vendor ${ctx.invoice.vendorCode} is disabled for AP automation`,
    };
  },

  /** Meal arithmetic: billed meals × rate = subtotal within tolerance. */
  MEAL_ARITHMETIC: (_ctx, ops, params) => {
    const meals = num(ops.find((o) => o.alias === 'MEALS')?.value);
    const rate = num(ops.find((o) => o.alias === 'RATE')?.value);
    const subtotal = num(ops.find((o) => o.alias === 'SUBTOTAL')?.value);
    const tolPct = num(params.tolerancePct as number) || 1;
    if ([meals, rate, subtotal].some(Number.isNaN)) {
      return { pass: false, expected: 'Meals × Rate', actual: 'Unavailable', message: 'Meal arithmetic operands unavailable' };
    }
    const derived = meals * rate;
    const diffPct = derived === 0 ? 0 : Math.abs((subtotal - derived) / derived) * 100;
    const pass = diffPct <= tolPct;
    return {
      pass,
      expected: derived.toLocaleString('en-IN', { maximumFractionDigits: 2 }),
      actual: subtotal.toLocaleString('en-IN', { maximumFractionDigits: 2 }),
      differencePct: Math.round(diffPct * 100) / 100,
      message: pass ? 'Meal count × rate reconciles with subtotal' : `Subtotal differs from meals × rate by ${diffPct.toFixed(2)}%`,
    };
  },

  /**
   * Natural-gas / benchmark contract rate: invoice unit rate must be within
   * tolerance of (benchmark * factor + adder) from configured contract formula.
   */
  NATURAL_GAS_CONTRACT_RATE: (_ctx, ops, params) => {
    const invoiceRate = num(ops.find((o) => o.alias === 'INVOICE_RATE')?.value);
    const benchmark = num(ops.find((o) => o.alias === 'BENCHMARK')?.value);
    const factor = num(params.factor as number) || 1;
    const adder = num(params.adder as number) || 0;
    const tolPct = num(params.tolerancePct as number) || 0;
    if (Number.isNaN(invoiceRate) || Number.isNaN(benchmark)) {
      return { pass: false, expected: 'Benchmark + invoice rate', actual: 'Unavailable', message: 'Benchmark or invoice rate unavailable' };
    }
    const derived = benchmark * factor + adder;
    const diffPct = derived === 0 ? 0 : Math.abs((invoiceRate - derived) / derived) * 100;
    const pass = diffPct <= tolPct;
    return {
      pass,
      expected: `${derived.toFixed(2)} (benchmark ${benchmark} × ${factor} + ${adder})`,
      actual: invoiceRate.toFixed(2),
      differencePct: Math.round(diffPct * 100) / 100,
      message: pass
        ? `Contract rate within ${tolPct}% of derived benchmark rate`
        : `Invoice rate deviates ${diffPct.toFixed(2)}% from contract formula rate (allowed ${tolPct}%)`,
    };
  },

  /**
   * Catering meal eligibility: billed meal count must not exceed
   * biometric-eligible headcount plus approved guest allowance.
   */
  CATERING_MEAL_ELIGIBILITY: (_ctx, ops, params) => {
    const billed = num(ops.find((o) => o.alias === 'BILLED_MEALS')?.value);
    const eligible = num(ops.find((o) => o.alias === 'ELIGIBLE_MEALS')?.value);
    const guestAllowancePct = num(params.guestAllowancePct as number) || 0;
    if (Number.isNaN(billed) || Number.isNaN(eligible)) {
      return { pass: false, expected: 'Meal counts', actual: 'Unavailable', message: 'Meal count operands unavailable' };
    }
    const cap = Math.round(eligible * (1 + guestAllowancePct / 100));
    const pass = billed <= cap;
    return {
      pass,
      expected: `≤ ${cap} (eligible ${eligible} + ${guestAllowancePct}% guests)`,
      actual: String(billed),
      message: pass
        ? 'Billed meals within biometric-eligible headcount'
        : `Billed meals (${billed}) exceed eligible cap (${cap})`,
    };
  },

  /**
   * Manpower overtime cap: OT hours cannot exceed configured % of regular hours.
   */
  MANPOWER_OT_CAP: (_ctx, ops, params) => {
    const regular = num(ops.find((o) => o.alias === 'REGULAR_HOURS')?.value);
    const ot = num(ops.find((o) => o.alias === 'OT_HOURS')?.value);
    const capPct = num(params.capPct as number) || 20;
    if (Number.isNaN(regular) || Number.isNaN(ot)) {
      return { pass: false, expected: 'Hour values', actual: 'Unavailable', message: 'Hours unavailable' };
    }
    const cap = (regular * capPct) / 100;
    const pass = ot <= cap;
    return {
      pass,
      expected: `OT ≤ ${cap.toFixed(1)} h (${capPct}% of regular)`,
      actual: `${ot.toFixed(1)} h`,
      message: pass ? 'Overtime within configured cap' : `Overtime ${ot.toFixed(1)}h exceeds ${capPct}% cap (${cap.toFixed(1)}h)`,
    };
  },
};

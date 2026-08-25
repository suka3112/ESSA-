/**
 * Invoice scenario seeder — built from the PT Panca Amara Utama sample bundles.
 *
 * Every invoice is either one of the five sample bundles in "Sample data"
 * (values exactly as printed on the documents) or a follow-on claim of the
 * same contract derived from the same contract rates, so each figure on every
 * screen reconciles: invoice ↔ PO ↔ SES / GRN ↔ timesheets / meal sheets ↔
 * biometric attendance ↔ SAP document ↔ payment.
 *
 * The scenarios drive the REAL pipeline (completeness, extraction, rule engine,
 * workflow), so statuses, exceptions and SLA clocks are computed, never typed
 * in. The "facts" on each scenario are what the mock extractor reads for the
 * fields the configuration asks for.
 *
 * Demo "today" is late August 2026; the sample invoices (Jan – May 2026) are
 * the paid history and the derived claims (Jun – Aug 2026) are the live work.
 */
import type { Database } from '../../core/store';
import { getDb, markDirty } from '../../core/store';
import { DAY, HOUR, ids } from '../../core/ids';
import type { AttendanceRecord, Invoice, InvoiceLifecycle } from '../../core/types';
import { SharePointMock } from '../../integrations/sharepoint.mock';
import {
  runCompleteness,
  runExtraction,
  runValidation,
  startWorkflow,
  actOnStep,
} from '../../modules/pipeline/pipeline';
import { addTimeline } from '../../modules/pipeline/helpers';
import { audit, systemAudit } from '../../core/audit';
import { COMPANY, SAP_SES } from './sap';

// ------------------------------------------------------------------ helpers
const at = (date: string, hhmm = '09:00') => new Date(`${date}T${hhmm}:00+07:00`).toISOString(); // WIB
const plusDays = (iso: string, days: number, hhmm?: string) => {
  const d = new Date(new Date(iso).getTime() + days * DAY);
  return hhmm ? at(d.toISOString().slice(0, 10), hhmm) : d.toISOString();
};
const NOW = Date.now();
/** Never place a seeded event in the future. */
const clamp = (iso: string) => (new Date(iso).getTime() > NOW - HOUR ? new Date(NOW - HOUR).toISOString() : iso);

// ----------------------------------------------------------- scenario model
interface Doc { fileName: string; documentTypeId: string; pages: number; sizeKb?: number }
interface Line { description: string; quantity: number; uom: string; unitPrice: number; amount: number; poItem?: string }

export interface Scenario {
  key: string;
  categoryId: string;
  vendorCode: string;
  invoiceNumber: string;
  invoiceDate: string;
  /** When PAU received the bundle (the "DITERIMA" stamp / mailbox time). */
  receivedAt: string;
  source: Invoice['source'];
  currency?: 'IDR' | 'USD';
  subtotal: number;
  taxAmount: number;
  /** Total as printed on the invoice; defaults to subtotal + tax. */
  total?: number;
  description: string;
  poNumber?: string;
  servicePeriod?: [string, string];
  docs: Doc[];
  lines: Line[];
  /** Ground truth for the extractor, keyed DOCTYPE.FIELD or FIELD. */
  facts: Record<string, string>;
  /** Biometric reference data for the service period (ESSA-MIS push). */
  attendance?: { kind: 'HOURS'; regular: number; ot: number; headcount: number } | { kind: 'MEALS'; eligibleMeals: number; headcount: number };
  target:
    | 'RECEIVED' | 'MISSING_DOCS' | 'EXTRACTION_REVIEW' | 'VALIDATION_FAILED'
    | 'APPROVAL_STEP_1' | 'APPROVAL_STEP_2' | 'TAX_REVIEW' | 'REJECTED'
    | 'VALIDATED_QUEUED' | 'IN_PROGRESS' | 'PARKED' | 'POSTED' | 'PAID';
  degradeFields?: string[];
  priority?: Invoice['priority'];
  assignTo?: string;
  /** SAP document number printed on the real bundle (otherwise allocated in series). */
  sapDocumentNo?: string;
  /** How the AP team has handled the exception so far (status, note and the date it was worked). */
  exception?: { status: 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING'; note: string; on: string };
  /** Milestones (yyyy-mm-dd) — approvals, SAP acknowledgement, parking, posting, payment. */
  dates?: { approved?: string; acknowledged?: string; parked?: string; posted?: string; paid?: string; rejected?: string };
  rejectReason?: string;
  taxReviewRequired?: boolean;
}

// -------------------------------------------------------- contract helpers
const ALE = {
  welderRate: 60_000, fitterRate: 40_000, stationery: 1_130_000, overheadWelder: 4_456_500, overheadFitter: 2_883_000,
  /** One monthly claim of the ALE piping-fabrication contract (lines exactly as on the invoice). */
  claim(p: { welder: number; fitter: number; otWelder: number; otFitter: number }) {
    const lines: Line[] = [
      { description: 'Direct Cost Welder', quantity: p.welder, uom: 'MH', unitPrice: this.welderRate, amount: p.welder * this.welderRate, poItem: '00050' },
      { description: 'Stationery, Postage, Transportation', quantity: 1, uom: 'MON', unitPrice: this.stationery, amount: this.stationery, poItem: '00060' },
      { description: 'Overhead and Profit (welder)', quantity: 1, uom: 'MON', unitPrice: this.overheadWelder, amount: this.overheadWelder, poItem: '00090' },
      { description: 'Direct Cost Fitter', quantity: p.fitter, uom: 'MH', unitPrice: this.fitterRate, amount: p.fitter * this.fitterRate, poItem: '00110' },
      { description: 'Overhead and Profit (fitter)', quantity: 1, uom: 'MON', unitPrice: this.overheadFitter, amount: this.overheadFitter, poItem: '00140' },
      { description: 'Overtime Welder', quantity: p.otWelder, uom: 'MH', unitPrice: this.welderRate, amount: p.otWelder * this.welderRate, poItem: '00030' },
      { description: 'Overtime Fitter', quantity: p.otFitter, uom: 'MH', unitPrice: this.fitterRate, amount: p.otFitter * this.fitterRate, poItem: '00040' },
    ];
    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    return { lines, subtotal, regular: p.welder + p.fitter, ot: p.otWelder + p.otFitter };
  },
};

const CATERING = { breakfast: 45_128, lunch: 70_219, dinner: 70_219 };
/** Meal PAU monthly claim (proforma invoice lines as on the Baasithu bundle). */
function mealClaim(p: { breakfastSupper: number; lunch: number; dinner: number }) {
  const lines: Line[] = [
    { description: "B'fast & Supper", quantity: p.breakfastSupper, uom: 'PACK', unitPrice: CATERING.breakfast, amount: p.breakfastSupper * CATERING.breakfast, poItem: '00010' },
    { description: 'Lunch', quantity: p.lunch, uom: 'PACK', unitPrice: CATERING.lunch, amount: p.lunch * CATERING.lunch, poItem: '00020' },
    { description: 'Dinner', quantity: p.dinner, uom: 'PACK', unitPrice: CATERING.dinner, amount: p.dinner * CATERING.dinner, poItem: '00030' },
  ];
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const meals = p.breakfastSupper + p.lunch + p.dinner;
  return { lines, subtotal, meals, blendedRate: subtotal / meals };
}

/** Berca progress claim: work value less 15% advance recovery and 10% retention, VAT 11% on the net. */
function progressClaim(workValue: number, pct: number, cumulativePct: number) {
  const advance = Math.round(workValue * 0.15);
  const retention = Math.round(workValue * 0.10);
  const net = workValue - advance - retention;
  const vat = Math.round(net * 0.11);
  return { workValue, advance, retention, net, vat, total: net + vat, pct, cumulativePct };
}

const ppn = (subtotal: number) => Math.round(subtotal * 0.11);
const localTax = (subtotal: number) => Math.round(subtotal * 0.10);

// --------------------------------------------------------------- documents
const aleDocs = (claimNo: string, period: string, po: 'PO_ALE.pdf' | 'PO_ALE_Year2.pdf', sesNo: string, opts: { omit?: string[] } = {}): Doc[] => [
  { fileName: `Kwitansi ${claimNo}.pdf`, documentTypeId: 'dt-support', pages: 1, sizeKb: 210 },
  { fileName: `Invoice ${claimNo}.pdf`, documentTypeId: 'dt-invoice', pages: 2, sizeKb: 486 },
  { fileName: `Faktur Pajak ${claimNo}.pdf`, documentTypeId: 'dt-tax', pages: 1, sizeKb: 240 },
  { fileName: `Summary Calculation Manhour and Claim ${period}.pdf`, documentTypeId: 'dt-manhour', pages: 3, sizeKb: 920 },
  { fileName: `Time Sheet Welder & Fitter ${period}.pdf`, documentTypeId: 'dt-timesheet', pages: 8, sizeKb: 3_140 },
  { fileName: `Daily Time Sheets signed by PAU ${period}.pdf`, documentTypeId: 'dt-attendance', pages: 21, sizeKb: 6_830 },
  { fileName: po, documentTypeId: 'dt-po', pages: 11, sizeKb: 278 },
  { fileName: `SES ${sesNo} Amanah Lestari.pdf`, documentTypeId: 'dt-ses', pages: 1, sizeKb: 70 },
].filter((d) => !(opts.omit ?? []).includes(d.documentTypeId));

const bercaDocs = (n: string, month: string, opts: { omit?: string[] } = {}): Doc[] => [
  { fileName: `Transmittal Note ${n}.pdf`, documentTypeId: 'dt-support', pages: 1, sizeKb: 180 },
  { fileName: `Invoice ${n} Progress ${month}.pdf`, documentTypeId: 'dt-invoice', pages: 2, sizeKb: 640 },
  { fileName: `Receipt ${n}.pdf`, documentTypeId: 'dt-support', pages: 1, sizeKb: 260 },
  { fileName: `Faktur Pajak ${n}.pdf`, documentTypeId: 'dt-tax', pages: 1, sizeKb: 250 },
  { fileName: `Payment Details ${n}.pdf`, documentTypeId: 'dt-support', pages: 1, sizeKb: 190 },
  { fileName: `Berita Acara Kemajuan Pekerjaan BNF1-PMT-GEN-BA ${month}.pdf`, documentTypeId: 'dt-wpc', pages: 1, sizeKb: 410 },
  { fileName: 'SBU Konstruksi & PB-UMKU Certificates PT Berca Buana Sakti.pdf', documentTypeId: 'dt-support', pages: 27, sizeKb: 5_920 },
  { fileName: 'PO 4203000843 BAP New Facilities Phase 1.pdf', documentTypeId: 'dt-po', pages: 12, sizeKb: 1_040 },
  { fileName: `SES Berca Buana Sakti ${month}.pdf`, documentTypeId: 'dt-ses', pages: 1, sizeKb: 58 },
].filter((d) => !(opts.omit ?? []).includes(d.documentTypeId));

const emersonDocs = (inv: string, po: string, opts: { omit?: string[]; grn?: string } = {}): Doc[] => [
  { fileName: `Commercial Invoice ${inv} Emerson Asia Pacific.pdf`, documentTypeId: 'dt-invoice', pages: 4, sizeKb: 343 },
  { fileName: `Bill of Lading and Packing List INV ${inv} PO ${po}.pdf`, documentTypeId: 'dt-challan', pages: 7, sizeKb: 782 },
  { fileName: `PO ${po} Emerson.pdf`, documentTypeId: 'dt-po', pages: 9, sizeKb: 202 },
  ...(opts.grn ? [{ fileName: `Goods Receipt Form GR ${opts.grn}.pdf`, documentTypeId: 'dt-grn', pages: 3, sizeKb: 868 }] : []),
  { fileName: `Billing DJBC PIB PO ${po}.pdf`, documentTypeId: 'dt-support', pages: 9, sizeKb: 599 },
].filter((d) => !(opts.omit ?? []).includes(d.documentTypeId));

const campDocs = (inv: string, month: string, sesNo: string, opts: { omit?: string[] } = {}): Doc[] => [
  { fileName: `Invoice ${inv} Camp Maintenance ${month}.pdf`, documentTypeId: 'dt-invoice', pages: 2, sizeKb: 3_210 },
  { fileName: `Faktur Pajak ${inv}.pdf`, documentTypeId: 'dt-tax', pages: 1, sizeKb: 240 },
  { fileName: `Camp Maintenance Monthly Checklist ${month}.pdf`, documentTypeId: 'dt-support', pages: 16, sizeKb: 2_860 },
  { fileName: 'PO 4203001027 Baasithu Camp Service.pdf', documentTypeId: 'dt-po', pages: 2, sizeKb: 75 },
  { fileName: `SES ${sesNo} PO 4203001027 Baasithu Camp Service.pdf`, documentTypeId: 'dt-ses', pages: 1, sizeKb: 74 },
].filter((d) => !(opts.omit ?? []).includes(d.documentTypeId));

const cateringDocs = (inv: string, month: string, po: string, sesNo: string, opts: { omit?: string[] } = {}): Doc[] => [
  { fileName: `Proforma Invoice ${inv} Catering ${month}.pdf`, documentTypeId: 'dt-invoice', pages: 1, sizeKb: 380 },
  { fileName: `Berita Acara Kemajuan Pekerjaan Catering ${month}.pdf`, documentTypeId: 'dt-wpc', pages: 1, sizeKb: 420 },
  { fileName: `Meal Summary and Invoice Summary ${month}.pdf`, documentTypeId: 'dt-meal', pages: 3, sizeKb: 910 },
  { fileName: `Face-ID Meal Attendance Sheets ${month}.pdf`, documentTypeId: 'dt-attendance', pages: 4, sizeKb: 1_060 },
  { fileName: `PO ${po} Baasithu Catering.pdf`, documentTypeId: 'dt-po', pages: 2, sizeKb: 96 },
  { fileName: `SES ${sesNo} PO ${po} Baasithu Catering.pdf`, documentTypeId: 'dt-ses', pages: 1, sizeKb: 72 },
].filter((d) => !(opts.omit ?? []).includes(d.documentTypeId));

const travelDocs = (inv: string, opts: { statement?: string; omit?: string[] } = {}): Doc[] => [
  { fileName: `${inv.replace(/\//g, '-')} Wisata Kawan Invoice.pdf`, documentTypeId: 'dt-invoice', pages: 1, sizeKb: 67 },
  { fileName: `${inv.replace(/\//g, '-')} Wisata Kawan Faktur Pajak.pdf`, documentTypeId: 'dt-tax', pages: 1, sizeKb: 111 },
  ...(opts.statement ? [{ fileName: `Billing Statement ${opts.statement.replace(/\//g, '-')}.xls`, documentTypeId: 'dt-support', pages: 3, sizeKb: 138 }] : []),
  { fileName: `${inv.replace(/\//g, '-')} Travel Request Clearing HCIS.pdf`, documentTypeId: 'dt-dept', pages: 1, sizeKb: 92 },
].filter((d) => !(opts.omit ?? []).includes(d.documentTypeId));

// -------------------------------------------------------------- scenarios
const aleFacts = (c: ReturnType<typeof ALE.claim>, sesNo: string, period: [string, string]) => ({
  'TIMESHEET.TOTAL_HOURS': String(c.regular), 'TIMESHEET.HEADCOUNT': '4',
  'MANHOUR_SUMMARY.TOTAL_HOURS': String(c.regular), 'MANHOUR_SUMMARY.OT_HOURS': String(c.ot),
  'SES.SES_NUMBER': sesNo, 'SES.QUANTITY': String(c.regular), 'SES.SES_VALUE': String(c.subtotal),
  PERIOD_FROM: period[0], PERIOD_TO: period[1],
});

function aleScenario(p: {
  key: string; claimNo: string; ordinal: string; invoiceDate: string; receivedAt: string; period: [string, string];
  hours: { welder: number; fitter: number; otWelder: number; otFitter: number }; po: string; sesNo: string;
  target: Scenario['target']; assignTo?: string; exception?: Scenario['exception']; dates?: Scenario['dates']; biometricRegular?: number; omit?: string[]; degradeFields?: string[]; source?: Invoice['source'];
}): Scenario {
  const c = ALE.claim(p.hours);
  const periodLabel = `${p.period[0]} to ${p.period[1]}`;
  return {
    key: p.key, categoryId: 'cat-manpower', vendorCode: '30000956',
    invoiceNumber: p.claimNo, invoiceDate: p.invoiceDate, receivedAt: p.receivedAt, source: p.source ?? 'MANUAL_UPLOAD',
    subtotal: c.subtotal, taxAmount: ppn(c.subtotal),
    description: `Manpower Supply for Piping Fabrication (Welder, Fitter, Pipe Fitter) — ${p.ordinal} claim for ${periodLabel}`,
    poNumber: p.po, servicePeriod: p.period,
    docs: aleDocs(p.claimNo.replace(/\//g, '-'), periodLabel, p.po === '4203000546' ? 'PO_ALE.pdf' : 'PO_ALE_Year2.pdf', p.sesNo, { omit: p.omit }),
    lines: c.lines,
    facts: aleFacts(c, p.sesNo, p.period),
    attendance: { kind: 'HOURS', regular: p.biometricRegular ?? c.regular, ot: c.ot, headcount: 4 },
    target: p.target, dates: p.dates, degradeFields: p.degradeFields, assignTo: p.assignTo, exception: p.exception,
  };
}

function bercaScenario(p: {
  key: string; n: string; ref: string; invoiceDate: string; receivedAt: string; month: string; period: [string, string];
  claim: ReturnType<typeof progressClaim>; sesNo: string; target: Scenario['target']; assignTo?: string; exception?: Scenario['exception']; dates?: Scenario['dates']; degradeFields?: string[]; omit?: string[];
}): Scenario {
  const c = p.claim;
  return {
    key: p.key, categoryId: 'cat-service', vendorCode: '30000731',
    invoiceNumber: p.n, invoiceDate: p.invoiceDate, receivedAt: p.receivedAt, source: 'MANUAL_UPLOAD',
    subtotal: c.net, taxAmount: c.vat, total: c.total,
    description: `New Facility Construction Work Phase 1 — Progress ${p.month} (${c.pct}% this period, cumulative ${c.cumulativePct}%); ref ${p.ref}`,
    poNumber: '4203000843', servicePeriod: p.period,
    docs: bercaDocs(p.n.replace(/\//g, '-'), p.month, { omit: p.omit }),
    lines: [
      { description: `Work carried out — ${c.pct}% of contract value IDR 102,500,000,000`, quantity: 1, uom: 'LOT', unitPrice: c.workValue, amount: c.workValue, poItem: '00300' },
      { description: 'Advance payment recovery (15%)', quantity: 1, uom: 'LOT', unitPrice: -c.advance, amount: -c.advance },
      { description: 'Retention (10%)', quantity: 1, uom: 'LOT', unitPrice: -c.retention, amount: -c.retention },
    ],
    facts: {
      'INVOICE.INVOICE_GROSS_VALUE': String(c.workValue),
      'SES.SES_NUMBER': p.sesNo, 'SES.SES_VALUE': String(getSes(p.sesNo)), PERIOD_FROM: p.period[0], PERIOD_TO: p.period[1],
      'PROGRESS_CERTIFICATE.PROGRESS_PCT': String(c.pct), 'PROGRESS_CERTIFICATE.CUMULATIVE_PCT': String(c.cumulativePct),
    },
    target: p.target, dates: p.dates, degradeFields: p.degradeFields, priority: 'HIGH', assignTo: p.assignTo, exception: p.exception,
  };
}

// SES values are read from the SAP seed so a mismatch is a real data difference, never a typo.
function getSes(sesNo: string): number {
  const s = SAP_SES.find((x) => x.sesNumber === sesNo);
  if (!s) throw new Error(`Seed: SES ${sesNo} is not in the SAP reference data`);
  return s.acceptedAmount;
}

function campScenario(p: {
  key: string; inv: string; invoiceDate: string; receivedAt: string; month: string; period: [string, string]; subtotal: number; sesNo: string;
  target: Scenario['target']; assignTo?: string; exception?: Scenario['exception']; dates?: Scenario['dates']; degradeFields?: string[]; omit?: string[]; source?: Invoice['source'];
}): Scenario {
  return {
    key: p.key, categoryId: 'cat-service', vendorCode: '30000512',
    invoiceNumber: p.inv, invoiceDate: p.invoiceDate, receivedAt: p.receivedAt, source: p.source ?? 'EMAIL',
    subtotal: p.subtotal, taxAmount: ppn(p.subtotal),
    description: `Camp Maintenance Service — ${p.month} (PO 4203001027, Feb 2026 – Jan 2027)`,
    poNumber: '4203001027', servicePeriod: p.period,
    docs: campDocs(p.inv.replace(/\//g, '-'), p.month, p.sesNo, { omit: p.omit }),
    lines: [{ description: `Camp Maintenance Service — ${p.month}`, quantity: 1, uom: 'MON', unitPrice: p.subtotal, amount: p.subtotal, poItem: '00020' }],
    facts: { 'INVOICE.INVOICE_GROSS_VALUE': String(p.subtotal), 'SES.SES_NUMBER': p.sesNo, 'SES.SES_VALUE': String(getSes(p.sesNo)), PERIOD_FROM: p.period[0], PERIOD_TO: p.period[1] },
    target: p.target, dates: p.dates, degradeFields: p.degradeFields, assignTo: p.assignTo, exception: p.exception,
  };
}

function cateringScenario(p: {
  key: string; inv: string; invoiceDate: string; receivedAt: string; month: string; period: [string, string]; po: string; sesNo: string;
  meals: { breakfastSupper: number; lunch: number; dinner: number }; eligibleMeals: number;
  target: Scenario['target']; assignTo?: string; exception?: Scenario['exception']; dates?: Scenario['dates']; omit?: string[]; degradeFields?: string[];
}): Scenario {
  const c = mealClaim(p.meals);
  return {
    key: p.key, categoryId: 'cat-catering', vendorCode: '30000512',
    invoiceNumber: p.inv, invoiceDate: p.invoiceDate, receivedAt: p.receivedAt, source: 'SHAREPOINT',
    subtotal: c.subtotal, taxAmount: localTax(c.subtotal),
    description: `Catering services at BAP — Meal PAU ${p.month} (${c.meals.toLocaleString('en-US')} meals)`,
    poNumber: p.po, servicePeriod: p.period,
    docs: cateringDocs(p.inv.replace(/\//g, '-'), p.month, p.po, p.sesNo, { omit: p.omit }),
    lines: c.lines,
    facts: {
      'MEAL_SUMMARY.MEAL_COUNT': String(c.meals), 'MEAL_SUMMARY.UNIT_RATE': c.blendedRate.toFixed(2),
      'SES.SES_NUMBER': p.sesNo, 'SES.SES_VALUE': String(getSes(p.sesNo)), PERIOD_FROM: p.period[0], PERIOD_TO: p.period[1],
    },
    // Site headcount on the face-ID roster: enough people that ~92% of the
    // person-day meal slots in the month are taken (~110 for a 31-day month).
    attendance: { kind: 'MEALS', eligibleMeals: p.eligibleMeals, headcount: Math.ceil(p.eligibleMeals / (daysBetween(p.period[0], p.period[1]) * 3 * 0.92)) },
    target: p.target, dates: p.dates, degradeFields: p.degradeFields, assignTo: p.assignTo, exception: p.exception,
  };
}

function travelScenario(p: {
  key: string; inv: string; invoiceDate: string; receivedAt: string; base: number; ppnAmount?: number; description: string; statement?: string;
  target: Scenario['target']; assignTo?: string; exception?: Scenario['exception']; dates?: Scenario['dates']; omit?: string[]; degradeFields?: string[]; rejectReason?: string; request: string; source?: Invoice['source'];
}): Scenario {
  const tax = p.ppnAmount ?? Math.round(p.base * 0.011);
  return {
    key: p.key, categoryId: 'cat-nonpo', vendorCode: '30000318',
    invoiceNumber: p.inv, invoiceDate: p.invoiceDate, receivedAt: p.receivedAt, source: p.source ?? 'EMAIL',
    subtotal: p.base, taxAmount: tax,
    description: p.description,
    docs: travelDocs(p.inv, { statement: p.statement, omit: p.omit }),
    lines: [{ description: p.description, quantity: 1, uom: 'AU', unitPrice: p.base, amount: p.base }],
    facts: { 'INVOICE.COST_CENTER': p.request },
    target: p.target, dates: p.dates, degradeFields: p.degradeFields, rejectReason: p.rejectReason, taxReviewRequired: false, assignTo: p.assignTo, exception: p.exception,
  };
}

export const SCENARIOS: Scenario[] = [
  // =====================================================================
  // PT Amanah Lestari Energy — Manpower Supply for Piping Fabrication
  // PO 4203000546 (Jun 2025 – May 2026), renewed as PO 4203001318.
  // Claim values 7th – 10th are printed on the Summary Calculation sheet of the
  // sample bundle; the 10th claim is the sample invoice 568/PT.ALE-PAU/04/2026.
  // =====================================================================
  aleScenario({ key: 'ale-9', claimNo: '567/PT.ALE-PAU/03/2026', ordinal: '9th', invoiceDate: '2026-03-23', receivedAt: at('2026-03-24', '10:10'), period: ['2026-02-07', '2026-03-06'],
    hours: { welder: 357.6, fitter: 410.6, otWelder: 46.1, otFitter: 91.7 }, po: '4203000546', sesNo: '8000002946', target: 'PAID',
    dates: { approved: '2026-03-27', acknowledged: '2026-03-30', posted: '2026-04-01', paid: '2026-04-22' } }),
  aleScenario({ key: 'ale-10', claimNo: '568/PT.ALE-PAU/04/2026', ordinal: '10th', invoiceDate: '2026-04-22', receivedAt: at('2026-04-23', '11:20'), period: ['2026-03-07', '2026-04-06'],
    hours: { welder: 366.5, fitter: 392, otWelder: 83.5, otFitter: 97 }, po: '4203000546', sesNo: '8000003065', target: 'PAID',
    dates: { approved: '2026-04-28', acknowledged: '2026-04-30', posted: '2026-05-04', paid: '2026-05-22' } }),
  aleScenario({ key: 'ale-11', claimNo: '569/PT.ALE-PAU/05/2026', ordinal: '11th', invoiceDate: '2026-05-22', receivedAt: at('2026-05-25', '09:40'), period: ['2026-04-07', '2026-05-06'],
    hours: { welder: 380, fitter: 401, otWelder: 64, otFitter: 58 }, po: '4203000546', sesNo: '8000003221', target: 'PAID',
    dates: { approved: '2026-05-28', acknowledged: '2026-06-01', posted: '2026-06-03', paid: '2026-06-24' } }),
  aleScenario({ key: 'ale-12', claimNo: '570/PT.ALE-PAU/06/2026', ordinal: '12th (final)', invoiceDate: '2026-06-15', receivedAt: at('2026-06-16', '14:05'), period: ['2026-05-07', '2026-05-31'],
    hours: { welder: 318, fitter: 335, otWelder: 42, otFitter: 39 }, po: '4203000546', sesNo: '8000003347', target: 'PAID',
    dates: { approved: '2026-06-19', acknowledged: '2026-06-22', posted: '2026-06-24', paid: '2026-07-15' } }),
  aleScenario({ key: 'ale-y2-1', claimNo: '571/PT.ALE-PAU/07/2026', ordinal: '1st (year 2)', invoiceDate: '2026-07-20', receivedAt: at('2026-07-21', '10:30'), period: ['2026-06-07', '2026-07-06'],
    hours: { welder: 371.5, fitter: 388, otWelder: 70, otFitter: 66 }, po: '4203001318', sesNo: '8000003438', target: 'PAID',
    dates: { approved: '2026-07-24', acknowledged: '2026-07-27', posted: '2026-07-29', paid: '2026-08-19' } }),
  // Timesheets bill 746 regular hours; the ESSA-MIS biometric push for the
  // period holds 718 — a 3.8% shortfall against the 1% tolerance.
  aleScenario({ key: 'ale-y2-2', claimNo: '572/PT.ALE-PAU/08/2026', ordinal: '2nd (year 2)', invoiceDate: '2026-08-18', receivedAt: at('2026-08-19', '09:15'), period: ['2026-07-07', '2026-08-06'],
    hours: { welder: 360, fitter: 386, otWelder: 58, otFitter: 55 }, po: '4203001318', sesNo: '8000003561', target: 'VALIDATION_FAILED', biometricRegular: 718, assignTo: 'u-priya',
    exception: { status: 'ASSIGNED', on: '2026-08-20', note: '' } }),

  // =====================================================================
  // PT Berca Buana Sakti — BAP New Facilities Phase 1 (contract 0032/AG/PAU-EXT/2025)
  // Progress 2 is the sample invoice 052/20304G/V/2026 dated 4 May 2026.
  // =====================================================================
  bercaScenario({ key: 'bbs-p1', n: '051/20304G/III/2026', ref: 'BBS/PAU/Com/III/2026/002', invoiceDate: '2026-03-02', receivedAt: at('2026-03-03', '15:20'), month: '1 End 8 February 2026', period: ['2025-11-24', '2026-02-08'],
    claim: progressClaim(4_374_049_731, 4.267, 4.267), sesNo: '8000002713', target: 'PAID',
    dates: { approved: '2026-03-10', acknowledged: '2026-03-12', posted: '2026-03-16', paid: '2026-04-10' } }),
  bercaScenario({ key: 'bbs-p2', n: '052/20304G/V/2026', ref: 'BBS/PAU/Com/V/2026/003', invoiceDate: '2026-05-04', receivedAt: at('2026-05-05', '11:45'), month: '2 End 8 March 2026', period: ['2026-02-09', '2026-03-08'],
    claim: progressClaim(5_317_983_735, 5.188, 9.456), sesNo: '8000003131', target: 'PAID',
    dates: { approved: '2026-05-12', acknowledged: '2026-05-14', posted: '2026-05-18', paid: '2026-06-15' } }),
  bercaScenario({ key: 'bbs-p3', n: '053/20304G/VII/2026', ref: 'BBS/PAU/Com/VII/2026/004', invoiceDate: '2026-07-06', receivedAt: at('2026-07-07', '10:05'), month: '3 End 8 May 2026', period: ['2026-03-09', '2026-05-08'],
    claim: progressClaim(6_047_500_000, 5.9, 15.356), sesNo: '8000003420', target: 'PAID',
    dates: { approved: '2026-07-13', acknowledged: '2026-07-15', posted: '2026-07-20', paid: '2026-08-17' } }),
  // Progress 4: AP review and SES confirmation done; with the Tax Team for PPh 4(2) final tax on construction services.
  bercaScenario({ key: 'bbs-p4', n: '054/20304G/VIII/2026', ref: 'BBS/PAU/Com/VIII/2026/005', invoiceDate: '2026-08-19', receivedAt: at('2026-08-20', '10:05'), month: '4 End 8 July 2026', period: ['2026-05-09', '2026-07-08'],
    claim: progressClaim(6_355_000_000, 6.2, 21.556), sesNo: '8000003552', target: 'TAX_REVIEW' }),

  // =====================================================================
  // Emerson Asia Pacific — imported valve spares (USD, FOB Port Klang)
  // Invoice 6581888 is the sample bundle: PO 4202000128, GRN 5000001927,
  // PIB billing 640260304481623, LD clause confirmed not applicable.
  // =====================================================================
  {
    key: 'emr-6581888', categoryId: 'cat-material', vendorCode: '40000143',
    invoiceNumber: '6581888', invoiceDate: '2026-03-10', receivedAt: at('2026-03-12', '08:50'), source: 'EMAIL', currency: 'USD',
    subtotal: 19_992, taxAmount: 0,
    description: 'Body S/A spare for replacement valve PV-1015 Fisher — sales order 9275396, ship date 10 Mar 2026, NET45 (due 24 Apr 2026)',
    poNumber: '4202000128',
    docs: emersonDocs('6581888', '4202000128', { grn: '5000001927' }),
    lines: [{ description: 'Body valve with bonnet, ASTM A216 GRD WCC, 8 in, Class 600, globe, ED — Tag PV-1015', quantity: 1, uom: 'SET', unitPrice: 19_992, amount: 19_992, poItem: '00010' }],
    facts: { 'GRN.GRN_NUMBER': '5000001927', 'GRN.QUANTITY': '1', 'PURCHASE_ORDER.QUANTITY': '1', 'PURCHASE_ORDER.UNIT_RATE': '19992' },
    sapDocumentNo: '5105605935',
    target: 'PAID', taxReviewRequired: false,
    dates: { approved: '2026-04-13', acknowledged: '2026-04-14', posted: '2026-04-15', paid: '2026-04-24' },
  },
  // One of the two DVC6200 controllers was received (GR 5000002144); the vendor invoiced both.
  {
    key: 'emr-6604512', categoryId: 'cat-material', vendorCode: '40000143',
    invoiceNumber: '6604512', invoiceDate: '2026-08-11', receivedAt: at('2026-08-12', '09:05'), source: 'EMAIL', currency: 'USD',
    subtotal: 9_720, taxAmount: 0,
    description: 'Fisher DVC6200 SIS digital valve controllers (2) for PV-1015 / PV-1016 — sales order 9301184, NET45',
    poNumber: '4202000141',
    docs: emersonDocs('6604512', '4202000141', { grn: '5000002144' }),
    lines: [{ description: 'Fisher DVC6200 SIS digital valve controller, HART', quantity: 2, uom: 'PCE', unitPrice: 4_860, amount: 9_720, poItem: '00010' }],
    facts: { 'GRN.GRN_NUMBER': '5000002144', 'GRN.QUANTITY': '1', 'PURCHASE_ORDER.QUANTITY': '2', 'PURCHASE_ORDER.UNIT_RATE': '4860' },
    target: 'VALIDATION_FAILED', taxReviewRequired: false, assignTo: 'u-priya',
    exception: { status: 'WAITING', on: '2026-08-13', note: 'GRN 5000002144 covers 1 of the 2 DVC6200 units; the second unit is still in transit (Emerson advised ETA week 35). Holding the invoice until the second GRN is posted — vendor asked whether it prefers a split invoice.' },
  },
  // Repair kits invoiced while the shipment is still at customs — no goods receipt yet.
  {
    key: 'emr-6609230', categoryId: 'cat-material', vendorCode: '40000143',
    invoiceNumber: '6609230', invoiceDate: '2026-08-19', receivedAt: at('2026-08-20', '08:35'), source: 'EMAIL', currency: 'USD',
    subtotal: 2_460, taxAmount: 0,
    description: 'Repair kits, actuator diaphragm 667 size 45 (4) — sales order 9301184, NET45',
    poNumber: '4202000141',
    docs: emersonDocs('6609230', '4202000141', {}),
    lines: [{ description: 'Repair kit, actuator diaphragm 667 size 45, Fisher', quantity: 4, uom: 'PCE', unitPrice: 615, amount: 2_460, poItem: '00020' }],
    facts: { 'PURCHASE_ORDER.QUANTITY': '4', 'PURCHASE_ORDER.UNIT_RATE': '615' },
    target: 'MISSING_DOCS', taxReviewRequired: false,
  },

  // =====================================================================
  // PT Baasithu Boga Services — Camp Maintenance Service, PO 4203001027
  // March 2026 is the sample invoice 090/BBS-INV/04/2026 (SES 8000003051).
  // =====================================================================
  campScenario({ key: 'camp-mar', inv: '090/BBS-INV/04/2026', invoiceDate: '2026-04-23', receivedAt: at('2026-04-27', '13:30'), month: 'March 2026', period: ['2026-03-01', '2026-03-31'], subtotal: 132_231_381, sesNo: '8000003051', target: 'PAID',
    dates: { approved: '2026-04-30', acknowledged: '2026-05-04', posted: '2026-05-06', paid: '2026-05-27' } }),
  campScenario({ key: 'camp-may', inv: '094/BBS-INV/06/2026', invoiceDate: '2026-06-19', receivedAt: at('2026-06-22', '10:15'), month: 'May 2026', period: ['2026-05-01', '2026-05-31'], subtotal: 148_381_800, sesNo: '8000003268', target: 'PAID',
    dates: { approved: '2026-06-25', acknowledged: '2026-06-29', posted: '2026-07-01', paid: '2026-07-22' } }),
  campScenario({ key: 'camp-jun', inv: '096/BBS-INV/07/2026', invoiceDate: '2026-07-22', receivedAt: at('2026-07-23', '09:50'), month: 'June 2026', period: ['2026-06-01', '2026-06-30'], subtotal: 150_652_000, sesNo: '8000003389', target: 'PAID',
    dates: { approved: '2026-07-29', acknowledged: '2026-08-03', posted: '2026-08-05', paid: '2026-08-19' } }),
  // July: the vendor billed the full month, the SES accepted 0.933 of a month (camp closed 2 days for maintenance) — 4.2% over the 2% tolerance.
  campScenario({ key: 'camp-jul', inv: '098/BBS-INV/08/2026', invoiceDate: '2026-08-19', receivedAt: at('2026-08-20', '11:25'), month: 'July 2026', period: ['2026-07-01', '2026-07-31'], subtotal: 147_209_300, sesNo: '8000003476', target: 'VALIDATION_FAILED', source: 'MANUAL_UPLOAD' }),

  // =====================================================================
  // PT Baasithu Boga Services — Catering (Meal PAU), PO 4203000502 and renewal 4203001112
  // January 2026 is the sample proforma invoice 194/BBS-PI/II/2026 (SES 8000002626):
  // B'fast & Supper 3,767 · Lunch 2,658 · Dinner 2,790 = IDR 552,550,288.
  // =====================================================================
  cateringScenario({ key: 'cat-nov', inv: '187/BBS-PI/XII/2025', invoiceDate: '2025-12-03', receivedAt: at('2025-12-12', '14:00'), month: 'November 2025', period: ['2025-11-01', '2025-11-30'], po: '4203000502', sesNo: '8000002227',
    meals: { breakfastSupper: 3_720, lunch: 2_640, dinner: 2_740 }, eligibleMeals: 8_960, target: 'PAID',
    dates: { approved: '2025-12-17', acknowledged: '2025-12-19', posted: '2025-12-22', paid: '2026-01-14' } }),
  cateringScenario({ key: 'cat-dec', inv: '190/BBS-PI/I/2026', invoiceDate: '2026-01-05', receivedAt: at('2026-01-13', '10:20'), month: 'December 2025', period: ['2025-12-01', '2025-12-31'], po: '4203000502', sesNo: '8000002455',
    meals: { breakfastSupper: 3_560, lunch: 2_560, dinner: 2_600 }, eligibleMeals: 8_610, target: 'PAID',
    dates: { approved: '2026-01-16', acknowledged: '2026-01-19', posted: '2026-01-21', paid: '2026-02-12' } }),
  cateringScenario({ key: 'cat-jan', inv: '194/BBS-PI/II/2026', invoiceDate: '2026-02-03', receivedAt: at('2026-02-12', '13:05'), month: 'January 2026', period: ['2026-01-01', '2026-01-31'], po: '4203000502', sesNo: '8000002626',
    meals: { breakfastSupper: 3_767, lunch: 2_658, dinner: 2_790 }, eligibleMeals: 9_010, target: 'PAID',
    dates: { approved: '2026-02-17', acknowledged: '2026-02-19', posted: '2026-02-23', paid: '2026-03-13' } }),
  cateringScenario({ key: 'cat-jun', inv: '214/BBS-PI/VII/2026', invoiceDate: '2026-07-03', receivedAt: at('2026-07-09', '09:30'), month: 'June 2026', period: ['2026-06-01', '2026-06-30'], po: '4203001112', sesNo: '8000003408',
    meals: { breakfastSupper: 3_690, lunch: 2_712, dinner: 2_741 }, eligibleMeals: 8_930, target: 'PAID',
    dates: { approved: '2026-07-14', acknowledged: '2026-07-16', posted: '2026-07-20', paid: '2026-08-10' } }),
  // July: 9,480 meals billed against 8,690 face-ID eligible meals (+5% guests = 9,125) — over the cap.
  cateringScenario({ key: 'cat-jul', inv: '218/BBS-PI/VIII/2026', invoiceDate: '2026-08-14', receivedAt: at('2026-08-18', '10:40'), month: 'July 2026', period: ['2026-07-01', '2026-07-31'], po: '4203001112', sesNo: '8000003538',
    meals: { breakfastSupper: 3_912, lunch: 2_804, dinner: 2_764 }, eligibleMeals: 8_690, target: 'VALIDATION_FAILED', assignTo: 'u-priya',
    exception: { status: 'IN_PROGRESS', on: '2026-08-19', note: 'Proforma bills 9,480 meals against 8,690 face-ID eligible meals (+5% guest allowance = 9,125). Reconciling the July guest register with Site Services; Baasithu to re-issue the proforma or credit the 355 excess packs.' } }),

  // =====================================================================
  // PT Wisata Kawan Abadi — travel agent, Non-PO
  // INV/TD/000591/2026 and billing statements 010 / 012 FEBRUARI 2026 are the sample bundle.
  // =====================================================================
  travelScenario({ key: 'wka-591', inv: 'INV/TD/000591/2026', invoiceDate: '2026-02-27', receivedAt: at('2026-03-02', '09:12'), base: 3_110_000, ppnAmount: 34_210,
    description: 'Ticket domestic Batik Air ID 6295 Luwuk – Jakarta, 2 Mar 2026, 1 pax, PNR AWBWRB (booking BF/2026/02/126637)', request: 'Tra_5840 / Trip_3966', target: 'PAID',
    dates: { approved: '2026-03-04', acknowledged: '2026-03-05', posted: '2026-03-06', paid: '2026-03-13' } }),
  travelScenario({ key: 'wka-010', inv: '010/FEBRUARI/2026', invoiceDate: '2026-02-28', receivedAt: at('2026-03-03', '10:35'), base: 529_385_600, ppnAmount: 5_823_242, statement: '010/FEBRUARI/2026',
    description: 'Billing statement 010/FEBRUARI/2026 — PAU travel (tickets and hotels) 16–28 February 2026', request: 'Bill State 010/FEBRUARI/2026', target: 'PAID',
    dates: { approved: '2026-03-09', acknowledged: '2026-03-10', posted: '2026-03-11', paid: '2026-03-16' } }),
  travelScenario({ key: 'wka-012', inv: '012/FEBRUARI/2026', invoiceDate: '2026-02-28', receivedAt: at('2026-03-03', '10:35'), base: 3_172_000, ppnAmount: 34_892, statement: '012/FEBRUARI/2026',
    description: 'Billing statement 012/FEBRUARI/2026 — Thai Airways TG 434 reissue Jakarta – Bangkok – Delhi, 2 pax', request: 'Tra_5989 / Tra_5990 / Trip_3515', target: 'PAID',
    dates: { approved: '2026-03-05', acknowledged: '2026-03-06', posted: '2026-03-09', paid: '2026-03-16' } }),
  travelScenario({ key: 'wka-014', inv: '014/JUNI/2026', invoiceDate: '2026-06-30', receivedAt: at('2026-07-02', '11:00'), base: 407_890_000, statement: '014/JUNI/2026',
    description: 'Billing statement 014/JUNI/2026 — PAU travel (tickets and hotels) 16–30 June 2026', request: 'Bill State 014/JUNI/2026', target: 'PAID',
    dates: { approved: '2026-07-09', acknowledged: '2026-07-10', posted: '2026-07-13', paid: '2026-07-24' } }),
  travelScenario({ key: 'wka-016', inv: '016/JULI/2026', invoiceDate: '2026-07-15', receivedAt: at('2026-07-17', '09:45'), base: 288_450_000, statement: '016/JULI/2026',
    description: 'Billing statement 016/JULI/2026 — PAU travel (tickets and hotels) 1–15 July 2026', request: 'Bill State 016/JULI/2026', target: 'PAID',
    dates: { approved: '2026-07-21', acknowledged: '2026-07-22', posted: '2026-07-23', paid: '2026-08-06' } }),
  travelScenario({ key: 'wka-017', inv: '017/JULI/2026', invoiceDate: '2026-07-31', receivedAt: at('2026-08-03', '10:10'), base: 356_120_000, statement: '017/JULI/2026',
    description: 'Billing statement 017/JULI/2026 — PAU travel (tickets and hotels) 16–31 July 2026', request: 'Bill State 017/JULI/2026', target: 'REJECTED',
    dates: { rejected: '2026-08-07' }, rejectReason: 'Voucher INV/TD/000740/2026 (Batik Air ID 6293 Luwuk – Jakarta) is billed twice on this statement. Please issue a corrected statement and credit note.',
    assignTo: 'u-priya', exception: { status: 'WAITING', on: '2026-08-07', note: 'Rejection sent to Wisata Kawan Abadi with the duplicated voucher highlighted; corrected statement 017/JULI/2026-R and credit note awaited before resubmission.' } }),
  // ---- live items (received 18 – 24 August 2026) ----
  travelScenario({ key: 'wka-018', inv: '018/AGUSTUS/2026', invoiceDate: '2026-08-15', receivedAt: at('2026-08-18', '15:40'), base: 301_300_000, statement: '018/AGUSTUS/2026',
    description: 'Billing statement 018/AGUSTUS/2026 — PAU travel (tickets and hotels) 1–15 August 2026', request: 'Bill State 018/AGUSTUS/2026', target: 'MISSING_DOCS', omit: ['dt-dept'], assignTo: 'u-priya',
    exception: { status: 'WAITING', on: '2026-08-19', note: 'Department approval (HCIS clearing journal) for the 1–15 August travel requests requested from the HR travel desk on 19 Aug; chase reminder scheduled per the missing-document SLA.' } }),
  travelScenario({ key: 'wka-833', inv: 'INV/TD/000833/2026', invoiceDate: '2026-08-18', receivedAt: at('2026-08-19', '09:20'), base: 3_236_000,
    description: 'Ticket domestic Batik Air ID 6295 Luwuk – Jakarta, 19 Aug 2026, 1 pax, business trip', request: 'Tra_6118 / Trip_4176', target: 'POSTED',
    dates: { approved: '2026-08-20', acknowledged: '2026-08-21', posted: '2026-08-24' } }),
  travelScenario({ key: 'wka-846', inv: 'INV/TD/000846/2026', invoiceDate: '2026-08-19', receivedAt: at('2026-08-20', '08:55'), base: 2_942_000,
    description: 'Ticket domestic Batik Air ID 6292 Jakarta – Luwuk, 20 Aug 2026, 1 pax, roster', request: 'Tra_6124 / Trip_4180', target: 'PARKED',
    dates: { approved: '2026-08-21', acknowledged: '2026-08-24', parked: '2026-08-24' } }),
  travelScenario({ key: 'wka-897', inv: 'INV/HD/000897/2026', invoiceDate: '2026-08-19', receivedAt: at('2026-08-20', '11:10'), base: 4_812_000,
    description: 'Hotel domestic — Manhattan Hotel Jakarta, 2 nights superior room, 1 pax, business trip', request: 'Acc_1712 / Trip_4140', target: 'IN_PROGRESS',
    dates: { approved: '2026-08-21', acknowledged: '2026-08-24' } }),
  // Awaiting the AP Supervisor since 20 Aug — over the 1-day Non-PO approval SLA, so the reminder / escalation chain is visible.
  travelScenario({ key: 'wka-902', inv: 'INV/HD/000902/2026', invoiceDate: '2026-08-19', receivedAt: at('2026-08-20', '14:20'), base: 3_960_000,
    description: 'Hotel domestic — Swiss-Belhotel Luwuk, 3 nights deluxe room, 1 pax, site visit', request: 'Acc_1719 / Trip_4152', target: 'APPROVAL_STEP_1' }),
  travelScenario({ key: 'wka-858', inv: 'INV/TD/000858/2026', invoiceDate: '2026-08-20', receivedAt: at('2026-08-21', '09:45'), base: 3_310_000,
    description: 'Ticket domestic Batik Air ID 6293 Luwuk – Jakarta, 21 Aug 2026, 1 pax, business trip', request: 'Tra_6131 / Trip_4188', target: 'APPROVAL_STEP_2', dates: { approved: '2026-08-24' } }),
  travelScenario({ key: 'wka-861', inv: 'INV/TD/000861/2026', invoiceDate: '2026-08-20', receivedAt: at('2026-08-21', '15:05'), base: 2_942_000,
    description: 'Ticket domestic Batik Air ID 6292 Jakarta – Luwuk, 22 Aug 2026, 1 pax, roster (scanned copy)', request: 'Tra_6137 / Trip_4193', target: 'EXTRACTION_REVIEW', degradeFields: ['INVOICE_NUMBER', 'INVOICE_AMOUNT'], source: 'MANUAL_UPLOAD' }),
  travelScenario({ key: 'wka-871', inv: 'INV/TD/000871/2026', invoiceDate: '2026-08-24', receivedAt: at('2026-08-24', '16:30'), base: 3_375_000,
    description: 'Ticket domestic Batik Air ID 6292 Jakarta – Luwuk, 25 Aug 2026, 1 pax, roster', request: 'Tra_6155 / Trip_4210', target: 'RECEIVED', source: 'MANUAL_UPLOAD' }),
];

// -------------------------------------------------------- attendance seed
let attSeq = 0;
const WORKERS = [
  { id: 'ALE-W01', name: 'Welder 1 (SMAW/GTAW)' }, { id: 'ALE-W02', name: 'Welder 2 (SMAW/GTAW)' },
  { id: 'ALE-F01', name: 'Fitter 1' }, { id: 'ALE-F02', name: 'Fitter 2' },
];

/** Calendar days in an inclusive period. */
function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY) + 1;
}

/** Working days (Mon–Sat) inside a period, as yyyy-mm-dd. */
function workingDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= new Date(`${to}T00:00:00Z`).getTime(); t += DAY) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Spread `total` over `slots` in steps of 0.5 so the sum is exact. */
function spread(total: number, slots: number): number[] {
  const units = Math.round(total * 2);
  const base = Math.floor(units / slots);
  const extra = units - base * slots;
  return Array.from({ length: slots }, (_, i) => (base + (i < extra ? 1 : 0)) / 2);
}

function seedAttendance(db: Database, sc: Scenario) {
  if (!sc.attendance || !sc.servicePeriod) return;
  const [from, to] = sc.servicePeriod;
  const batchId = `BATCH-${to}-${sc.vendorCode}`;
  const pushedAt = clamp(plusDays(at(to), 2, '06:30'));
  const days = workingDays(from, to);
  if (sc.attendance.kind === 'HOURS') {
    const slots = days.length * WORKERS.length;
    const hours = spread(sc.attendance.regular, slots);
    const ot = spread(sc.attendance.ot, slots);
    let i = 0;
    for (const date of days) {
      for (const w of WORKERS) {
        attSeq += 1;
        const rec: AttendanceRecord = {
          id: `att-${attSeq}`, batchId, source: 'ESSA-MIS', site: COMPANY.site, vendorCode: sc.vendorCode,
          employeeId: w.id, employeeName: w.name, date, present: hours[i] > 0, hours: hours[i], otHours: ot[i], mealEligible: hours[i] > 0,
          pushedAt, status: 'ACCEPTED',
        };
        db.attendanceRecords.push(rec);
        i += 1;
      }
    }
  } else {
    // Face-ID meal eligibility: three meal slots (breakfast/supper, lunch,
    // dinner) per person per calendar day. Every eligible meal is one present,
    // meal-eligible record, so the biometric MEAL_COUNT the rule engine derives
    // for the service period equals `eligibleMeals` exactly; the remaining
    // slots are pushed as present but not meal-eligible (off-roster / leave).
    const calendarDays: string[] = [];
    for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= new Date(`${to}T00:00:00Z`).getTime(); t += DAY) calendarDays.push(new Date(t).toISOString().slice(0, 10));
    const headcount = sc.attendance.headcount;
    const eligible = sc.attendance.eligibleMeals;
    let i = 0;
    for (const date of calendarDays) {
      for (let p = 0; p < headcount; p++) {
        // three meal slots per person-day: breakfast/supper, lunch, dinner
        for (let m = 0; m < 3; m++) {
          attSeq += 1;
          db.attendanceRecords.push({
            id: `att-${attSeq}`, batchId, source: 'ESSA-MIS', site: COMPANY.site, vendorCode: sc.vendorCode,
            employeeId: `PAU-${String(1001 + p).padStart(4, '0')}`, employeeName: `Site employee ${1001 + p}`, date,
            present: true, hours: 8, otHours: 0, mealEligible: i < eligible, pushedAt, status: 'ACCEPTED',
          });
          i += 1;
        }
      }
    }
  }
}

/** Record how far the AP team has got with the exception the pipeline just raised. */
function workException(db: Database, invoice: Invoice, sc: Scenario) {
  if (sc.assignTo) invoice.assignedTo = sc.assignTo;
  if (!sc.exception) return;
  const user = db.users.find((u) => u.id === (sc.assignTo ?? 'u-priya'));
  if (!user) throw new Error(`Seed: assignee for ${sc.key} not found`);
  const when = clamp(at(sc.exception.on, '09:40'));
  for (const ex of db.exceptions.filter((e) => e.invoiceId === invoice.id && e.status === 'OPEN')) {
    ex.assignedTo = user.id;
    ex.assignedToName = user.name;
    ex.actions.push({ at: when, by: user.id, byName: user.name, action: 'ASSIGNED', note: `Assigned to ${user.name}` });
    if (sc.exception.status !== 'ASSIGNED') {
      ex.actions.push({ at: clamp(at(sc.exception.on, '10:15')), by: user.id, byName: user.name, action: sc.exception.status === 'WAITING' ? 'WAITING' : 'INVESTIGATING', note: sc.exception.note });
    }
    ex.status = sc.exception.status;
  }
}

// ------------------------------------------------------------ invoice maker
export function seedInvoices(db: Database, scenarios: Scenario[]) {
  const seen = new Set<string>();
  for (const sc of scenarios) {
    if (sc.attendance && sc.servicePeriod) {
      const key = `${sc.vendorCode}|${sc.servicePeriod.join('|')}`;
      if (!seen.has(key)) { seen.add(key); seedAttendance(db, sc); }
    }
  }

  // The SAP reference data carries today's PO balances — PO value less every
  // SES / GRN accepted so far, exactly as the SES print-outs state them. A
  // historical invoice has to be validated against the balance SAP showed on
  // the day it arrived (before its own SES / GRN was deducted), otherwise the
  // final claim on a closed PO would fail "invoice within PO open value" even
  // though it was paid. Scenarios are replayed in arrival order and the PO
  // balance is wound back accordingly; today's balance is restored at the end.
  const acceptedFor = (sc: Scenario): number => {
    const numbers = (key: string) => (sc.facts?.[key] ?? '').split(/[,;/ ]+/).map((n) => n.trim()).filter(Boolean);
    const ses = numbers('SES.SES_NUMBER').reduce((sum, n) => sum + (db.sapSes.find((x) => x.sesNumber === n)?.acceptedAmount ?? 0), 0);
    const grn = numbers('GRN.GRN_NUMBER').reduce((sum, n) => sum + (db.sapGrns.find((x) => x.grnNumber === n)?.amount ?? 0), 0);
    return ses + grn;
  };
  const balanceToday = new Map<string, number>();
  const consumed = new Map<string, number>();
  for (const po of db.sapPurchaseOrders) balanceToday.set(po.poNumber, po.openAmount);
  const ordered = [...scenarios].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const openAtStart = new Map<string, number>();
  for (const po of db.sapPurchaseOrders) openAtStart.set(po.poNumber, po.openAmount + ordered.filter((sc) => sc.poNumber === po.poNumber).reduce((sum, sc) => sum + acceptedFor(sc), 0));

  for (const sc of ordered) {
    const vendor = db.vendors.find((v) => v.code === sc.vendorCode);
    if (!vendor) throw new Error(`Seed: vendor ${sc.vendorCode} missing`);
    const po = sc.poNumber ? db.sapPurchaseOrders.find((p) => p.poNumber === sc.poNumber) : undefined;
    if (sc.poNumber && !po) throw new Error(`Seed: PO ${sc.poNumber} missing for ${sc.key}`);
    if (po) {
      po.openAmount = (openAtStart.get(po.poNumber) ?? po.openAmount) - (consumed.get(po.poNumber) ?? 0);
      consumed.set(po.poNumber, (consumed.get(po.poNumber) ?? 0) + acceptedFor(sc));
    }
    const currency = sc.currency ?? 'IDR';
    const total = sc.total ?? sc.subtotal + sc.taxAmount;
    const receivedAt = sc.receivedAt;
    const correlationId = ids.correlation();
    const amountIdr = currency === 'IDR' ? total : Math.round(total * COMPANY.usdIdrRate);

    const invoice: Invoice = {
      id: ids.invoice(),
      invoiceNumber: sc.invoiceNumber,
      vendorCode: sc.vendorCode,
      vendorName: vendor.name,
      categoryId: sc.categoryId,
      invoiceDate: sc.invoiceDate,
      receivedAt,
      amount: total,
      subtotal: sc.subtotal,
      taxAmount: sc.taxAmount,
      currency,
      amountIdr,
      exchangeRate: currency === 'IDR' ? undefined : COMPANY.usdIdrRate,
      poNumber: sc.poNumber,
      companyCode: COMPANY.code,
      servicePeriodFrom: sc.servicePeriod?.[0],
      servicePeriodTo: sc.servicePeriod?.[1],
      facts: sc.facts,
      source: sc.source,
      stage: 'RECEIVED',
      lifecycle: 'DRAFT',
      processingFlag: null,
      slaDueAt: '',
      slaBreached: false,
      assignedTo: sc.assignTo,
      priority: sc.priority ?? (amountIdr >= 1_000_000_000 ? 'HIGH' : 'NORMAL'),
      configVersionId: 'cfg-1',
      correlationId,
      description: sc.description,
      // Tax Team reviews withholding tax (PPh 23 / PPh 4(2)) on domestic services.
      taxReviewRequired: sc.taxReviewRequired ?? ['cat-service', 'cat-manpower', 'cat-catering'].includes(sc.categoryId),
      createdAt: receivedAt,
      updatedAt: receivedAt,
    };
    db.invoices.push(invoice);

    sc.lines.forEach((l, idx) => {
      db.invoiceLines.push({
        id: ids.generic('LIN'), invoiceId: invoice.id, lineNo: idx + 1,
        description: l.description, quantity: l.quantity, uom: l.uom, unitPrice: l.unitPrice, amount: l.amount,
        poItem: l.poItem, taxCode: currency === 'USD' ? 'V0' : sc.categoryId === 'cat-catering' ? 'PB1' : 'V11',
      });
    });

    for (const f of sc.docs) {
      const catDoc = db.categoryDocuments.find(
        (cd) => cd.configVersionId === 'cfg-1' && cd.categoryId === sc.categoryId && cd.documentTypeId === f.documentTypeId
      );
      const sp = SharePointMock.storeDocument(invoice.invoiceNumber, f.fileName);
      db.invoiceDocuments.push({
        id: ids.generic('DOC'),
        invoiceId: invoice.id,
        documentTypeId: f.documentTypeId,
        fileName: f.fileName,
        pages: f.pages,
        sizeKb: f.sizeKb ?? 140 + ((f.pages * 137) % 800),
        mimeType: f.fileName.endsWith('.xls') ? 'application/vnd.ms-excel' : 'application/pdf',
        source: invoice.source,
        sharePointUrl: sp.url,
        checksum: sp.checksum,
        status: 'AVAILABLE',
        extractionStatus: 'PENDING',
        requirementType: catDoc?.requirementType ?? 'OPTIONAL',
        checkMode: catDoc?.checkMode ?? 'AVAILABILITY_ONLY',
        version: 1,
        uploadedBy: invoice.source === 'MANUAL_UPLOAD' ? 'Putri Anggraini' : 'AP Automation Engine',
        uploadedAt: receivedAt,
      });
    }

    addTimeline(invoice.id, 'INVOICE_RECEIVED', `Invoice received via ${invoice.source === 'EMAIL' ? 'AP mailbox' : invoice.source === 'SHAREPOINT' ? 'SharePoint monitor' : 'manual portal upload'}`, {
      at: receivedAt, detail: `${sc.docs.length} document(s) · correlation ${correlationId}`, status: 'SUCCESS', correlationId,
    });

    if (sc.target === 'RECEIVED') {
      invoice.stage = 'CLASSIFICATION';
      continue;
    }

    addTimeline(invoice.id, 'DOCUMENT_CLASSIFIED', 'Documents classified', {
      at: plusDays(receivedAt, 0.02),
      detail: `Category resolved: ${db.categories.find((c) => c.id === sc.categoryId)?.name}`,
      status: 'SUCCESS', correlationId,
    });

    const complete = runCompleteness(invoice);
    if (sc.target === 'MISSING_DOCS' || !complete) {
      if (sc.target !== 'MISSING_DOCS') throw new Error(`Seed: ${sc.key} is missing a mandatory document but is not a MISSING_DOCS scenario`);
      // Extract what IS available so field values and SAP mapping are visible
      // while the missing document is chased.
      const stage = invoice.stage;
      const flag = invoice.processingFlag;
      runExtraction(invoice, { degradeFieldCodes: sc.degradeFields });
      invoice.stage = stage;
      invoice.processingFlag = flag;
      workException(db, invoice, sc);
      continue;
    }

    runExtraction(invoice, { degradeFieldCodes: sc.degradeFields });
    if (sc.target === 'EXTRACTION_REVIEW') {
      if (invoice.stage !== 'EXTRACTION_REVIEW') throw new Error(`Seed: ${sc.key} did not land in extraction review`);
      workException(db, invoice, sc);
      continue;
    }
    if (invoice.stage === 'EXTRACTION_REVIEW') throw new Error(`Seed: ${sc.key} unexpectedly needs extraction review`);

    const run = runValidation(invoice, 'PIPELINE');
    if (sc.target === 'VALIDATION_FAILED') {
      if (run.outcome !== 'FAIL') throw new Error(`Seed: ${sc.key} was expected to fail validation but ${run.outcome}`);
      workException(db, invoice, sc);
      continue;
    }
    if (run.outcome !== 'PASS') throw new Error(`Seed: ${sc.key} was expected to pass validation but ${run.outcome} — ${db.validationResults.filter((r) => r.runId === run.id && r.result !== 'PASS').map((r) => `${r.ruleCode}: ${r.message}`).join('; ')}`);

    startWorkflow(invoice);
    const instance = db.workflowInstances.find((w) => w.invoiceId === invoice.id)!;
    const steps = () => db.workflowSteps.filter((s) => s.instanceId === instance.id).sort((a, b) => a.stepNo - b.stepNo);
    const userFor = (id: string) => db.users.find((u) => u.id === id)!;
    const approvedAt = sc.dates?.approved ? at(sc.dates.approved, '10:30') : plusDays(receivedAt, 2, '10:30');

    const approveActive = (comment: string, when: string) => {
      const active = steps().find((s) => s.status === 'ACTIVE');
      if (!active) return false;
      const approver = active.assignedTo ? userFor(active.assignedTo) : userFor('u-arjun');
      actOnStep(invoice, active, approver, 'APPROVE', comment);
      active.actedAt = clamp(when);
      return true;
    };

    if (sc.target === 'APPROVAL_STEP_1') continue;
    if (sc.target === 'APPROVAL_STEP_2') { approveActive('AP review completed — documents and validation in order.', sc.dates?.approved ? at(sc.dates.approved, '11:00') : plusDays(receivedAt, 1, '11:00')); continue; }
    if (sc.target === 'TAX_REVIEW') {
      const comments = ['AP review completed.', 'Service completion confirmed against SES.', 'Approved within DoA.'];
      for (let n = 0; invoice.stage !== 'TAX_REVIEW' && n < comments.length; n++) {
        if (!approveActive(comments[n], plusDays(receivedAt, n + 1, n === 0 ? '11:00' : '15:20'))) break;
      }
      if (invoice.stage !== 'TAX_REVIEW') throw new Error(`Seed: ${sc.key} did not reach tax review (stage ${invoice.stage})`);
      continue;
    }
    if (sc.target === 'REJECTED') {
      approveActive('AP review completed.', plusDays(receivedAt, 1, '11:00'));
      const active = steps().find((s) => s.status === 'ACTIVE');
      if (active) {
        const approver = active.assignedTo ? userFor(active.assignedTo) : userFor('u-arjun');
        actOnStep(invoice, active, approver, 'REJECT', sc.rejectReason ?? 'Rejected.');
        active.actedAt = clamp(sc.dates?.rejected ? at(sc.dates.rejected, '14:10') : plusDays(receivedAt, 3, '14:10'));
      }
      workException(db, invoice, sc);
      continue;
    }

    // Advanced targets: complete the workflow deterministically on the recorded
    // dates, with the same audit record a live approval writes.
    for (const s of steps()) {
      if (s.status === 'ACTIVE' || s.status === 'PENDING') {
        s.status = 'APPROVED';
        s.actedBy = s.assignedTo ?? 'u-arjun';
        s.actedByName = s.assignedToName ?? 'Arif Wibowo';
        s.actedAt = clamp(plusDays(approvedAt, (s.stepNo - 1) * 0.15));
        s.comment = 'Approved.';
        s.channel = s.stepNo % 2 === 0 ? 'TEAMS' : 'PORTAL';
        const actor = userFor(s.actedBy);
        audit({
          eventTime: s.actedAt, actorType: 'USER', actorId: actor.id, actorName: actor.name, actorRole: actor.title,
          category: 'APPROVAL', module: 'workflow', entityType: 'WORKFLOW', entityId: s.id, entityRef: invoice.invoiceNumber, invoiceId: invoice.id,
          correlationId, source: s.channel === 'TEAMS' ? 'TEAMS' : 'PORTAL', eventType: 'APPROVAL_APPROVED', action: 'APPROVE', result: 'SUCCESS', reason: `${s.name} approved`,
        });
        addTimeline(invoice.id, 'APPROVAL_COMPLETED', `${s.name} approved`, { at: s.actedAt, actorType: 'USER', actorName: actor.name, detail: 'Approved.', status: 'SUCCESS', correlationId });
      }
    }
    instance.status = 'COMPLETED';
    instance.completedAt = steps().reduce((latest, s) => (s.actedAt && s.actedAt > latest ? s.actedAt : latest), clamp(approvedAt));
    invoice.lifecycle = 'VALIDATED';
    invoice.processingFlag = null;
    invoice.stage = 'SAP_HANDOFF';
    addTimeline(invoice.id, 'WORKFLOW_COMPLETED', 'All approvals completed', {
      at: instance.completedAt, detail: 'Invoice validated - queued for SAP handoff', status: 'SUCCESS', correlationId,
    });

    if (sc.target === 'VALIDATED_QUEUED') {
      invoice.processingFlag = 'SAP_PENDING';
      db.sapHandoffs.unshift({
        id: ids.handoff(), invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
        idempotencyKey: `${invoice.id}:${correlationId}`, status: 'QUEUED', attempts: 2,
        createdAt: instance.completedAt!, lastAttemptAt: clamp(plusDays(instance.completedAt!, 0.25)),
        message: 'SAP interface degraded - handoff queued for retry', errorCode: 'SAP_RFC_BUSY',
        correlationId, payloadSummary: { invoiceNumber: invoice.invoiceNumber, amount: invoice.amount, vendorCode: invoice.vendorCode },
      });
      addTimeline(invoice.id, 'SAP_HANDOFF_REQUESTED', 'SAP handoff queued (interface degraded)', {
        at: clamp(plusDays(instance.completedAt!, 0.25)), detail: 'Retrying with backoff - invoice remains safely queued', status: 'WARNING', correlationId,
      });
      continue;
    }

    // ACK + beyond. SAP document numbers run in arrival order through the MIRO
    // series printed on the Emerson LD e-mail: invoice 6581888 is 5105605935.
    const sapDoc = sc.sapDocumentNo ?? String(5105605914 + db.sapHandoffs.length * 3);
    if (sc.sapDocumentNo && db.sapHandoffs.some((h) => h.sapDocumentNo === sc.sapDocumentNo)) throw new Error(`Seed: SAP document ${sc.sapDocumentNo} already used`);
    const ackAt = clamp(sc.dates?.acknowledged ? at(sc.dates.acknowledged, '08:40') : plusDays(approvedAt, 1, '08:40'));
    const statusMap: Record<string, InvoiceLifecycle> = { IN_PROGRESS: 'IN_PROGRESS', PARKED: 'PARKED', POSTED: 'POSTED', PAID: 'PAID' };
    const lifecycle = statusMap[sc.target] ?? 'IN_PROGRESS';
    db.sapHandoffs.unshift({
      id: ids.handoff(), invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
      idempotencyKey: `${invoice.id}:${correlationId}`,
      status: lifecycle === 'IN_PROGRESS' ? 'ACKNOWLEDGED' : lifecycle === 'PARKED' ? 'PARKED' : 'POSTED',
      attempts: 1, createdAt: instance.completedAt!, lastAttemptAt: ackAt, acknowledgedAt: ackAt,
      sapDocumentNo: sapDoc, sapFiscalYear: sc.invoiceDate.slice(0, 4), message: 'Handoff accepted for processing',
      correlationId, payloadSummary: { invoiceNumber: invoice.invoiceNumber, amount: invoice.amount, vendorCode: invoice.vendorCode },
    });
    invoice.sapDocumentNo = sapDoc;
    invoice.sapFiscalYear = sc.invoiceDate.slice(0, 4);
    invoice.lifecycle = lifecycle;
    invoice.stage = lifecycle === 'IN_PROGRESS' || lifecycle === 'PARKED' ? 'SAP_PROCESSING' : 'COMPLETED';
    addTimeline(invoice.id, 'SAP_ACKNOWLEDGED', 'SAP acknowledged handoff', {
      at: ackAt, detail: `SAP document ${sapDoc}/${invoice.sapFiscalYear}`, status: 'SUCCESS', reference: sapDoc, correlationId,
    });
    const sapAudit = (eventTime: string, eventType: string, newValue: Record<string, unknown>) => systemAudit({
      eventTime, eventType, category: 'SAP', action: 'STATUS_SYNC', entityType: 'INVOICE', entityId: invoice.id, entityRef: invoice.invoiceNumber,
      invoiceId: invoice.id, newValue, correlationId, module: 'sap-integration',
    });
    sapAudit(ackAt, 'EXTERNAL_STATUS_UPDATED', { lifecycle: 'IN_PROGRESS', sapDocumentNo: sapDoc });
    if (lifecycle === 'PARKED') {
      const parkedAt = clamp(sc.dates?.parked ? at(sc.dates.parked, '09:30') : plusDays(ackAt, 1, '09:30'));
      addTimeline(invoice.id, 'SAP_PARKED', `Invoice parked in SAP (${invoice.poNumber ? 'MIRO' : 'FB60'})`, { at: parkedAt, detail: `SAP document ${sapDoc}`, status: 'SUCCESS', correlationId });
      sapAudit(parkedAt, 'PARKED', { lifecycle: 'PARKED', sapDocumentNo: sapDoc });
    }
    if (lifecycle === 'POSTED' || lifecycle === 'PAID') {
      const postedAt = clamp(sc.dates?.posted ? at(sc.dates.posted, '09:30') : plusDays(ackAt, 2, '09:30'));
      addTimeline(invoice.id, 'SAP_POSTED', 'Invoice posted in SAP', { at: postedAt, detail: `SAP document ${sapDoc}`, status: 'SUCCESS', correlationId });
      sapAudit(postedAt, 'POSTED', { lifecycle: 'POSTED', sapDocumentNo: sapDoc });
    }
    if (lifecycle === 'PAID') {
      const paidAt = clamp(sc.dates?.paid ? at(sc.dates.paid, '15:00') : plusDays(ackAt, 30, '15:00'));
      invoice.paymentStatus = 'PAID';
      invoice.paymentDate = paidAt.slice(0, 10);
      invoice.paymentRef = `PAY-${sapDoc}`;
      addTimeline(invoice.id, 'PAYMENT_SYNCED', 'Payment cleared in SAP', { at: paidAt, detail: `Payment reference PAY-${sapDoc} · ${vendor.bankName}`, status: 'SUCCESS', correlationId });
      sapAudit(paidAt, 'PAID', { paymentStatus: 'PAID', paymentRef: `PAY-${sapDoc}`, paymentDate: paidAt.slice(0, 10) });
    } else {
      invoice.paymentStatus = 'NOT_DUE';
    }
  }
  markDirty();

  for (const po of db.sapPurchaseOrders) po.openAmount = balanceToday.get(po.poNumber) ?? po.openAmount;
}

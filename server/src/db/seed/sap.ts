import type {
  SapGrn,
  SapPurchaseOrder,
  SapSes,
  VendorPortalControl,
  VendorSnapshot,
} from '../../core/types';
import { isoAgo, HOUR } from '../../core/ids';

const v = (
  code: string, name: string, city: string, state: string, gstinPrefix: string,
  classification: string, extra: Partial<VendorSnapshot> = {}
): VendorSnapshot => ({
  code,
  name,
  legalName: extra.legalName ?? `${name} Private Limited`,
  address: extra.address ?? 'Plot 14, MIDC Industrial Area',
  city,
  state,
  country: 'India',
  gstin: `${gstinPrefix}${code.replace(/\D/g, '').padStart(5, '0')}F1Z${code.charCodeAt(code.length - 1) % 10}`,
  pan: `AABC${code.slice(-1)}${String(1000 + Number(code.replace(/\D/g, '')) % 9000)}K`,
  bankAccountMasked: `XXXX XXXX ${String(2000 + Number(code.replace(/\D/g, '')) % 8000)}`,
  bankName: extra.bankName ?? 'State Bank of India',
  paymentTerms: extra.paymentTerms ?? 'Net 45',
  currency: 'INR',
  companyCodes: ['1000'],
  classification,
  sapStatus: extra.sapStatus ?? 'ACTIVE',
  lastSyncAt: isoAgo(3 * HOUR),
  sapRef: `LFA1/${code}`,
  email: extra.email ?? `accounts@${name.toLowerCase().replace(/[^a-z]+/g, '')}.co.in`,
  phone: extra.phone ?? '+91 22 4000 1200',
});

export const VENDORS: VendorSnapshot[] = [
  v('V100012', 'Bharat Industrial Supplies', 'Pune', 'Maharashtra', '27AABCB', 'Material'),
  v('V100034', 'Sterling Pipes & Fittings', 'Ahmedabad', 'Gujarat', '24AABCS', 'Material'),
  v('V100048', 'Kirloskar Valves Trading', 'Pune', 'Maharashtra', '27AABCK', 'Material'),
  v('V100077', 'Hindustan Electricals', 'Mumbai', 'Maharashtra', '27AABCH', 'Material'),
  v('V200015', 'TechServ Engineering Services', 'Navi Mumbai', 'Maharashtra', '27AABCT', 'Services'),
  v('V200023', 'Apex Instrumentation Works', 'Vadodara', 'Gujarat', '24AABCA', 'Services'),
  v('V200031', 'Meridian Inspection Services', 'Chennai', 'Tamil Nadu', '33AABCM', 'Services'),
  v('V300019', 'SecureForce Manpower Solutions', 'Mumbai', 'Maharashtra', '27AABCS', 'Manpower', { paymentTerms: 'Net 30' }),
  v('V300027', 'Prime Facility Staffing', 'Thane', 'Maharashtra', '27AABCP', 'Manpower', { paymentTerms: 'Net 30' }),
  v('V400011', 'Annapurna Caterers', 'Mumbai', 'Maharashtra', '27AABCA', 'Catering', { paymentTerms: 'Net 15' }),
  v('V400018', 'GreenLeaf Canteen Services', 'Pune', 'Maharashtra', '27AABCG', 'Catering', { paymentTerms: 'Net 15' }),
  v('V500021', 'Swift Logistics & Freight', 'Mumbai', 'Maharashtra', '27AABCW', 'Logistics'),
  v('V500033', 'Om Sai Transport Co', 'Nashik', 'Maharashtra', '27AABCO', 'Logistics'),
  v('V600041', 'Crystal Clean Housekeeping', 'Mumbai', 'Maharashtra', '27AABCC', 'Housekeeping'),
  v('V700052', 'Deccan Office Supplies', 'Hyderabad', 'Telangana', '36AABCD', 'Miscellaneous', { sapStatus: 'BLOCKED' }),
];

export const VENDOR_CONTROLS: VendorPortalControl[] = VENDORS.map((vd) => ({
  vendorCode: vd.code,
  negativeFlag: vd.code === 'V700052',
  apEnabled: vd.code !== 'V500033',
  reason: vd.code === 'V700052' ? 'Repeated billing discrepancies under investigation' : vd.code === 'V500033' ? 'Pending contract renewal' : undefined,
  remarks: vd.code === 'V700052' ? 'Flagged by internal audit 28-Jul-2026' : undefined,
  updatedBy: 'u-meera',
  updatedByName: 'Meera Krishnan',
  updatedAt: isoAgo(14 * 24 * HOUR),
}));

// -------------------- Purchase Orders --------------------
const poItem = (item: string, description: string, qty: number, uom: string, unitPrice: number, grnQty: number, sesQty = 0) => ({
  item, description, quantity: qty, uom, unitPrice,
  amount: Math.round(qty * unitPrice * 100) / 100,
  grnQuantity: grnQty, sesQuantity: sesQty,
  openQuantity: Math.max(0, qty - Math.max(grnQty, sesQty)),
});

export const SAP_POS: SapPurchaseOrder[] = [
  {
    poNumber: '4500019282', vendorCode: 'V100012', vendorName: 'Bharat Industrial Supplies', companyCode: '1000',
    department: 'Operations', currency: 'INR', poType: 'MATERIAL', status: 'OPEN',
    totalAmount: 4_800_000, openAmount: 2_950_000, validFrom: '2026-01-15', validTo: '2026-12-31',
    items: [
      poItem('00010', 'CS Seamless Pipe 6" SCH40', 420, 'M', 6500, 260),
      poItem('00020', 'Gate Valve 6" Class 150', 24, 'EA', 48000, 14),
    ],
  },
  {
    poNumber: '4500019310', vendorCode: 'V100034', vendorName: 'Sterling Pipes & Fittings', companyCode: '1000',
    department: 'Projects', currency: 'INR', poType: 'MATERIAL', status: 'OPEN',
    totalAmount: 2_360_000, openAmount: 1_180_000, validFrom: '2026-03-01', validTo: '2026-12-31',
    items: [poItem('00010', 'SS316 Flanges DN80', 400, 'EA', 5900, 200)],
  },
  {
    poNumber: '4500019355', vendorCode: 'V100048', vendorName: 'Kirloskar Valves Trading', companyCode: '1000',
    department: 'Operations', currency: 'INR', poType: 'MATERIAL', status: 'OPEN',
    totalAmount: 1_920_000, openAmount: 640_000, validFrom: '2026-02-10', validTo: '2026-10-31',
    items: [poItem('00010', 'Ball Valve 4" Trunnion', 32, 'EA', 60000, 22)],
  },
  {
    poNumber: '4500019388', vendorCode: 'V100077', vendorName: 'Hindustan Electricals', companyCode: '1000',
    department: 'Projects', currency: 'INR', poType: 'MATERIAL', status: 'OPEN',
    totalAmount: 3_540_000, openAmount: 3_540_000, validFrom: '2026-05-01', validTo: '2027-04-30',
    items: [poItem('00010', 'LT Power Cable 3.5C x 300sqmm', 6000, 'M', 590, 0)],
  },
  {
    poNumber: '4700008841', vendorCode: 'V200015', vendorName: 'TechServ Engineering Services', companyCode: '1000',
    department: 'Operations', currency: 'INR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 6_000_000, openAmount: 3_100_000, validFrom: '2026-01-01', validTo: '2026-12-31',
    items: [poItem('00010', 'Rotating equipment maintenance services', 12, 'MON', 500000, 0, 6)],
  },
  {
    poNumber: '4700008867', vendorCode: 'V200023', vendorName: 'Apex Instrumentation Works', companyCode: '1000',
    department: 'Projects', currency: 'INR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 2_400_000, openAmount: 1_150_000, validFrom: '2026-02-01', validTo: '2026-11-30',
    items: [poItem('00010', 'Instrument calibration & loop checking', 1200, 'AU', 2000, 0, 620)],
  },
  {
    poNumber: '4700008901', vendorCode: 'V200031', vendorName: 'Meridian Inspection Services', companyCode: '1000',
    department: 'Projects', currency: 'INR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 1_800_000, openAmount: 1_800_000, validFrom: '2026-06-01', validTo: '2027-05-31',
    items: [poItem('00010', 'NDT inspection services', 900, 'AU', 2000, 0, 0)],
  },
  {
    poNumber: '4700009012', vendorCode: 'V300019', vendorName: 'SecureForce Manpower Solutions', companyCode: '1000',
    department: 'Operations', currency: 'INR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 14_400_000, openAmount: 8_350_000, validFrom: '2026-01-01', validTo: '2026-12-31',
    items: [poItem('00010', 'Skilled contract manpower - plant operations', 32000, 'HR', 450, 0, 15200)],
  },
  {
    poNumber: '4700009044', vendorCode: 'V300027', vendorName: 'Prime Facility Staffing', companyCode: '1000',
    department: 'Admin & Facilities', currency: 'INR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 5_760_000, openAmount: 2_910_000, validFrom: '2026-01-01', validTo: '2026-12-31',
    items: [poItem('00010', 'Facility support manpower', 12800, 'HR', 450, 0, 6400)],
  },
  {
    poNumber: '4700009101', vendorCode: 'V400011', vendorName: 'Annapurna Caterers', companyCode: '1000',
    department: 'Admin & Facilities', currency: 'INR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 3_000_000, openAmount: 1_620_000, validFrom: '2026-01-01', validTo: '2026-12-31',
    items: [poItem('00010', 'Industrial canteen services - meals', 20000, 'EA', 150, 0, 9200)],
  },
  {
    poNumber: '4700009133', vendorCode: 'V400018', vendorName: 'GreenLeaf Canteen Services', companyCode: '1000',
    department: 'Admin & Facilities', currency: 'INR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 1_440_000, openAmount: 940_000, validFrom: '2026-01-01', validTo: '2026-12-31',
    items: [poItem('00010', 'Night-shift canteen services', 9600, 'EA', 150, 0, 3300)],
  },
  {
    poNumber: '4700009170', vendorCode: 'V600041', vendorName: 'Crystal Clean Housekeeping', companyCode: '1000',
    department: 'Admin & Facilities', currency: 'INR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 2_160_000, openAmount: 1_080_000, validFrom: '2026-01-01', validTo: '2026-12-31',
    items: [poItem('00010', 'Housekeeping services - admin block', 12, 'MON', 180000, 0, 6)],
  },
];

// GRNs / SES are generated per-invoice in the invoice seed so 3-way values
// reconcile (or intentionally mismatch) per scenario. These are baseline
// documents for reference browsing.
export const SAP_GRNS: SapGrn[] = [];
export const SAP_SES: SapSes[] = [];

import type {
  SapGrn,
  SapPurchaseOrder,
  SapSes,
  VendorPortalControl,
  VendorSnapshot,
} from '../../core/types';
import { isoAgo, HOUR } from '../../core/ids';

/**
 * Vendor master snapshot from SAP.
 *
 * The platform runs for PT ESSA Industries Indonesia Tbk (BPD v0.1.4 §1), so
 * the vendor master is Indonesian: NPWP tax numbers, Indonesian banks, .co.id
 * contacts and the company codes ESM / EIA / PAU. The demo data has to match
 * the requirements it demonstrates (review, 24 Aug).
 */
const BANKS = ['Bank Mandiri', 'Bank Central Asia', 'Bank Negara Indonesia', 'Bank Rakyat Indonesia'];

/** NPWP: 12.345.678.9-012.000 — derived from the vendor code so it stays stable. */
const npwp = (code: string): string => {
  const n = Number(code.replace(/\D/g, ''));
  const p = (value: number, len: number) => String(value).padStart(len, '0').slice(-len);
  return `${p(10 + (n % 89), 2)}.${p(100 + (n % 899), 3)}.${p(100 + ((n * 7) % 899), 3)}.${(n % 9) + 1}-${p(100 + ((n * 3) % 899), 3)}.000`;
};

const v = (
  code: string, name: string, city: string, province: string, addressLine: string,
  classification: string, extra: Partial<VendorSnapshot> = {}
): VendorSnapshot => {
  const digits = Number(code.replace(/\D/g, ''));
  const slug = name.replace(/^PT\s+/i, '').toLowerCase().replace(/[^a-z]+/g, '');
  return {
    code,
    name,
    legalName: extra.legalName ?? name,
    address: addressLine,
    city,
    state: province,
    country: 'Indonesia',
    // The vendor tax number; for Indonesia that is the NPWP.
    gstin: npwp(code),
    pan: '',
    bankAccountMasked: `XXXX XXXX ${String(2000 + (digits % 8000))}`,
    bankName: extra.bankName ?? BANKS[digits % BANKS.length],
    paymentTerms: extra.paymentTerms ?? 'Net 45',
    currency: 'IDR',
    companyCodes: ['ESM', 'EIA', 'PAU'],
    classification,
    sapStatus: extra.sapStatus ?? 'ACTIVE',
    lastSyncAt: isoAgo(3 * HOUR),
    sapRef: `LFA1/${code}`,
    email: extra.email ?? `accounts@${slug}.co.id`,
    phone: extra.phone ?? (city === 'Luwuk' ? '+62 461 21 4400' : '+62 21 5000 1200'),
  };
};

export const VENDORS: VendorSnapshot[] = [
  v('V100012', 'PT Nusantara Industrial Supplies', 'Jakarta', 'DKI Jakarta', 'Jl. Gatot Subroto Kav. 21', 'Material'),
  v('V100034', 'PT Sterling Pipa Nusantara', 'Surabaya', 'Jawa Timur', 'Kawasan Industri Rungkut Blok C-14', 'Material'),
  v('V100048', 'PT Katulistiwa Valve Trading', 'Jakarta', 'DKI Jakarta', 'Jl. Raya Cakung Cilincing KM 3', 'Material'),
  v('V100077', 'PT Cahaya Elektrindo', 'Bekasi', 'Jawa Barat', 'Kawasan Industri MM2100 Blok F-8', 'Material'),
  v('V200015', 'PT TeknoServis Rekayasa', 'Balikpapan', 'Kalimantan Timur', 'Jl. Mulawarman No. 88', 'Services'),
  v('V200023', 'PT Apex Instrumentasi', 'Surabaya', 'Jawa Timur', 'Jl. Margomulyo Industri No. 42', 'Services'),
  v('V200031', 'PT Meridian Inspeksi Nusantara', 'Makassar', 'Sulawesi Selatan', 'Jl. Perintis Kemerdekaan KM 12', 'Services'),
  v('V300019', 'PT Karya Tenaga Mandiri', 'Luwuk', 'Sulawesi Tengah', 'Jl. Yos Sudarso No. 17', 'Manpower', { paymentTerms: 'Net 30' }),
  v('V300027', 'PT Prima Fasilitas Sulawesi', 'Luwuk', 'Sulawesi Tengah', 'Jl. Ahmad Yani No. 45', 'Manpower', { paymentTerms: 'Net 30' }),
  v('V400011', 'PT Boga Rasa Katering', 'Luwuk', 'Sulawesi Tengah', 'Jl. Urip Sumoharjo No. 9', 'Catering', { paymentTerms: 'Net 15' }),
  v('V400018', 'PT Daun Hijau Kantin', 'Palu', 'Sulawesi Tengah', 'Jl. Basuki Rahmat No. 33', 'Catering', { paymentTerms: 'Net 15' }),
  v('V500021', 'PT Cepat Logistik Nusantara', 'Jakarta', 'DKI Jakarta', 'Jl. Raya Bandara Soekarno-Hatta No. 5', 'Logistics'),
  v('V500033', 'PT Sinar Trans Luwuk', 'Luwuk', 'Sulawesi Tengah', 'Jl. Trans Sulawesi KM 6', 'Logistics'),
  v('V600041', 'PT Bersih Kristal Servis', 'Luwuk', 'Sulawesi Tengah', 'Jl. Imam Bonjol No. 12', 'Housekeeping'),
  v('V700052', 'PT Sentosa Office Supplies', 'Jakarta', 'DKI Jakarta', 'Jl. Kebon Sirih No. 60', 'Miscellaneous', { sapStatus: 'BLOCKED' }),
];

export const VENDOR_CONTROLS: VendorPortalControl[] = VENDORS.map((vd) => ({
  vendorCode: vd.code,
  negativeFlag: vd.code === 'V700052',
  apEnabled: vd.code !== 'V500033',
  reason: vd.code === 'V700052' ? 'Repeated billing discrepancies under investigation' : vd.code === 'V500033' ? 'Pending contract renewal' : undefined,
  remarks: vd.code === 'V700052' ? 'Flagged by internal audit 28-Jul-2026' : undefined,
  updatedBy: 'u-meera',
  updatedByName: 'Maya Puspita',
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
    poNumber: '4500019282', vendorCode: 'V100012', vendorName: 'PT Nusantara Industrial Supplies', companyCode: 'PAU', currency: 'IDR', poType: 'MATERIAL', status: 'OPEN',
    totalAmount: 4_800_000, openAmount: 2_950_000, validFrom: '2026-01-15', validTo: '2026-12-31',
    items: [
      poItem('00010', 'CS Seamless Pipe 6" SCH40', 420, 'M', 6500, 260),
      poItem('00020', 'Gate Valve 6" Class 150', 24, 'EA', 48000, 14),
    ],
  },
  {
    poNumber: '4500019310', vendorCode: 'V100034', vendorName: 'PT Sterling Pipa Nusantara', companyCode: 'PAU', currency: 'IDR', poType: 'MATERIAL', status: 'OPEN',
    totalAmount: 2_360_000, openAmount: 1_180_000, validFrom: '2026-03-01', validTo: '2026-12-31',
    items: [poItem('00010', 'SS316 Flanges DN80', 400, 'EA', 5900, 200)],
  },
  {
    poNumber: '4500019355', vendorCode: 'V100048', vendorName: 'PT Katulistiwa Valve Trading', companyCode: 'PAU', currency: 'IDR', poType: 'MATERIAL', status: 'OPEN',
    totalAmount: 1_920_000, openAmount: 640_000, validFrom: '2026-02-10', validTo: '2026-10-31',
    items: [poItem('00010', 'Ball Valve 4" Trunnion', 32, 'EA', 60000, 22)],
  },
  {
    poNumber: '4500019388', vendorCode: 'V100077', vendorName: 'PT Cahaya Elektrindo', companyCode: 'PAU', currency: 'IDR', poType: 'MATERIAL', status: 'OPEN',
    totalAmount: 3_540_000, openAmount: 3_540_000, validFrom: '2026-05-01', validTo: '2027-04-30',
    items: [poItem('00010', 'LT Power Cable 3.5C x 300sqmm', 6000, 'M', 590, 0)],
  },
  {
    poNumber: '4700008841', vendorCode: 'V200015', vendorName: 'PT TeknoServis Rekayasa', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 6_000_000, openAmount: 3_100_000, validFrom: '2026-01-01', validTo: '2026-12-31',
    items: [poItem('00010', 'Rotating equipment maintenance services', 12, 'MON', 500000, 0, 6)],
  },
  {
    poNumber: '4700008867', vendorCode: 'V200023', vendorName: 'PT Apex Instrumentasi', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 2_400_000, openAmount: 1_150_000, validFrom: '2026-02-01', validTo: '2026-11-30',
    items: [poItem('00010', 'Instrument calibration & loop checking', 1200, 'AU', 2000, 0, 620)],
  },
  {
    poNumber: '4700008901', vendorCode: 'V200031', vendorName: 'PT Meridian Inspeksi Nusantara', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 1_800_000, openAmount: 1_800_000, validFrom: '2026-06-01', validTo: '2027-05-31',
    items: [poItem('00010', 'NDT inspection services', 900, 'AU', 2000, 0, 0)],
  },
  {
    poNumber: '4700009012', vendorCode: 'V300019', vendorName: 'PT Karya Tenaga Mandiri', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 14_400_000, openAmount: 8_350_000, validFrom: '2026-01-01', validTo: '2026-12-31',
    items: [poItem('00010', 'Skilled contract manpower - plant operations', 32000, 'HR', 450, 0, 15200)],
  },
  {
    poNumber: '4700009044', vendorCode: 'V300027', vendorName: 'PT Prima Fasilitas Sulawesi', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 5_760_000, openAmount: 2_910_000, validFrom: '2026-01-01', validTo: '2026-12-31',
    items: [poItem('00010', 'Facility support manpower', 12800, 'HR', 450, 0, 6400)],
  },
  {
    poNumber: '4700009101', vendorCode: 'V400011', vendorName: 'PT Boga Rasa Katering', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 3_000_000, openAmount: 1_620_000, validFrom: '2026-01-01', validTo: '2026-12-31',
    items: [poItem('00010', 'Industrial canteen services - meals', 20000, 'EA', 150, 0, 9200)],
  },
  {
    poNumber: '4700009133', vendorCode: 'V400018', vendorName: 'PT Daun Hijau Kantin', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 1_440_000, openAmount: 940_000, validFrom: '2026-01-01', validTo: '2026-12-31',
    items: [poItem('00010', 'Night-shift canteen services', 9600, 'EA', 150, 0, 3300)],
  },
  {
    poNumber: '4700009170', vendorCode: 'V600041', vendorName: 'PT Bersih Kristal Servis', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 2_160_000, openAmount: 1_080_000, validFrom: '2026-01-01', validTo: '2026-12-31',
    items: [poItem('00010', 'Housekeeping services - admin block', 12, 'MON', 180000, 0, 6)],
  },
];

// GRNs / SES are generated per-invoice in the invoice seed so 3-way values
// reconcile (or intentionally mismatch) per scenario. These are baseline
// documents for reference browsing.
export const SAP_GRNS: SapGrn[] = [];
export const SAP_SES: SapSes[] = [];

/**
 * SAP reference data — vendor master, purchase orders, goods receipts and
 * service entry sheets.
 *
 * Everything here is taken from the PT Panca Amara Utama (PAU) sample bundles
 * in "Sample data" (review, 25 Aug): the vendors, PO numbers, PO values and
 * line structure, SES / GRN numbers and values are the ones printed on the
 * documents. Where the demo needs records the bundles do not contain (the
 * follow-on claims of the same contracts), they are derived from the same
 * contract rates so every figure reconciles exactly — see seed/invoices.ts.
 *
 * Buyer: PT Panca Amara Utama, company code PAU, NPWP 0021612924011000,
 * Banggai Ammonia Plant [BAP], Jl. Poros Sulawesi, Desa Uso, Batui 94762.
 */
import type {
  SapGrn,
  SapPurchaseOrder,
  SapSes,
  VendorPortalControl,
  VendorSnapshot,
} from '../../core/types';
import { isoAgo, HOUR } from '../../core/ids';

export const COMPANY = {
  code: 'PAU',
  name: 'PT Panca Amara Utama',
  npwp: '0021612924011000',
  site: 'Banggai Ammonia Plant [BAP]',
  siteAddress: 'Jl. Poros Sulawesi, Desa Uso, Kecamatan Batui 94762, Sulawesi Tengah',
  headOffice: 'Gd. DBS Bank Tower Lt. 18, Ciputra World 1, Jl. Prof. Dr. Satrio Kav. 3-5, Jakarta 12940',
  /** Customs (NDPBM) exchange rate printed on the PIB for the Emerson import. */
  usdIdrRate: 16_800,
} as const;

// ------------------------------------------------------------- vendors
const vendor = (
  code: string, name: string, fields: Partial<VendorSnapshot> & Pick<VendorSnapshot, 'address' | 'city' | 'state' | 'classification' | 'paymentTerms' | 'bankName' | 'bankAccountMasked'>
): VendorSnapshot => ({
  code,
  name,
  legalName: fields.legalName ?? name,
  address: fields.address,
  city: fields.city,
  state: fields.state,
  country: fields.country ?? 'Indonesia',
  // Vendor tax number: the NPWP as printed on the e-Faktur (16-digit form).
  gstin: fields.gstin ?? '',
  pan: '',
  bankAccountMasked: fields.bankAccountMasked,
  bankName: fields.bankName,
  paymentTerms: fields.paymentTerms,
  currency: fields.currency ?? 'IDR',
  companyCodes: ['PAU'],
  classification: fields.classification,
  sapStatus: 'ACTIVE',
  lastSyncAt: isoAgo(3 * HOUR),
  sapRef: `LFA1/${code}`,
  email: fields.email ?? '',
  phone: fields.phone ?? '',
});

export const VENDORS: VendorSnapshot[] = [
  // PO 4203000546 — vendor code as printed on the PO.
  vendor('30000956', 'PT Amanah Lestari Energy', {
    address: 'Desa Padang, Kec. Kintom, Kab. Banggai 94761', city: 'Banggai', state: 'Sulawesi Tengah',
    gstin: '0822126702832000', classification: 'Manpower Services',
    paymentTerms: 'Due in 30 days from invoice receipt', bankName: 'Bank Mandiri (Persero) Tbk — Cabang Luwuk', bankAccountMasked: 'XXX-XX-XXXX369-5',
    email: 'amanahlestarienergy@gmail.com', phone: '+62 822 9376 2226',
  }),
  vendor('30000731', 'PT Berca Buana Sakti', {
    address: 'Jl. RC Veteran No. 4, Bintaro, PO BOX 6243 KBYB', city: 'Jakarta Selatan', state: 'DKI Jakarta',
    gstin: '0010002210059000', classification: 'Civil Contractor',
    paymentTerms: 'Progress claims per contract 0032/AG/PAU-EXT/2025 (15% advance, 10% retention)', bankName: 'Bank Rakyat Indonesia', bankAccountMasked: 'XXXXXXXXXX6303',
    email: 'bbs.bintaro@berca.co.id', phone: '+62 21 736 1979',
  }),
  // PO 4202000128 — vendor code as printed on the PO. Import vendor, USD.
  vendor('40000143', 'Emerson Asia Pacific Private Limited', {
    address: 'No. 1 Pandan Crescent', city: 'Singapore', state: 'Singapore', country: 'Singapore',
    gstin: 'GST M2-0007012-7', classification: 'Import — Valves & Instrumentation', currency: 'USD',
    paymentTerms: 'NET45 — 45 days from goods dispatch (T/T)', bankName: 'Citibank N.A. Singapore', bankAccountMasked: 'X-XXXXXX-039 (USD)',
    email: 'joycevenice.canonce@emerson.com', phone: '+65 6777 8211',
  }),
  vendor('30000512', 'PT Baasithu Boga Services', {
    address: 'Jl. Raya Bogor KM 21, Rambutan, Ciracas', city: 'Jakarta Timur', state: 'DKI Jakarta',
    gstin: '0029022191009000', classification: 'Catering & Camp Services',
    paymentTerms: 'Due in 30 days from invoice receipt', bankName: 'Bank Mandiri (Persero) Tbk', bankAccountMasked: 'XXX-XX-XXXX512-0',
    email: 'finance@baasithu.co.id', phone: '+62 21 8770 4512',
  }),
  vendor('30000318', 'PT Wisata Kawan Abadi', {
    address: 'Ruko Riviera Plaza Blok RB 07 No. 15A, Jl. Kelapa Hibrida Timur, Kelapa Gading', city: 'Jakarta Utara', state: 'DKI Jakarta',
    gstin: '0963235684043000', classification: 'Travel Agent (Non-PO)',
    paymentTerms: 'Due 15 days from invoice date', bankName: 'Bank Central Asia — Cabang Kartini', bankAccountMasked: 'XXXXXX7999',
    email: 'billing@wisatakawan.co.id', phone: '+62 21 4585 0318',
  }),
];

/** No vendor is negative-listed or disabled in the sample data. */
/** When each vendor was enabled for AP automation (matches the vendor control history in seed/index.ts). */
const ONBOARDED_AT: Record<string, string> = {
  '30000956': '2025-07-01T02:15:00.000Z', '30000731': '2025-09-08T03:40:00.000Z', '30000512': '2025-10-13T02:05:00.000Z',
  '40000143': '2026-01-19T04:30:00.000Z', '30000318': '2026-02-02T02:50:00.000Z',
};
export const VENDOR_CONTROLS: VendorPortalControl[] = VENDORS.map((vd) => ({
  vendorCode: vd.code,
  negativeFlag: false,
  apEnabled: true,
  updatedBy: 'u-suresh',
  updatedByName: 'Surya Nugraha',
  updatedAt: ONBOARDED_AT[vd.code] ?? isoAgo(60 * 24 * HOUR),
}));

// ------------------------------------------------------ purchase orders
type Item = SapPurchaseOrder['items'][number];
const line = (item: string, description: string, quantity: number, uom: string, unitPrice: number, consumed = 0): Item => ({
  item, description, quantity, uom, unitPrice,
  amount: Math.round(quantity * unitPrice * 100) / 100,
  grnQuantity: 0, sesQuantity: consumed,
  openQuantity: Math.max(0, Math.round((quantity - consumed) * 1000) / 1000),
});

/** ALE manpower PO lines (Appendix-1 of PO 4203000546). Reused for the year-2 renewal. */
const aleLines = (consumedHours: { welder: number; fitter: number; otWelder: number; otFitter: number; months: number }): Item[] => [
  line('00030', 'MPWR_SVC-PL_DIR,WLDR,OT-HRS — Manpower service, plant direct, welder, overtime hours', 1200, 'MH', 60_000, consumedHours.otWelder),
  line('00040', 'MPWR_SVC-PL_DIR,FITTER,OT-HRS — Manpower service, plant direct, fitter, overtime hours', 1200, 'MH', 40_000, consumedHours.otFitter),
  line('00050', 'Welder — 2 persons × 9 wh × 26 wd × 12 months (SMAW & GTAW, CS/SS/alloy)', 5616, 'MH', 60_000, consumedHours.welder),
  line('00060', 'Stationery, Postage, Transportation', 12, 'MON', 1_130_000, consumedHours.months),
  line('00070', 'Medical Check Up — welder', 2, 'PRS', 1_000_000, 2),
  line('00080', 'PPE (safety shoes, helmet, goggles, gloves, raincoat, rubber shoes) — welder', 2, 'PRS', 2_000_000, 2),
  line('00090', 'Overhead & Profit — welder', 12, 'MON', 4_456_500, consumedHours.months),
  line('00110', 'Fitter — 2 persons × 9 wh × 26 wd × 12 months', 5616, 'MH', 40_000, consumedHours.fitter),
  line('00120', 'Medical Check Up — fitter', 2, 'PRS', 1_000_000, 2),
  line('00130', 'PPE — fitter', 2, 'PRS', 2_000_000, 2),
  line('00140', 'Overhead & Profit — fitter', 12, 'MON', 2_883_000, consumedHours.months),
];

/** Baasithu catering PO lines (Jul 2025 – Jan 2026 invoice summary). Reused for the renewal. */
const cateringLines = (): Item[] => [
  line('00010', 'Food & Beverage PAU — Breakfast', 25_800, 'PACK', 45_128),
  line('00020', 'Food & Beverage PAU — Lunch', 25_800, 'PACK', 70_219),
  line('00030', 'Food & Beverage PAU — Dinner', 25_800, 'PACK', 70_219),
  line('00040', 'Food & Beverage PAU — Supper', 8_600, 'PACK', 45_128),
  line('00050', 'International Food Catering Services (International Cook)', 7, 'MON', 50_000_000),
  line('00060', 'Food & Beverage Vendor — Breakfast', 2_688, 'PACK', 45_128),
  line('00070', 'Food & Beverage Vendor — Lunch', 3_996, 'PACK', 70_219),
  line('00080', 'Food & Beverage Vendor — Dinner', 4_021, 'PACK', 70_219),
  line('00090', 'Food & Beverage Vendor — Supper', 315, 'PACK', 45_128),
  line('00100', 'Mineral Water — Aqua Galon', 1_720, 'GAL', 45_000),
  line('00110', 'Housekeeping & Laundry — Main Camp', 25_800, 'MD', 22_050),
  line('00120', 'Housekeeping & Laundry — Porta Camp', 3_225, 'MD', 11_000),
];

const sum = (items: Item[]) => items.reduce((s, i) => s + i.amount, 0);

export const SAP_POS: SapPurchaseOrder[] = [
  // ---- PT Amanah Lestari Energy — Manpower supply for piping fabrication
  {
    poNumber: '4203000546', vendorCode: '30000956', vendorName: 'PT Amanah Lestari Energy', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'CLOSED',
    totalAmount: 795_234_000,
    // Remaining PO balance printed on SES 8000003065 (25 Apr 2026), less the 11th and 12th (final) claims.
    openAmount: 107_303_000,
    validFrom: '2025-06-01', validTo: '2026-05-31',
    items: aleLines({ welder: 4_930.1, fitter: 5_158.6, otWelder: 889.1, otFitter: 924.5, months: 12 }),
  },
  {
    poNumber: '4203001318', vendorCode: '30000956', vendorName: 'PT Amanah Lestari Energy', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 795_234_000,
    openAmount: 795_234_000 - (53_119_500 + 51_189_500),
    validFrom: '2026-06-07', validTo: '2027-06-06',
    items: aleLines({ welder: 731.5, fitter: 774, otWelder: 128, otFitter: 121, months: 2 }),
  },
  // ---- PT Berca Buana Sakti — BAP New Facilities Phase 1 (contract 0032/AG/PAU-EXT/2025)
  {
    poNumber: '4203000843', vendorCode: '30000731', vendorName: 'PT Berca Buana Sakti', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 102_500_000_000,
    // Remaining PO balance printed on SES 8000003131 (92,798,292,935) less progress 3 and 4.
    openAmount: 92_798_292_935 - 6_047_500_000 - 6_355_000_000,
    validFrom: '2025-11-24', validTo: '2026-09-03',
    items: [
      line('00010', '4300000106 TECHNICAL_SERVICE — Preparation works', 1, 'LOT', 11_810_608_000, 0.5),
      line('00150', '4300000136 TECHNICAL_SERVICE — Structural works (STR)', 1, 'LOT', 7_701_212_000, 0.275),
      line('00240', '4300000136 TECHNICAL_SERVICE — Structural works, architectural (ARS)', 1, 'LOT', 2_945_795_000, 0.555),
      line('00300', 'New Facility Construction Work Phase 1 — MEP and remaining work packages', 1, 'LOT', 80_042_385_000, 0.128),
    ],
  },
  // ---- Emerson Asia Pacific — imported valve spares (USD, FOB Port Klang)
  {
    poNumber: '4202000128', vendorCode: '40000143', vendorName: 'Emerson Asia Pacific Private Limited', companyCode: 'PAU', currency: 'USD', poType: 'MATERIAL', status: 'CLOSED',
    totalAmount: 19_992, openAmount: 0, validFrom: '2025-07-02', validTo: '2026-03-21',
    items: [{
      item: '00010', description: '2050038921 Body valve with bonnet, ASTM A216 GRD WCC, 8 in, Class 600, globe valve, ED, IA110518, body S/A, Fisher, 235081-60 Rev C — Tag PV-1015', quantity: 1, uom: 'SET', unitPrice: 19_992, amount: 19_992,
      grnQuantity: 1, sesQuantity: 0, openQuantity: 0,
    }],
  },
  {
    poNumber: '4202000141', vendorCode: '40000143', vendorName: 'Emerson Asia Pacific Private Limited', companyCode: 'PAU', currency: 'USD', poType: 'MATERIAL', status: 'OPEN',
    totalAmount: 12_180, openAmount: 12_180 - 4_860, validFrom: '2026-05-19', validTo: '2026-09-30',
    items: [
      { item: '00010', description: 'Fisher DVC6200 SIS digital valve controller, HART, 4-20 mA, for PV-1015 / PV-1016', quantity: 2, uom: 'PCE', unitPrice: 4_860, amount: 9_720, grnQuantity: 1, sesQuantity: 0, openQuantity: 1 },
      { item: '00020', description: 'Repair kit, actuator diaphragm 667 size 45, Fisher', quantity: 4, uom: 'PCE', unitPrice: 615, amount: 2_460, grnQuantity: 0, sesQuantity: 0, openQuantity: 4 },
    ],
  },
  // ---- PT Baasithu Boga Services — camp maintenance Feb 2026 – Jan 2027
  {
    poNumber: '4203001027', vendorCode: '30000512', vendorName: 'PT Baasithu Boga Services', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: 1_816_920_000,
    openAmount: 1_816_920_000 - (146_413_470 + 132_332_340 + 143_838_500 + 148_381_800 + 150_652_000 + 141_300_000),
    validFrom: '2026-02-01', validTo: '2027-01-31',
    items: [line('00020', 'Camp Maintenance Service — main camp and porta camp, BAP', 12, 'MON', 151_410_000, 5.703)],
  },
  // ---- PT Baasithu Boga Services — catering, meal vendor, international cook (Jul 2025 – Jan 2026)
  {
    poNumber: '4203000502', vendorCode: '30000512', vendorName: 'PT Baasithu Boga Services', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'CLOSED',
    totalAmount: sum(cateringLines()),
    openAmount: 0, // filled in below from the SES list
    validFrom: '2025-07-01', validTo: '2026-01-31',
    items: cateringLines(),
  },
  // ---- PT Baasithu Boga Services — catering renewal Feb 2026 – Jan 2027 (same rates and scope)
  {
    poNumber: '4203001112', vendorCode: '30000512', vendorName: 'PT Baasithu Boga Services', companyCode: 'PAU', currency: 'IDR', poType: 'SERVICE', status: 'OPEN',
    totalAmount: sum(cateringLines()),
    openAmount: 0, // filled in below from the SES list
    validFrom: '2026-02-01', validTo: '2027-01-31',
    items: cateringLines(),
  },
];

// -------------------------------------------------- service entry sheets
const ses = (sesNumber: string, poNumber: string, postingDate: string, serviceDescription: string, amount: number, quantity = 1, uom = 'AU'): SapSes => ({
  sesNumber, poNumber, postingDate, serviceDescription, quantity, uom, amount, acceptedAmount: amount, status: 'ACCEPTED',
});

export const SAP_SES: SapSes[] = [
  // ---- ALE PO 4203000546: one SES per monthly claim (7th – 12th); the 10th is the sample document.
  ses('8000002631', '4203000546', '2026-01-14', 'MPS Piping Fabrication December 2025-January 2026 (7th claim)', 51_639_500, 750, 'MH'),
  ses('8000002798', '4203000546', '2026-02-13', 'MPS Piping Fabrication January-February 2026 (8th claim)', 54_929_500, 885, 'MH'),
  ses('8000002946', '4203000546', '2026-03-16', 'MPS Piping Fabrication February-March 2026 (9th claim)', 57_300_500, 768.2, 'MH'),
  ses('8000003065', '4203000546', '2026-04-25', 'MPS Piping Fabrication March-April 2026', 55_029_500, 758.5, 'MH'),
  ses('8000003221', '4203000546', '2026-05-13', 'MPS Piping Fabrication April-May 2026 (11th claim)', 53_469_500, 781, 'MH'),
  ses('8000003347', '4203000546', '2026-06-08', 'MPS Piping Fabrication May 2026 (12th / final claim)', 45_029_500, 653, 'MH'),
  // ---- ALE PO 4203001318 (year 2)
  ses('8000003438', '4203001318', '2026-07-13', 'MPS Piping Fabrication June-July 2026 (1st claim)', 53_119_500, 759.5, 'MH'),
  ses('8000003561', '4203001318', '2026-08-12', 'MPS Piping Fabrication July-August 2026 (2nd claim)', 51_189_500, 746, 'MH'),
  // ---- Berca PO 4203000843: progress claims (SES value = gross work value of the period)
  ses('8000002713', '4203000843', '2026-02-24', 'BAP New Facilities Phase 1 - 1st WP (24 Nov 2025 - 8 Feb 2026)', 4_374_049_731, 0.04267, 'LOT'),
  ses('8000003131', '4203000843', '2026-05-06', 'BAP New Facilities Phase 1 - 2nd WP.', 5_325_676_535, 0.05188, 'LOT'),
  ses('8000003420', '4203000843', '2026-07-03', 'BAP New Facilities Phase 1 - 3rd WP (9 Mar - 8 May 2026)', 6_047_500_000, 0.059, 'LOT'),
  ses('8000003552', '4203000843', '2026-08-10', 'BAP New Facilities Phase 1 - 4th WP (9 May - 8 Jul 2026)', 6_355_000_000, 0.062, 'LOT'),
  // ---- Baasithu camp maintenance PO 4203001027 (Feb and Mar are the sample SES; later months follow the same pattern)
  ses('8000002908', '4203001027', '2026-03-31', 'Maintenance Periode February 2026', 146_413_470, 0.967, 'MON'),
  ses('8000003051', '4203001027', '2026-04-22', 'Maintenance PT BBS Periode Maret 2026', 132_332_340, 0.874, 'MON'),
  ses('8000003170', '4203001027', '2026-05-15', 'Maintenance PT BBS Periode April 2026', 143_838_500, 0.95, 'MON'),
  ses('8000003268', '4203001027', '2026-06-12', 'Maintenance PT BBS Periode Mei 2026', 148_381_800, 0.98, 'MON'),
  ses('8000003389', '4203001027', '2026-07-10', 'Maintenance PT BBS Periode Juni 2026', 150_652_000, 0.995, 'MON'),
  ses('8000003476', '4203001027', '2026-08-07', 'Maintenance PT BBS Periode Juli 2026', 141_300_000, 0.933, 'MON'),
  // ---- Baasithu catering PO 4203000502 — the complete SES list of the sample bundle (39 sheets)
  ses('8000001387', '4203000502', '2025-08-11', 'HK & LOUNDRY MAIN CAMP PERIOD JULY 25', 91_904_400),
  ses('8000001388', '4203000502', '2025-08-11', 'HK & LOUNDRY PORTA CAMP PERIOD JULY 25', 5_786_000),
  ses('8000001390', '4203000502', '2025-08-11', 'INT. FOOD CATERING PERIOD JULIY 2025', 50_000_000),
  ses('8000001391', '4203000502', '2025-08-11', 'MEAL PAU PERIODE JULY 2025', 561_330_032),
  ses('8000001394', '4203000502', '2025-08-12', 'MEAL VENDOR PERIOD JULY 2025', 77_762_620),
  ses('8000001398', '4203000502', '2025-08-12', 'Water Galon period July 2025', 11_160_000),
  ses('8000001548', '4203000502', '2025-09-09', 'HK & Laundry Porta Camp Aug 2025', 5_830_000),
  ses('8000001549', '4203000502', '2025-09-09', 'HK & Laundry Aug 2025', 93_315_600),
  ses('8000001552', '4203000502', '2025-09-09', 'Water Galon Aqua Aug 2025', 11_160_000),
  ses('8000001554', '4203000502', '2025-09-09', 'INT. Food Catering Service', 50_000_000),
  ses('8000001592', '4203000502', '2025-09-11', 'Meal PAU Periode August 2025', 570_202_717),
  ses('8000001594', '4203000502', '2025-09-11', 'Meal Vendor Periode August 2025', 119_064_764),
  ses('8000001802', '4203000502', '2025-10-13', 'HK & Laundry Porta Sept 2025', 6_875_000),
  ses('8000001803', '4203000502', '2025-10-13', 'HK & Laundry Main Camp Sept 2025', 95_674_950),
  ses('8000001805', '4203000502', '2025-10-13', 'Water Galon BBS Sept 2025', 10_800_000),
  ses('8000001806', '4203000502', '2025-10-13', 'INT. Food Cattering Sept 2025', 50_000_000),
  ses('8000001807', '4203000502', '2025-10-13', 'Meal PAU September 2025', 566_512_508),
  ses('8000001811', '4203000502', '2025-10-13', 'Meal Vendor Sept 2025', 156_704_159),
  ses('8000001962', '4203000502', '2025-11-06', 'BBS-INT. Food Catering Service', 50_000_000),
  ses('8000001963', '4203000502', '2025-11-06', 'BBS-Aqua Water Galon Oct 2025', 11_160_000),
  ses('8000001969', '4203000502', '2025-11-07', 'BBS-Meal Vendor October 2025', 115_302_904),
  ses('8000001970', '4203000502', '2025-11-07', 'BBS-Meal PAU October 2025', 579_794_765),
  ses('8000001972', '4203000502', '2025-11-07', 'BBS-HK & Laundry Main Camp Oct 25', 94_903_200),
  ses('8000001973', '4203000502', '2025-11-07', 'BBS-HK & Laundry Porta Camp Oct 2025', 6_193_000),
  ses('8000002215', '4203000502', '2025-12-12', 'PT BBS Aqua Galon Periode November 2025', 10_800_000),
  ses('8000002216', '4203000502', '2025-12-12', 'PT BBS HK & Laundry Main Camp Nov 2025', 87_362_100),
  ses('8000002217', '4203000502', '2025-12-12', 'PT BBS HK & Laundry Porta Periode Nov 25', 6_501_000),
  ses('8000002219', '4203000502', '2025-12-12', 'PT BBS INT. Food Catering Periode Nov 25', 50_000_000),
  ses('8000002222', '4203000502', '2025-12-12', 'PT BBS Meal Vendor Periode November 2025', 95_025_312),
  ses('8000002227', '4203000502', '2025-12-12', 'Meal PAU Periode November 2025', 546_304_240),
  ses('8000002451', '4203000502', '2026-01-13', 'BBS INT Food Catering Service Dec 2025', 50_000_000),
  ses('8000002452', '4203000502', '2026-01-13', 'HK & Laundry Main Camp Periode Dec 2025', 93_249_450),
  ses('8000002454', '4203000502', '2026-01-13', 'BBS Aqua Water Galon December 2025', 11_160_000),
  ses('8000002455', '4203000502', '2026-01-13', 'BBS Meal PAU December 2025', 524_682_916),
  ses('8000002456', '4203000502', '2026-01-13', 'BBS HK & Laundry Porta Camp December 25', 4_290_000),
  ses('8000002460', '4203000502', '2026-01-13', 'BBS Meal Vendor December 2025', 116_373_678),
  ses('8000002622', '4203000502', '2026-02-11', 'Int. Food Catering Service January 26', 50_000_000),
  ses('8000002624', '4203000502', '2026-02-11', 'Aqua Water Galon BBS January 2026', 11_160_000),
  ses('8000002626', '4203000502', '2026-02-11', 'Meal PAU January 2026', 552_550_288),
  // ---- Baasithu catering renewal PO 4203001112 — Meal PAU sheets for the months invoiced so far
  ses('8000002771', '4203001112', '2026-03-10', 'Meal PAU February 2026', 519_708_942),
  ses('8000002944', '4203001112', '2026-04-13', 'Meal PAU March 2026', 558_216_573),
  ses('8000003088', '4203001112', '2026-05-12', 'Meal PAU April 2026', 541_923_806),
  ses('8000003254', '4203001112', '2026-06-10', 'Meal PAU May 2026', 553_040_167),
  ses('8000003408', '4203001112', '2026-07-09', 'Meal PAU June 2026', 549_426_527),
  ses('8000003538', '4203001112', '2026-08-06', 'Meal PAU July 2026', 567_520_128),
];

// Open PO value = PO value less accepted SES, exactly as the SES print-out states it.
for (const po of SAP_POS.filter((p) => p.poNumber === '4203000502' || p.poNumber === '4203001112')) {
  po.openAmount = po.totalAmount - SAP_SES.filter((s) => s.poNumber === po.poNumber).reduce((s, x) => s + x.acceptedAmount, 0);
}

// --------------------------------------------------------- goods receipts
export const SAP_GRNS: SapGrn[] = [
  // Goods Receipt Form GR No. 5000001927 / GE 5000001890, 11 April 2026 — the sample GRN.
  { grnNumber: '5000001927', poNumber: '4202000128', postingDate: '2026-04-11', totalQuantity: 1, amount: 19_992, movementType: '101', items: [{ poItem: '00010', quantity: 1, amount: 19_992 }] },
  // Partial receipt against the DVC6200 order: one of two controllers received, repair kits still in transit.
  { grnNumber: '5000002144', poNumber: '4202000141', postingDate: '2026-08-14', totalQuantity: 1, amount: 4_860, movementType: '101', items: [{ poItem: '00010', quantity: 1, amount: 4_860 }] },
];

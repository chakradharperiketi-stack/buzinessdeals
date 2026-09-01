// Maps the analyst-phase extraction JSON + its computed P&L (see
// lib/financialModel.js) into the initialForm shape ValuationPlatform (V3)
// expects, so a seller who completes the AI Financial Model interview never
// re-enters a single number in the valuation tool.
//
// Adapted from the previous codebase's proceedToV3() function. The core
// unit-conversion rule carries over unchanged: the analyst extraction works
// in Rs. Lakhs, V3 stores everything internally in raw INR - every rupee
// value below is multiplied by RAW (100,000) on the way in.

import { SECTORS, initForm } from '../ValuationPlatform';

var RAW = 100000;

var SECTOR_MAP = {
  trading: 'Trading / Distribution', distribution: 'Trading / Distribution', wholesale: 'Trading / Distribution',
  procurement: 'Trading / Distribution', marketplace: 'Trading / Distribution', 'b2b marketplace': 'Trading / Distribution',
  industrial: 'Trading / Distribution', 'spare parts': 'Trading / Distribution',
  manufacturing: 'Manufacturing',
  'it services': 'IT Services / BPO', 'it consulting': 'IT Services / BPO', consulting: 'IT Services / BPO', bpo: 'IT Services / BPO',
  saas: 'Technology / SaaS', software: 'Technology / SaaS', technology: 'Technology / SaaS',
  healthcare: 'Healthcare Services',
  'professional services': 'Professional Services', services: 'Professional Services',
  construction: 'Engineering / Construction', infrastructure: 'Engineering / Construction',
};

function findCost(lines, keywords) {
  var found = (lines || []).find(function (l) {
    return keywords.some(function (kw) { return (l.item || '').toLowerCase().includes(kw); });
  });
  return found ? Math.round((found.monthlyAmount || 0) * 12) : 0;
}

// extraction: the analyst-phase extraction JSON (businessProfile, revenue,
//   cogs, opex, workingCapital, assets, funding, projections)
// computed: the result of computeModel(extraction) from lib/financialModel.js
// profile: { fullName, isProfessional, designation, membershipNumber, firmName, firmAddress } from the profiles table, or null
export function buildV3FormFromModel(extraction, computed, profile) {
  var fm = extraction || {};
  var proj = fm.projections || {};
  var gRates = [proj.year1GrowthPct || 15, proj.year2GrowthPct || 15, proj.year3GrowthPct || 15, proj.year4GrowthPct || 15, proj.year5GrowthPct || 15];

  var sRaw = ((fm.businessProfile && fm.businessProfile.sector) || '').toLowerCase();
  var sector = 'Trading / Distribution';
  Object.keys(SECTOR_MAP).forEach(function (key) {
    if (sRaw.includes(key)) sector = SECTOR_MAP[key];
  });
  var sectorData = SECTORS.find(function (s) { return s.name === sector; }) || SECTORS[0];
  // The actual PL_TEMPLATES key this sector renders under (see the forecast
  // row-shape comment further down) - falls back to 'trading' to match
  // sector's own default above, in the unreached case sectorData is missing.
  var sectorTemplate = (sectorData && sectorData.template) || 'trading';

  var baseRev = (computed && computed.base.rev) || 0;
  var baseCogs = (computed && computed.base.cogs) || 0;
  var baseOpex = (computed && computed.base.opex) || 0;
  var baseDep = (computed && computed.base.dep) || 0;
  var baseInterest = (computed && computed.base.interest) || 0;

  var cogsLines = (fm.cogs && fm.cogs.lineItems) || [];
  var opexLines = (fm.opex && fm.opex.lineItems) || [];

  var salaries = findCost(opexLines, ['salary', 'salari', 'staff', 'employee', 'people']) || Math.round(baseOpex * 0.70);
  var technology = findCost(opexLines, ['tech', 'platform', 'software', 'hosting', 'it']) || Math.round(baseOpex * 0.08);
  var rent = findCost(opexLines, ['rent', 'office']) || Math.round(baseOpex * 0.04);
  var marketing = findCost(opexLines, ['market', 'advertis', 'sales']) || Math.round(baseOpex * 0.06);
  var badDebt = findCost(opexLines, ['bad debt', 'provision', 'doubtful']) || Math.round(baseOpex * 0.10);
  var misc = baseOpex - salaries - technology - rent - marketing - badDebt;
  if (misc < 0) misc = 0;

  var yrKeys = ['FY2026-27', 'FY2027-28', 'FY2028-29', 'FY2029-30', 'FY2030-31'];
  var forecast = {};
  var capex = {};

  yrKeys.forEach(function (yr, i) {
    var revGrowth = 1;
    for (var g = 0; g <= i; g++) revGrowth *= 1 + gRates[g] / 100;
    var revYr = Math.round(baseRev * revGrowth);
    var cogsYr = Math.round(baseCogs * revGrowth);
    var inflFactor = Math.pow(1.08, i);

    // Branch on the sector's actual PL_TEMPLATES key (sectorData.template,
    // from ValuationPlatform.jsx's SECTORS list), not on the sector NAME.
    // Those are two different vocabularies - e.g. 'IT Services / BPO' and
    // 'Healthcare Services' both resolve to the "services" template,
    // 'Technology / SaaS' resolves to "saas", 'Engineering / Construction'
    // resolves to "manufacturing" alongside the sector literally named
    // 'Manufacturing'. Branching on sector name here previously produced a
    // row shaped for a DIFFERENT template than the one S3_Forecast actually
    // renders (PL_TEMPLATES[sectorData.template] in ValuationPlatform.jsx) -
    // e.g. 'Technology / SaaS' got services-shaped keys (emp_cost/delivery/
    // software) while the saas template reads hosting/emp_tech/licenses, so
    // every P&L cell came back blank even though the AI interview had real
    // numbers. Keying off the template name is what keeps this aligned no
    // matter which sector maps to which template in the future.
    var row = {};
    if (sectorTemplate === 'trading') {
      row = {
        revenue: revYr * RAW, purchases: cogsYr * RAW, inv_adj: 0,
        selling_exp: Math.round((marketing + salaries * 0.3) * inflFactor) * RAW,
        gen_admin: Math.round((salaries * 0.7 + rent + technology + badDebt + misc) * inflFactor) * RAW,
        da: Math.round(baseDep) * RAW, interest: Math.round(baseInterest) * RAW,
      };
    } else if (sectorTemplate === 'manufacturing') {
      row = {
        revenue: revYr * RAW, raw_mat: cogsYr * RAW,
        direct_labour: Math.round(salaries * 0.6 * inflFactor) * RAW,
        factory_exp: Math.round((salaries * 0.4 + technology) * inflFactor) * RAW,
        selling_exp: Math.round(marketing * inflFactor) * RAW,
        gen_admin: Math.round((rent + misc + badDebt) * inflFactor) * RAW,
        da: Math.round(baseDep) * RAW, interest: Math.round(baseInterest) * RAW,
      };
    } else if (sectorTemplate === 'saas') {
      row = {
        revenue: revYr * RAW,
        emp_tech: Math.round((salaries * 0.7 + baseCogs * 0.5) * inflFactor) * RAW,
        hosting: Math.round(technology * inflFactor) * RAW,
        licenses: Math.round(baseCogs * 0.5 * inflFactor) * RAW,
        sales_mktg: Math.round((marketing + salaries * 0.2) * inflFactor) * RAW,
        gen_admin: Math.round((rent + salaries * 0.1 + misc + badDebt) * inflFactor) * RAW,
        da: Math.round(baseDep) * RAW, interest: Math.round(baseInterest) * RAW,
      };
    } else {
      // "services" - the PL_TEMPLATES default (IT Services/BPO, Healthcare
      // Services, Professional Services, and anything else not covered
      // above).
      row = {
        revenue: revYr * RAW,
        emp_cost: Math.round(salaries * inflFactor) * RAW,
        delivery: Math.round(baseCogs * inflFactor) * RAW,
        software: Math.round(technology * inflFactor) * RAW,
        admin_exp: Math.round((rent + misc + badDebt) * inflFactor) * RAW,
        sales_mktg: Math.round(marketing * inflFactor) * RAW,
        da: Math.round(baseDep) * RAW, interest: Math.round(baseInterest) * RAW,
      };
    }
    forecast[yr] = row;
    capex[yr] = Math.round((proj.plannedCapex || 0) / 5) * RAW;
  });

  var defaults = initForm();
  var isPro = !!(profile && profile.isProfessional);

  return Object.assign({}, defaults, {
    engagementType: 'internal',
    valuationDate: new Date().toISOString().split('T')[0],
    valueName: isPro ? (profile.designation || 'CA') + ' ' + profile.fullName : 'BuzinessDeals Platform',
    valueFirm: (profile && profile.firmName) || 'Zenius Advisors',
    valueMembership: isPro ? (profile.membershipNumber || '') : 'Indicative Valuation — Not for Statutory Use',
    valueFirmAddress: (profile && profile.firmAddress) || 'Hyderabad, Telangana',
    purpose: 'Business Sale / Investment Advisory',
    companyName: (fm.businessProfile && fm.businessProfile.name) || '',
    sector: sector,
    sectorBeta: sectorData.beta ? sectorData.beta.toFixed(3) : '0.8',
    beta: sectorData.beta ? sectorData.beta.toFixed(3) : '0.8',
    stage: (fm.businessProfile && fm.businessProfile.yearsOperating > 5) ? 'Growth Stage (scaling)' : 'Early Stage (0-2 yrs revenue)',
    businessDescription: (fm.businessProfile && fm.businessProfile.description) || '',
    unit: 'Lakhs',
    forecastPeriod: 5,
    taxRate: '26',
    forecastMode: 'manual',
    forecast: forecast,
    capex: capex,
    dso: String((fm.workingCapital && fm.workingCapital.receivableDays) || 45),
    dpo: String((fm.workingCapital && fm.workingCapital.payableDays) || 30),
    invDays: String((fm.workingCapital && fm.workingCapital.inventoryDays) || 0),
    baseNWC: String(Math.round((computed && computed.wc.nwc) || 0) * RAW),
    debt: String(Math.round((fm.funding && fm.funding.termLoanOutstanding) || 0) * RAW),
    cash: String(Math.round((fm.funding && fm.funding.cash) || 0) * RAW),
    openingLoss: '0',
    authCapital: '1000000',
    faceValue: '10',
  });
}
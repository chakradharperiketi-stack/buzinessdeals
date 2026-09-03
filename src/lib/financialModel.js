// Turns the analyst-phase extraction JSON (shape defined by the ai-search
// Edge Function's Financial Analyst persona - see the "model" spec) into a
// computed P&L, working capital position and 5-year projection, all in
// Rs. Lakhs. Used by RightPanel's live financial model builder (analyst
// phase) and by v3FormMapper when handing off to ValuationPlatform.
//
// Adapted from the previous codebase's computeModel() - the math is
// unchanged, only the input shape assumption (analyst extraction JSON) is
// documented here since it now arrives from the deployed Edge Function
// rather than a local extraction call.

var DEP_RATES = { building: 0.10, machinery: 0.15, vehicles: 0.15, computers: 0.40, furniture: 0.10, other: 0.15 };

// Phase 2 of the single-source-of-truth rebuild (see chat, 2 Sept 2026).
// Root cause of the Z ab Studios reconciliation bugs: computeModel() used to
// trust extraction.revenue.annualTotal / cogs.annualTotal / opex.annualTotal
// as independently-submitted facts, even when the SAME extraction also
// carried itemized data (revenue.segments, cogs.lineItems, opex.lineItems,
// staffingBuildUp.roles) that summed to a DIFFERENT total - and that
// itemized data is exactly what the generated report's own tables (Revenue
// Engine, Cost Architecture) display. Two numbers for the same fact, next
// to each other in one PDF. These three functions make the itemized data
// authoritative whenever it exists - annualTotal is now only a fallback for
// the (Case 3 / early-conversation) situation where nothing itemized has
// been captured yet. This mirrors the same derive-don't-assert rule as
// lib/canonicalModel.js's validateConsistency(). MUST be mirrored exactly
// in the three server-side copies of computeModel() (generate-financial-
// report/index.ts, generate-financial-report-pdf/index.ts, ai-search-v2/
// index.ts) - if this logic changes here, it has to change there too, or
// the PDF (generated server-side) silently reverts to the old numbers.

function deriveRevenue(extraction) {
  var segments = (extraction.revenue && extraction.revenue.segments) || [];
  var segSum = segments.reduce(function (s, seg) { return s + (Number(seg.monthlyRevenue) || 0) * 12; }, 0);
  if (segments.length > 0 && segSum > 0) return Math.round(segSum * 100) / 100;
  return (extraction.revenue && extraction.revenue.annualTotal) || 0;
}

function deriveDirectCosts(extraction) {
  var cogsLines = (extraction.cogs && extraction.cogs.lineItems) || [];
  var cogsLineSum = cogsLines.reduce(function (s, li) { return s + (Number(li.monthlyAmount) || 0) * 12; }, 0);
  var staffingAnnual = (extraction.staffingBuildUp && extraction.staffingBuildUp.annualTotal) || 0;
  var itemizedTotal = cogsLineSum + staffingAnnual;
  var hasItemized = cogsLines.length > 0 || staffingAnnual > 0;
  if (hasItemized) return Math.round(itemizedTotal * 100) / 100;
  return (extraction.cogs && extraction.cogs.annualTotal) || 0;
}

function deriveOpex(extraction) {
  var opexLines = (extraction.opex && extraction.opex.lineItems) || [];
  var opexLineSum = opexLines.reduce(function (s, li) { return s + (Number(li.monthlyAmount) || 0) * 12; }, 0);
  if (opexLines.length > 0 && opexLineSum > 0) return Math.round(opexLineSum * 100) / 100;
  return (extraction.opex && extraction.opex.annualTotal) || 0;
}

export function computeModel(extraction) {
  if (!extraction) return null;
  var rev = deriveRevenue(extraction);
  var cogs = deriveDirectCosts(extraction);
  var opex = deriveOpex(extraction);
  var assets = extraction.assets || {};
  var grossBlock = Object.keys(assets).reduce(function (s, k) { return s + (assets[k] || 0); }, 0);
  var dep = Object.keys(DEP_RATES).reduce(function (s, k) { return s + (assets[k] || 0) * DEP_RATES[k]; }, 0);

  var funding = extraction.funding || {};
  var tlRate = funding.termLoanRate || 12;
  var tlAmt = funding.termLoanOutstanding || 0;
  var wcRate = funding.wcLoanRate || 13;
  var wcAmt = funding.wcLoanUtilised || 0;
  var interest = (tlAmt * tlRate) / 100 + (wcAmt * wcRate) / 100;

  var gp = rev - cogs;
  var ebitda = gp - opex;
  var ebit = ebitda - dep;
  var pbt = ebit - interest;
  var tax = Math.max(0, pbt) * 0.26;
  var pat = pbt - tax;

  var wc = extraction.workingCapital || {};
  var recDays = wc.receivableDays || 30;
  var payDays = wc.payableDays || 15;
  var invDays = wc.inventoryDays || 0;
  var receivables = (rev * recDays) / 365;
  var payables = (cogs * payDays) / 365;
  var inventory = wc.closingStock || (cogs * invDays) / 365;
  var nwc = receivables + inventory - payables;

  var proj = extraction.projections || {};
  var gRates = [
    (proj.year1GrowthPct || 15) / 100, (proj.year2GrowthPct || 15) / 100,
    (proj.year3GrowthPct || 15) / 100, (proj.year4GrowthPct || 15) / 100, (proj.year5GrowthPct || 15) / 100,
  ];
  var cogsPct = rev > 0 ? cogs / rev : 0.5;

  var years = gRates.map(function (g, i) {
    var r = rev;
    for (var j = 0; j <= i; j++) r = r * (1 + gRates[j]);
    var c = r * cogsPct;
    var ox = opex * Math.pow(1.08, i);
    var gpYr = r - c, eYr = gpYr - ox, ebitYr = eYr - dep, pbtYr = ebitYr - interest;
    var taxYr = Math.max(0, pbtYr) * 0.26, patYr = pbtYr - taxYr;
    var capYr = (proj.plannedCapex || 0) / 5;
    var nwcYr = (r * recDays) / 365 + (c * invDays) / 365 - (c * payDays) / 365;
    var prevRev = i === 0 ? rev : rev * gRates.slice(0, i).reduce(function (acc, gg) { return acc * (1 + gg); }, 1);
    var prevNWC = (prevRev * recDays) / 365;
    var dnwc = nwcYr - prevNWC;
    var fcff = patYr + dep + interest * 0.74 - capYr - dnwc;
    return {
      yr: 'FY' + (2027 + i), rev: r, cogs: c, gp: gpYr, opex: ox, ebitda: eYr, dep: dep,
      ebit: ebitYr, interest: interest, pbt: pbtYr, tax: taxYr, pat: patYr, capex: capYr, dnwc: dnwc, fcff: fcff,
    };
  });

  return {
    base: { rev: rev, cogs: cogs, gp: gp, opex: opex, ebitda: ebitda, dep: dep, ebit: ebit, interest: interest, pbt: pbt, tax: tax, pat: pat },
    wc: { receivables: receivables, payables: payables, inventory: inventory, nwc: nwc },
    grossBlock: grossBlock, dep: dep, years: years,
    segments: (extraction.revenue && extraction.revenue.segments) || [],
    cogsLines: (extraction.cogs && extraction.cogs.lineItems) || [],
    opexLines: (extraction.opex && extraction.opex.lineItems) || [],
    assets: assets, extraction: extraction,
  };
}

// Key ratios for the "Key Financial Metrics" report section - pure derived
// math from computeModel()'s own output, nothing new asked of the user and
// nothing that needs an AI call. Dynamically adapts to what's actually
// computable: a metric whose inputs are all zero/missing is left out rather
// than shown as a misleading 0% or Infinity.
export function computeMetrics(computed) {
  if (!computed || !computed.years || !computed.years.length) return null;
  var base = computed.base;
  var years = computed.years;
  var last = years[years.length - 1];
  var n = years.length;
  var metrics = {};

  if (base.rev > 0 && last.rev > 0) {
    metrics.revenueCagrPct = Math.round((Math.pow(last.rev / base.rev, 1 / n) - 1) * 1000) / 10;
  }
  if (base.rev > 0) {
    metrics.ebitdaMarginCurrentPct = Math.round((base.ebitda / base.rev) * 1000) / 10;
    metrics.patMarginCurrentPct = Math.round((base.pat / base.rev) * 1000) / 10;
    metrics.fixedCostRatioPct = Math.round((base.opex / base.rev) * 1000) / 10;
    metrics.variableCostRatioPct = Math.round((base.cogs / base.rev) * 1000) / 10;
  }
  if (last.rev > 0) {
    metrics.ebitdaMarginYear5Pct = Math.round((last.ebitda / last.rev) * 1000) / 10;
    metrics.patMarginYear5Pct = Math.round((last.pat / last.rev) * 1000) / 10;
  }
  var wc = computed.wc;
  if (base.rev > 0 && wc) {
    metrics.workingCapitalIntensityPct = Math.round((wc.nwc / base.rev) * 1000) / 10;
  }
  var ex = computed.extraction || {};
  var wcExtract = ex.workingCapital || {};
  if (wcExtract.receivableDays != null) metrics.receivableDays = wcExtract.receivableDays;
  if (wcExtract.payableDays != null) metrics.payableDays = wcExtract.payableDays;
  if (wcExtract.inventoryDays != null) metrics.inventoryDays = wcExtract.inventoryDays;

  return metrics;
}

// Normalizes computeModel()'s output into a flat "Current + 5 years" row
// series for charting (Phase 4 of the AI Financial Model Report feature) -
// one place that turns base/years into {label, rev, ebitda, pat, ebitdaPct,
// patPct} rows so lib/charts.js's builders never have to know about
// computeModel()'s internal shape. Ported verbatim into the
// generate-financial-report-pdf Edge Function for the PDF renderer.
export function buildYearSeries(computed) {
  if (!computed || !computed.base) return [];
  var b = computed.base;
  var rows = [{
    label: 'Current', rev: b.rev, ebitda: b.ebitda, pat: b.pat,
    ebitdaPct: b.rev > 0 ? (b.ebitda / b.rev) * 100 : 0,
    patPct: b.rev > 0 ? (b.pat / b.rev) * 100 : 0,
  }];
  (computed.years || []).forEach(function (y) {
    rows.push({
      label: y.yr, rev: y.rev, ebitda: y.ebitda, pat: y.pat,
      ebitdaPct: y.rev > 0 ? (y.ebitda / y.rev) * 100 : 0,
      patPct: y.rev > 0 ? (y.pat / y.rev) * 100 : 0,
    });
  });
  return rows;
}

export var DEPRECIATION_RATES = DEP_RATES;
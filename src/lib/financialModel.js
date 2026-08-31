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

export function computeModel(extraction) {
  if (!extraction) return null;
  var rev = (extraction.revenue && extraction.revenue.annualTotal) || 0;
  var cogs = (extraction.cogs && extraction.cogs.annualTotal) || 0;
  var opex = (extraction.opex && extraction.opex.annualTotal) || 0;
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

export var DEPRECIATION_RATES = DEP_RATES;
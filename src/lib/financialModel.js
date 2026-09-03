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

// Phase 3 of the single-source-of-truth rebuild (see chat, 3 Sept 2026).
// The 5-year projection used to grow ONE blended total (rev, then a
// constant cogsPct of it, then opex at a flat 8%) even when the extraction
// carried a real itemized breakdown (revenue.segments, cogs.lineItems,
// staffingBuildUp, opex.lineItems) - so the report could show "here's how
// this business breaks down today" and then silently blur that same
// breakdown into one line for every future year. This function projects
// each item forward on its OWN trajectory instead: an item's own
// growthPct (captured by the interview only when a seller actually says a
// segment/cost line moves differently - see ai-search-v2's Growth
// Assumptions instructions) if present, else a sensible default that
// reproduces today's aggregate behaviour exactly when nothing itemized
// exists or no item carries an override - see the three call sites below
// for what each default is. MUST be mirrored exactly in the two
// server-side copies (generate-financial-report/index.ts, ai-search-v2/
// index.ts), same discipline as deriveRevenue/deriveDirectCosts/deriveOpex
// above - generate-financial-report-pdf/index.ts has no copy of its own,
// it reads the already-computed years[].driverBreakdown from the database.
//
// getOwnGrowth(item) returns a fraction (0.12, not 12) or null/undefined
// to fall back to fallbackGRates[i] (the year's blended/default rate).
// Returns { totals: [yr0..yrN], perItem: [{label, base, growthPct, values:[yr0..yrN]}] }.
function projectItemSeries(items, getLabel, getBase, getOwnGrowth, fallbackGRates) {
  var perItem = items.map(function (item) {
    var base = getBase(item) || 0;
    var ownG = getOwnGrowth(item);
    ownG = (ownG === null || ownG === undefined || isNaN(ownG)) ? null : ownG;
    var values = fallbackGRates.map(function (_, i) {
      var v = base;
      for (var j = 0; j <= i; j++) {
        var g = ownG != null ? ownG : fallbackGRates[j];
        v = v * (1 + g);
      }
      return Math.round(v * 100) / 100;
    });
    return { label: getLabel(item), base: Math.round(base * 100) / 100, growthPct: ownG != null ? Math.round(ownG * 1000) / 10 : null, values: values };
  });
  var totals = fallbackGRates.map(function (_, i) {
    return Math.round(perItem.reduce(function (s, p) { return s + p.values[i]; }, 0) * 100) / 100;
  });
  return { totals: totals, perItem: perItem };
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

  // Bottom-up projection (Phase 3) - each revenue segment and cost line
  // grows on its own trajectory when the interview captured one, else
  // falls back to a default chosen to exactly reproduce the old
  // single-blended-total behaviour so a business with no itemized data
  // (or no overrides) sees IDENTICAL numbers to before this change.
  var segments = (extraction.revenue && extraction.revenue.segments) || [];
  var hasSegRev = segments.length > 0 && segments.reduce(function (s, sg) { return s + ((Number(sg.monthlyRevenue) || 0) * 12); }, 0) > 0;
  var revSeries = hasSegRev
    ? projectItemSeries(segments, function (sg) { return sg.product || 'Revenue stream'; }, function (sg) { return (Number(sg.monthlyRevenue) || 0) * 12; }, function (sg) { return sg.growthPct != null ? Number(sg.growthPct) / 100 : null; }, gRates)
    : { totals: gRates.map(function (_, i) { var r = rev; for (var j = 0; j <= i; j++) r = r * (1 + gRates[j]); return r; }), perItem: [] };

  var cogsLines = (extraction.cogs && extraction.cogs.lineItems) || [];
  var staffingAnnual = (extraction.staffingBuildUp && extraction.staffingBuildUp.annualTotal) || 0;
  var hasCogsDetail = cogsLines.length > 0 || staffingAnnual > 0;
  var cogsLineSeries = hasCogsDetail
    ? projectItemSeries(cogsLines, function (li) { return li.item || 'Direct cost'; }, function (li) { return (Number(li.monthlyAmount) || 0) * 12; }, function (li) { return li.growthPct != null ? Number(li.growthPct) / 100 : null; }, gRates)
    : { totals: gRates.map(function () { return 0; }), perItem: [] };
  // Staffing's default (no explicit override) tracks the same blended
  // revenue growth curve as everything else in "direct costs" - this is
  // what makes the no-override case reproduce the pre-Phase-3 numbers
  // exactly (old code folded staffing into one cogsPct-of-revenue figure).
  // An override only exists when the interview actually captured the
  // seller saying staffing moves differently from sales (e.g. a planned
  // headcount freeze, or wage inflation independent of volume).
  var staffOwnGrowth = (extraction.staffingBuildUp && extraction.staffingBuildUp.growthPct != null) ? Number(extraction.staffingBuildUp.growthPct) / 100 : null;
  var staffSeries = staffingAnnual > 0
    ? projectItemSeries([{}], function () { return 'Staffing'; }, function () { return staffingAnnual; }, function () { return staffOwnGrowth; }, gRates)
    : { totals: gRates.map(function () { return 0; }), perItem: [] };
  var cogsTotals = hasCogsDetail
    ? gRates.map(function (_, i) { return Math.round((cogsLineSeries.totals[i] + staffSeries.totals[i]) * 100) / 100; })
    : gRates.map(function (_, i) { return Math.round((revSeries.totals[i] * cogsPct) * 100) / 100; });

  var opexLines = (extraction.opex && extraction.opex.lineItems) || [];
  var hasOpexDetail = opexLines.length > 0;
  // Default fallback rate is flat 8% inflation per year, NOT the revenue
  // growth curve - opex line items are fixed costs, not revenue-linked,
  // same assumption the old single-bucket "opex * 1.08^i" made. First slot
  // is 0%, not 8%: projectItemSeries compounds j<=i inclusive, so a
  // constant-8% array would apply a year of growth already in "Year 1" -
  // the old Math.pow(1.08, i) formula (i is 0-indexed) does NOT, Year 1
  // is the unchanged base figure and growth first shows in Year 2. This
  // [0, 0.08, 0.08, 0.08, 0.08] shape reproduces that exactly, so a
  // business's opex trajectory doesn't shift just because its interview
  // happened to capture line items instead of one aggregate figure.
  var opexFallbackRates = gRates.map(function (_, idx) { return idx === 0 ? 0 : 0.08; });
  var opexLineSeries = hasOpexDetail
    ? projectItemSeries(opexLines, function (li) { return li.item || 'Operating cost'; }, function (li) { return (Number(li.monthlyAmount) || 0) * 12; }, function (li) { return li.growthPct != null ? Number(li.growthPct) / 100 : null; }, opexFallbackRates)
    : { totals: gRates.map(function (_, i) { return Math.round((opex * Math.pow(1.08, i)) * 100) / 100; }), perItem: [] };

  var years = gRates.map(function (g, i) {
    var r = revSeries.totals[i], c = cogsTotals[i], ox = opexLineSeries.totals[i];
    var gpYr = r - c, eYr = gpYr - ox, ebitYr = eYr - dep, pbtYr = ebitYr - interest;
    var taxYr = Math.max(0, pbtYr) * 0.26, patYr = pbtYr - taxYr;
    var capYr = (proj.plannedCapex || 0) / 5;
    var nwcYr = (r * recDays) / 365 + (c * invDays) / 365 - (c * payDays) / 365;
    var prevRev = i === 0 ? rev : revSeries.totals[i - 1];
    var prevNWC = (prevRev * recDays) / 365;
    var dnwc = nwcYr - prevNWC;
    var fcff = patYr + dep + interest * 0.74 - capYr - dnwc;
    return {
      yr: 'FY' + (2027 + i), rev: r, cogs: c, gp: gpYr, opex: ox, ebitda: eYr, dep: dep,
      ebit: ebitYr, interest: interest, pbt: pbtYr, tax: taxYr, pat: patYr, capex: capYr, dnwc: dnwc, fcff: fcff,
      // Bottom-up detail for this year, so the report can show a real
      // segment-by-segment/line-by-line driver table across the forecast,
      // not just the current year. Null when no itemized data existed to
      // project (Case 3 / early-conversation businesses) - same
      // "itemized data only when it's real" rule as computed.segments etc.
      driverBreakdown: (hasSegRev || hasCogsDetail || hasOpexDetail) ? {
        revenue: revSeries.perItem.map(function (p) { return { label: p.label, value: p.values[i], growthPct: p.growthPct }; }),
        directCosts: cogsLineSeries.perItem.concat(staffSeries.perItem).map(function (p) { return { label: p.label, value: p.values[i], growthPct: p.growthPct }; }),
        opex: opexLineSeries.perItem.map(function (p) { return { label: p.label, value: p.values[i], growthPct: p.growthPct }; }),
      } : null,
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
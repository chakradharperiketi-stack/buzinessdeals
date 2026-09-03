// canonicalModel.js
//
// PHASE 1 of the single-source-of-truth rebuild (see chat, 2 Sept 2026 -
// triggered by the Z ab Studios test report review: Rs 640L vs Rs 855L
// revenue, Rs 219.76L vs Rs 167L EBITDA, sector "Trading/Distribution" on a
// fashion boutique, debt Rs 200L used in the equity bridge while WACC
// assumed 0% debt).
//
// This file defines the ONE data shape both the AI Financial Model report
// and the Valuation report are meant to read from, and the deterministic
// checks that catch the class of bug above before a PDF is ever generated.
//
// PHASE 1 SCOPE - what this file does NOT do yet:
//   - Nothing in the live app writes or reads this shape yet. Phase 2
//     rewires FinancialModelPanel/ConversationEngine to populate it (Case 1
//     & Case 2 entry point) and ValuationPlatform to read it when present,
//     or populate it directly via its own manual entry when standalone
//     (Case 3). Until Phase 2 ships, this file is dormant - safe to add
//     without touching anything currently live or payment-gated.
//   - Debt-vs-WACC cross-checking is NOT covered here, because WACC/capital
//     structure lives in the Valuation layer, not in this financial-facts
//     object. That check gets added once Phase 2 defines the Valuation
//     Case layer that sits on top of this.
//   - This does not run the actual multi-year projection math (revenue
//     growth curves, opex inflation, tax). That engine already exists
//     (lib/financialModel.js) and gets UNIFIED to write into this shape in
//     Phase 2, rather than being reimplemented here.
//
// DESIGN RULE this file exists to enforce: every total is DERIVED (summed
// from its parts) and re-checked, never independently stored as its own
// "confirmed" fact. That is the actual mechanism of the bugs found in
// testing - three different subtotals (855L revenue-engine sum, 640L
// assumption-driven P&L, 514.3L itemized cost architecture) all coexisted
// in one report because each was computed once, in isolation, and never
// checked against the others.

// ---------------------------------------------------------------------------
// Field status - "Unknown != Zero" (finding #5 from the report review).
// A funding field is never just a number; it always carries how sure we are
// about it. Renderers must branch on status, not on `value === 0`.
// ---------------------------------------------------------------------------

export var FIELD_STATUS = {
  CONFIRMED: 'confirmed',   // the user explicitly stated this value
  ESTIMATED: 'estimated',   // a standard planning assumption applied in the absence of confirmed data
  UNKNOWN: 'unknown',       // never asked / never answered - must NOT render as zero or as a fact
};

export function fundingField(value, status) {
  return { value: value == null ? null : value, status: status || FIELD_STATUS.UNKNOWN };
}

// ---------------------------------------------------------------------------
// Shape factory
// ---------------------------------------------------------------------------

export function createEmptyCanonicalModel() {
  return {
    schemaVersion: 1,
    business: {
      name: '',
      sectorText: '',        // free text, as the user/AI interview describes it (e.g. "Fashion Designer and Boutique")
      industryClass: null,   // one of the closed enum values (see lib/industryClass.js, Phase 2) - null until AI-classified AND user-confirmed
      industryClassConfidence: null, // 0-1, set by the classifier; a low-confidence class must be confirmed before use, never silently applied
      industryClassConfirmed: false,
    },
    revenue: {
      streams: [
        // { key, label, driverInputs: {clientsPerMonth, avgOrderValue, ...} | null, monthlyValue, annualValue }
      ],
      total: 0, // MUST equal sum(streams[].annualValue) - validateConsistency() enforces this, never hand-set
    },
    costs: {
      variable: [],  // COGS-type, scales with revenue - { key, label, annualValue }
      staffing: [],  // volume-linked but not per-unit - { key, label, annualValue }
      fixed: [],     // rent/marketing/insurance/etc - { key, label, annualValue }
      totalDirect: 0, // = sum(variable) + sum(staffing)
      totalOpex: 0,   // = sum(fixed)
    },
    pnl: {
      // one entry per year: 'current', 'fy1'..'fy5'. Every field here is
      // DERIVED from revenue/costs above for 'current'; future years are
      // derived by the projection engine (Phase 2 unification) applying
      // growth/inflation assumptions - this file only validates that
      // whatever the engine produced is internally consistent.
      current: null,
      years: [], // [{ label, revenue, directCosts, opex, ebitda, depreciation, interest, pbt, tax, pat }]
    },
    workingCapital: {
      receivableDays: fundingField(null, FIELD_STATUS.UNKNOWN),
      payableDays: fundingField(null, FIELD_STATUS.UNKNOWN),
      inventoryDays: fundingField(null, FIELD_STATUS.UNKNOWN),
      nwc: null, // derived
    },
    funding: {
      ownerEquity: fundingField(null, FIELD_STATUS.UNKNOWN),
      termLoanOutstanding: fundingField(null, FIELD_STATUS.UNKNOWN),
      termLoanRate: fundingField(null, FIELD_STATUS.UNKNOWN),
      workingCapitalLoan: fundingField(null, FIELD_STATUS.UNKNOWN),
      cash: fundingField(null, FIELD_STATUS.UNKNOWN),
    },
    meta: {
      source: null,          // 'ai_interview' | 'manual_valuation_entry' - which flow populated this
      projectId: null,
      lastReconciledAt: null,
      lastReconcileOk: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function sumField(list, field) {
  field = field || 'annualValue';
  return round2((list || []).reduce(function (acc, item) { return acc + (Number(item[field]) || 0); }, 0));
}

var DEFAULT_TOLERANCE = 0.5; // Rs Lakhs - absorbs ordinary rounding, not real drift

function nearlyEqual(a, b, tolerance) {
  return Math.abs((a || 0) - (b || 0)) <= (tolerance == null ? DEFAULT_TOLERANCE : tolerance);
}

// ---------------------------------------------------------------------------
// The consistency engine
//
// Returns { ok, issues } - issues is a list of
// { code, severity: 'error'|'warning', message, expected, actual }.
// A report generator (Phase 2/3) MUST refuse to render a client-facing PDF
// while any 'error'-severity issue is present, per the review's explicit
// rule: don't make up a number, don't default to zero, don't ship a
// "completed" report over an unresolved conflict.
// ---------------------------------------------------------------------------

export function validateConsistency(model, opts) {
  var tolerance = (opts && opts.tolerance) || DEFAULT_TOLERANCE;
  var issues = [];

  function err(code, message, expected, actual) {
    issues.push({ code: code, severity: 'error', message: message, expected: round2(expected), actual: round2(actual) });
  }
  function warn(code, message, expected, actual) {
    issues.push({ code: code, severity: 'warning', message: message, expected: round2(expected), actual: round2(actual) });
  }

  if (!model) {
    return { ok: false, issues: [{ code: 'NO_MODEL', severity: 'error', message: 'No canonical model provided.' }] };
  }

  // 1. Revenue reconciliation: streams must sum to total.
  var streamSum = sumField(model.revenue && model.revenue.streams);
  var revenueTotal = (model.revenue && model.revenue.total) || 0;
  if (model.revenue && model.revenue.streams && model.revenue.streams.length > 0 && !nearlyEqual(streamSum, revenueTotal, tolerance)) {
    err('REVENUE_MISMATCH',
      'Revenue streams sum to ' + streamSum + ' but total revenue is recorded as ' + revenueTotal + '. ' +
      '(This is the exact Z ab Studios bug: streams summed to Rs 855L while the P&L ran off Rs 640L.)',
      streamSum, revenueTotal);
  }

  // 2. Cost reconciliation: itemized costs must sum to the recorded direct-cost/opex totals.
  var variableSum = sumField(model.costs && model.costs.variable);
  var staffingSum = sumField(model.costs && model.costs.staffing);
  var fixedSum = sumField(model.costs && model.costs.fixed);
  var derivedDirect = round2(variableSum + staffingSum);
  var recordedDirect = (model.costs && model.costs.totalDirect) || 0;
  var recordedOpex = (model.costs && model.costs.totalOpex) || 0;

  if (model.costs && ((model.costs.variable || []).length + (model.costs.staffing || []).length) > 0 && !nearlyEqual(derivedDirect, recordedDirect, tolerance)) {
    err('DIRECT_COST_MISMATCH',
      'Itemized variable + staffing costs sum to ' + derivedDirect + ' but direct costs are recorded as ' + recordedDirect + '.',
      derivedDirect, recordedDirect);
  }
  if (model.costs && (model.costs.fixed || []).length > 0 && !nearlyEqual(fixedSum, recordedOpex, tolerance)) {
    err('OPEX_MISMATCH',
      'Itemized fixed costs sum to ' + fixedSum + ' but operating expenses are recorded as ' + recordedOpex + '.',
      fixedSum, recordedOpex);
  }

  // 3. EBITDA reconciliation, per year (current + projected).
  var years = [];
  if (model.pnl) {
    if (model.pnl.current) years.push(Object.assign({ label: 'current' }, model.pnl.current));
    (model.pnl.years || []).forEach(function (y) { years.push(y); });
  }
  years.forEach(function (y) {
    var expectedEbitda = round2((y.revenue || 0) - (y.directCosts || 0) - (y.opex || 0));
    if (y.ebitda != null && !nearlyEqual(expectedEbitda, y.ebitda, tolerance)) {
      err('EBITDA_MISMATCH',
        '[' + y.label + '] Revenue - Direct Costs - Opex = ' + expectedEbitda + ' but EBITDA is recorded as ' + y.ebitda + '. ' +
        '(This is the exact Financial-Model-vs-Valuation gap: Rs 219.76L vs Rs 167L for FY2027.)',
        expectedEbitda, y.ebitda);
    }
    if (y.pbt != null && y.ebitda != null) {
      var expectedPbt = round2(y.ebitda - (y.depreciation || 0) - (y.interest || 0));
      if (!nearlyEqual(expectedPbt, y.pbt, tolerance)) {
        err('PBT_MISMATCH', '[' + y.label + '] EBITDA - Depreciation - Interest = ' + expectedPbt + ' but Profit Before Tax is recorded as ' + y.pbt + '.', expectedPbt, y.pbt);
      }
    }
    if (y.pat != null && y.pbt != null && y.tax != null) {
      var expectedPat = round2(y.pbt - y.tax);
      if (!nearlyEqual(expectedPat, y.pat, tolerance)) {
        err('PAT_MISMATCH', '[' + y.label + '] Profit Before Tax - Tax = ' + expectedPat + ' but Profit After Tax is recorded as ' + y.pat + '.', expectedPat, y.pat);
      }
    }
  });

  // 4. Working capital reconciliation - only checkable once a cost base and
  // days are both present; Phase 1 checks the NWC formula shape, not the
  // exact day-count-to-Rupee conversion (that needs an agreed base - revenue
  // vs COGS - which Phase 2 pins down when this is wired to the real engine).
  var wc = model.workingCapital;
  if (wc && wc.nwc != null && wc.receivableDays && wc.payableDays && wc.inventoryDays &&
      wc.receivableDays.status !== FIELD_STATUS.UNKNOWN && wc.payableDays.status !== FIELD_STATUS.UNKNOWN && wc.inventoryDays.status !== FIELD_STATUS.UNKNOWN) {
    var cycleDays = (wc.receivableDays.value || 0) + (wc.inventoryDays.value || 0) - (wc.payableDays.value || 0);
    if (cycleDays < 0) {
      warn('NEGATIVE_WC_CYCLE', 'Net working capital cycle computes negative (' + cycleDays + ' days) - verify receivable/payable/inventory day inputs.', 0, cycleDays);
    }
  }

  // 5. Unknown != Zero guard - flag any funding field whose status is
  // UNKNOWN but whose value has nonetheless been set to a number (a sign
  // something upstream already collapsed "unknown" into "0").
  ['ownerEquity', 'termLoanOutstanding', 'termLoanRate', 'workingCapitalLoan', 'cash'].forEach(function (key) {
    var f = model.funding && model.funding[key];
    if (f && f.status === FIELD_STATUS.UNKNOWN && f.value != null) {
      err('UNKNOWN_NOT_NULL', 'funding.' + key + ' is marked unknown but has a non-null value (' + f.value + '). Unknown must be null, never a number.', null, f.value);
    }
  });

  // 6. Sector/industry guard - an unconfirmed classification must never be
  // used as the basis for a client-facing report (Case 2's root cause:
  // "Fashion Designer and Boutique" silently mapped to "Trading /
  // Distribution").
  if (model.business && model.business.industryClass && !model.business.industryClassConfirmed) {
    warn('INDUSTRY_CLASS_UNCONFIRMED',
      'Industry classified as "' + model.business.industryClass + '" from sector text "' + model.business.sectorText + '" but not yet confirmed by the user - do not use in a generated report until confirmed.',
      null, model.business.industryClass);
  }

  return { ok: !issues.some(function (i) { return i.severity === 'error'; }), issues: issues };
}

// ---------------------------------------------------------------------------
// Convenience: re-derive the totals a model SHOULD have, for callers (Phase
// 2's write path) that want to compute-then-store rather than store-then-
// validate. Keeps "derive it" in one place instead of duplicated at every
// call site.
// ---------------------------------------------------------------------------

export function deriveTotals(model) {
  var revenueTotal = sumField(model.revenue && model.revenue.streams);
  var variableSum = sumField(model.costs && model.costs.variable);
  var staffingSum = sumField(model.costs && model.costs.staffing);
  var fixedSum = sumField(model.costs && model.costs.fixed);
  return {
    revenueTotal: revenueTotal,
    directCosts: round2(variableSum + staffingSum),
    opex: fixedSum,
    ebitda: round2(revenueTotal - variableSum - staffingSum - fixedSum),
  };
}
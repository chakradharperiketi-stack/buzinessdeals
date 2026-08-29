// ============================================================================
// ai-search-v2 — Supabase Edge Function (Deno)
// ============================================================================
// This is a NEW function, deployed alongside your existing `ai-search`, not a
// replacement for it. Point a test build at this URL, compare behaviour
// against production `ai-search`, and only then decide whether/how to cut
// over. See DEPLOY.md in this folder for the exact steps.
//
// WHY THIS EXISTS
// The "Product Feedback and Required Changes" and "AI Business & Deal
// Advisory Agent" documents both describe something the previous tag-based
// design (the AI writes "[EXTRACTION: {...}]" inline in its reply, the
// frontend regexes it out) cannot reliably do: an AI that plans what it
// needs, gathers it, computes an actual financial model and valuation from
// deterministic code (not from the LLM "reasoning" arithmetic into being),
// validates and challenges assumptions, and adapts when the user gives new
// instructions. That requires a genuine agent loop with tools, which is what
// this file implements using Anthropic's tool-use API.
//
// ARCHITECTURE
//   1. Build a persona system prompt for the current conversationPhase.
//   2. Give Claude a set of tools appropriate to that persona - not "answer
//      in text," but "call record_business_understanding with what you've
//      learned," "call compute_valuation with these inputs and I'll run the
//      real DCF engine and give you the numbers to explain."
//   3. Run the tool-use loop: Claude calls a tool -> we execute it with
//      real, deterministic code (ported from ValuationPlatform.jsx and
//      lib/financialModel.js, unchanged math) -> we feed the result back ->
//      Claude either calls another tool or produces its final reply.
//   4. Every tool call that represents durable state (extraction, model,
//      brief, valuation, match criteria, challenges, phase transitions) is
//      collected into the JSON response the frontend already expects -
//      same top-level contract as `ai-search` (reply, extraction, model,
//      brief, action, nextPhase), plus additive fields the current frontend
//      safely ignores until it's updated to read them (matchCriteria,
//      v3Updates, valuationResult, challenges).
//
// WHAT I DID NOT DO
// I don't have your current `ai-search` source, so this is a fresh
// implementation of the same request/response contract, not a diff. It
// assumes the `ai_conversations` schema visible from the frontend code
// (session_id, user_id, messages, updated_at) and nothing else. Read
// DEPLOY.md before pointing anything real at this.
// ============================================================================

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- Environment --------------------------------------------------------

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
// IMPORTANT: verify this against https://docs.claude.com/en/docs/about-claude/models
// before deploying - model IDs change. Override via the ANTHROPIC_MODEL env
// var without touching this file if it's out of date.
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5-20250929";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Auto-provided inside every Supabase Edge Function - no need to set these.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const MAX_ANON_EXCHANGES = 5;
const MAX_TOOL_ROUNDS = 5; // hard cap on Claude<->tool round trips per request, cost/latency guardrail

// ============================================================================
// SECTION 1 — Ported deterministic compute engines
// Verbatim math from ValuationPlatform.jsx (computeWACC/computeDCF/etc) and
// lib/financialModel.js (computeModel). These are pure functions of their
// arguments in the original file too, so the port is a straight copy with
// TypeScript-safe access patterns - no logic changes. If you ever change the
// math in ValuationPlatform.jsx, mirror the change here or the two engines
// will silently disagree.
// ============================================================================

const UNIT_MULT: Record<string, number> = { Actual: 1, Thousands: 1e3, Lakhs: 1e5, Crores: 1e7, Millions: 1e6, Billions: 1e9 };
const INDIA_ERP = 7.075, RF_DEFAULT = 7.2;

const SECTORS = [
  { name: "Technology / SaaS", beta: 0.463, template: "saas" },
  { name: "IT Services / BPO", beta: 0.731, template: "services" },
  { name: "E-commerce / Marketplace", beta: 1.098, template: "saas" },
  { name: "D2C / Consumer Brands", beta: 0.804, template: "manufacturing" },
  { name: "Manufacturing", beta: 0.827, template: "manufacturing" },
  { name: "Trading / Distribution", beta: 0.560, template: "trading" },
  { name: "Professional Services", beta: 0.710, template: "services" },
  { name: "Healthcare Services", beta: 0.528, template: "services" },
  { name: "Healthcare Products / Devices", beta: 2.002, template: "manufacturing" },
  { name: "Drugs / Pharmaceuticals", beta: 0.767, template: "manufacturing" },
  { name: "Education / EdTech", beta: 0.610, template: "services" },
  { name: "Financial Services (Non-Banking)", beta: 0.604, template: "services" },
  { name: "Real Estate (Development)", beta: 0.755, template: "manufacturing" },
  { name: "Engineering / Construction", beta: 1.041, template: "manufacturing" },
  { name: "Hospitality / Hotels / F&B", beta: 0.783, template: "services" },
  { name: "Transportation / Logistics", beta: 1.129, template: "services" },
  { name: "Telecom Services", beta: 0.861, template: "services" },
  { name: "Green / Renewable Energy", beta: 1.276, template: "manufacturing" },
  { name: "Agritech / Farming", beta: 0.665, template: "trading" },
  { name: "Media / Entertainment / OTT", beta: 0.483, template: "saas" },
];

// Same four templates as ValuationPlatform.jsx's PL_TEMPLATES, reduced to
// just the EBITDA-line formula each needs (ebt is what computeDCF reads).
const PL_TEMPLATE_KEYS = ["saas", "manufacturing", "trading", "services"];
function templateEbt(templateKey: string, r: Record<string, number>): number {
  const g = (x?: number) => x || 0;
  if (templateKey === "saas") {
    return g(r.revenue) - g(r.hosting) - g(r.emp_tech) - g(r.licenses) - g(r.sales_mktg) - g(r.gen_admin) - g(r.rd) - g(r.da) - g(r.interest);
  }
  if (templateKey === "manufacturing") {
    return g(r.revenue) - g(r.raw_mat) - g(r.direct_labour) - g(r.factory_exp) - g(r.selling_exp) - g(r.gen_admin) - g(r.da) - g(r.interest);
  }
  if (templateKey === "trading") {
    return g(r.revenue) - g(r.purchases) + g(r.inv_adj) - g(r.selling_exp) - g(r.gen_admin) - g(r.da) - g(r.interest);
  }
  // services (default)
  return g(r.revenue) - g(r.emp_cost) - g(r.delivery) - g(r.software) - g(r.admin_exp) - g(r.sales_mktg) - g(r.da) - g(r.interest);
}
function templateEbitda(templateKey: string, r: Record<string, number>): number {
  const g = (x?: number) => x || 0;
  if (templateKey === "saas") return g(r.revenue) - g(r.hosting) - g(r.emp_tech) - g(r.licenses) - g(r.sales_mktg) - g(r.gen_admin) - g(r.rd);
  if (templateKey === "manufacturing") return g(r.revenue) - g(r.raw_mat) - g(r.direct_labour) - g(r.factory_exp) - g(r.selling_exp) - g(r.gen_admin);
  if (templateKey === "trading") return g(r.revenue) - g(r.purchases) + g(r.inv_adj) - g(r.selling_exp) - g(r.gen_admin);
  return g(r.revenue) - g(r.emp_cost) - g(r.delivery) - g(r.software) - g(r.admin_exp) - g(r.sales_mktg);
}

function computeWACC(f: any) {
  const rf = parseFloat(f.rf) || RF_DEFAULT, beta = parseFloat(f.beta) || 1, erp = parseFloat(f.indiaERP) || INDIA_ERP;
  const ke = rf + beta * erp, t = (parseFloat(f.taxRate) || 26) / 100;
  const kd = (parseFloat(f.costOfDebt) || 14) * (1 - t);
  const ep = (parseFloat(f.equityPct) || 100) / 100, dp = (parseFloat(f.debtPct) || 0) / 100;
  return { ke, kd, wacc: ke * ep + kd * dp };
}

function computeAutoYear(f: any, idx: number) {
  const p = f.autoParams || {};
  const base = parseFloat(p.baseRevenue) || 0;
  const g = (parseFloat(p.revenueGrowth) || 30) / 100;
  const em = (parseFloat(p.ebitdaMargin) || 20) / 100;
  const daPct = (parseFloat(p.daPct) || 3) / 100;
  const intPct = (parseFloat(p.interestPct) || 0) / 100;
  const mult = UNIT_MULT[f.unit] || 1;
  const rev = base * Math.pow(1 + g, idx + 1) * mult;
  const ebitda = rev * em;
  const totalCost = rev - ebitda;
  const da = rev * daPct;
  const interest = rev * intPct;
  const sector = SECTORS.find((s) => s.name === f.sector);
  const tk = sector?.template || "saas";
  const row: Record<string, number> = { revenue: rev, da, interest };
  if (tk === "saas") { row.hosting = totalCost * 0.2; row.emp_tech = totalCost * 0.4; row.licenses = totalCost * 0.1; row.sales_mktg = totalCost * 0.15; row.gen_admin = totalCost * 0.1; row.rd = totalCost * 0.05; }
  else if (tk === "manufacturing") { row.raw_mat = totalCost * 0.5; row.direct_labour = totalCost * 0.2; row.factory_exp = totalCost * 0.1; row.selling_exp = totalCost * 0.1; row.gen_admin = totalCost * 0.1; }
  else if (tk === "trading") { row.purchases = totalCost * 0.7; row.inv_adj = 0; row.selling_exp = totalCost * 0.15; row.gen_admin = totalCost * 0.15; }
  else { row.emp_cost = totalCost * 0.5; row.delivery = totalCost * 0.2; row.software = totalCost * 0.1; row.admin_exp = totalCost * 0.1; row.sales_mktg = totalCost * 0.1; }
  return row;
}

function computeDCF(f: any, years: string[]) {
  const { ke, kd, wacc } = computeWACC(f);
  const wD = wacc / 100, tg = (parseFloat(f.terminalGrowth) || 4) / 100, t = (parseFloat(f.taxRate) || 26) / 100;
  const sector = SECTORS.find((s) => s.name === f.sector);
  const templateKey = sector?.template || "saas";
  const dso = parseFloat(f.dso) || 45, dpo = parseFloat(f.dpo) || 30, invD = parseFloat(f.invDays) || 0;
  let cumLoss = parseFloat(f.openingLoss) || 0;
  const rows: any[] = [];

  years.forEach((yr, i) => {
    const raw = f.forecastMode === "auto" ? computeAutoYear(f, i) : (f.forecast?.[yr] || {});
    const ebt = templateEbt(templateKey, raw);
    const ebitda = templateEbitda(templateKey, raw);
    const da = parseFloat(raw.da) || 0, interest = parseFloat(raw.interest) || 0;
    const rev = parseFloat(raw.revenue) || 0;
    let taxableIncome = ebt, setOff = 0;
    if (ebt > 0 && cumLoss > 0) { setOff = Math.min(cumLoss, ebt); taxableIncome = ebt - setOff; cumLoss -= setOff; }
    else if (ebt < 0) { cumLoss += Math.abs(ebt); }
    const tax = Math.max(0, taxableIncome) * t;
    const pat = ebt - tax;
    const cogsProxy = rev * 0.35;
    const nwc = (rev * dso) / 365 + (cogsProxy * invD) / 365 - (cogsProxy * dpo) / 365;
    const prevRev = i > 0 ? (parseFloat((f.forecastMode === "auto" ? computeAutoYear(f, i - 1) : (f.forecast?.[years[i - 1]] || {})).revenue) || 0) : 0;
    const prevNWC = i === 0 ? (parseFloat(f.baseNWC) || 0) : (prevRev * dso) / 365 + (prevRev * 0.35 * invD) / 365 - (prevRev * 0.35 * dpo) / 365;
    const dnwc = nwc - prevNWC;
    const capex = parseFloat(f.capex?.[yr]) || 0;
    const intNetTax = interest * (1 - t);
    const fcff = pat + da + intNetTax - capex - dnwc;
    rows.push({ yr, rev, ebitda, ebt, tax, pat, da, interest, capex, dnwc, fcff, nwc });
  });

  const pvF = [0.75, 1.75, 2.75, 3.75, 4.75, 5.75, 6.75, 7.75, 8.75, 9.75].slice(0, years.length).map((y) => 1 / Math.pow(1 + wD, y));
  const pvFCFF = rows.map((r, i) => r.fcff * pvF[i]);
  const sumPV = pvFCFF.reduce((a, b) => a + b, 0);
  const lastFCFF = rows[rows.length - 1]?.fcff || 0;
  const tv = wD > tg && wD - tg > 0.001 ? (lastFCFF * (1 + tg)) / (wD - tg) : 0;
  const pvTV = tv * pvF[years.length - 1];
  const ev = sumPV + pvTV;
  const debt = parseFloat(f.debt) || 0, cash = parseFloat(f.cash) || 0;
  const eqVal = ev - debt + cash;
  const shares = parseFloat(f.numShares) || 1;
  return { rows, sumPV, tv, pvTV, ev, eqVal, vps: eqVal / shares, wacc, ke, kd };
}

function computeSensitivity(f: any, years: string[]) {
  const wAdj = [-2, 0, 2], tAdj = [-1, 0, 1];
  return {
    table: wAdj.map((wa) => tAdj.map((ta) => {
      const adj = { ...f, rf: String((parseFloat(f.rf) || RF_DEFAULT) + wa), terminalGrowth: String((parseFloat(f.terminalGrowth) || 4) + ta) };
      return Math.round(computeDCF(adj, years).vps * 100) / 100;
    })),
    waccAdj: wAdj, tgAdj: tAdj,
  };
}

// From lib/financialModel.js - same math, same field names, ported as-is.
const DEP_RATES: Record<string, number> = { building: 0.10, machinery: 0.15, vehicles: 0.15, computers: 0.40, furniture: 0.10, other: 0.15 };

function computeModel(extraction: any) {
  if (!extraction) return null;
  const rev = extraction.revenue?.annualTotal || 0;
  const cogs = extraction.cogs?.annualTotal || 0;
  const opex = extraction.opex?.annualTotal || 0;
  const assets = extraction.assets || {};
  const grossBlock = Object.keys(assets).reduce((s, k) => s + (assets[k] || 0), 0);
  const dep = Object.keys(DEP_RATES).reduce((s, k) => s + (assets[k] || 0) * DEP_RATES[k], 0);

  const funding = extraction.funding || {};
  const tlRate = funding.termLoanRate || 12, tlAmt = funding.termLoanOutstanding || 0;
  const wcRate = funding.wcLoanRate || 13, wcAmt = funding.wcLoanUtilised || 0;
  const interest = (tlAmt * tlRate) / 100 + (wcAmt * wcRate) / 100;

  const gp = rev - cogs, ebitda = gp - opex, ebit = ebitda - dep, pbt = ebit - interest;
  const tax = Math.max(0, pbt) * 0.26, pat = pbt - tax;

  const wc = extraction.workingCapital || {};
  const recDays = wc.receivableDays || 30, payDays = wc.payableDays || 15, invDays = wc.inventoryDays || 0;
  const receivables = (rev * recDays) / 365, payables = (cogs * payDays) / 365;
  const inventory = wc.closingStock || (cogs * invDays) / 365;
  const nwc = receivables + inventory - payables;

  const proj = extraction.projections || {};
  const gRates = [1, 2, 3, 4, 5].map((n) => (proj[`year${n}GrowthPct`] || 15) / 100);
  const cogsPct = rev > 0 ? cogs / rev : 0.5;

  const years = gRates.map((_, i) => {
    let r = rev;
    for (let j = 0; j <= i; j++) r = r * (1 + gRates[j]);
    const c = r * cogsPct, ox = opex * Math.pow(1.08, i);
    const gpYr = r - c, eYr = gpYr - ox, ebitYr = eYr - dep, pbtYr = ebitYr - interest;
    const taxYr = Math.max(0, pbtYr) * 0.26, patYr = pbtYr - taxYr;
    const capYr = (proj.plannedCapex || 0) / 5;
    const nwcYr = (r * recDays) / 365 + (c * invDays) / 365 - (c * payDays) / 365;
    const prevRev = i === 0 ? rev : rev * gRates.slice(0, i).reduce((acc, gg) => acc * (1 + gg), 1);
    const prevNWC = (prevRev * recDays) / 365;
    const dnwc = nwcYr - prevNWC;
    const fcff = patYr + dep + interest * 0.74 - capYr - dnwc;
    return { yr: "FY" + (2027 + i), rev: r, cogs: c, gp: gpYr, opex: ox, ebitda: eYr, dep, ebit: ebitYr, interest, pbt: pbtYr, tax: taxYr, pat: patYr, capex: capYr, dnwc, fcff };
  });

  return {
    base: { rev, cogs, gp, opex, ebitda, dep, ebit, interest, pbt, tax, pat },
    wc: { receivables, payables, inventory, nwc },
    grossBlock, dep, years,
    segments: extraction.revenue?.segments || [],
  };
}

// ============================================================================
// SECTION 2 — Static benchmark table (feedback: "research relevant
// benchmarks"). This is a curated starting point, not live market data - the
// AI is instructed to always disclose these as "typical range" estimates,
// never as company-specific facts. Extend this table over time rather than
// wiring in live web research, which adds cost/latency/reliability risk for
// a first version.
// ============================================================================

const BENCHMARKS: Record<string, Record<string, string>> = {
  "saas": { revenue_growth: "40-100% (early stage), 25-50% (growth stage)", gross_margin: "70-85%", ebitda_margin: "(-20%)-30% (often negative pre-scale)", ev_ebitda_multiple: "N/A pre-profit; EV/Revenue 4-8x typical for growth-stage Indian SaaS", working_capital_days: "receivables 30-60 days (enterprise), near-zero (self-serve)" },
  "manufacturing": { revenue_growth: "10-20%", gross_margin: "20-35%", ebitda_margin: "10-20%", ev_ebitda_multiple: "6-10x", working_capital_days: "receivables 45-75, payables 30-60, inventory 30-90" },
  "trading": { revenue_growth: "8-18%", gross_margin: "8-18%", ebitda_margin: "3-10%", ev_ebitda_multiple: "5-8x", working_capital_days: "receivables 30-60, payables 30-45, inventory 20-45" },
  "services": { revenue_growth: "12-25%", gross_margin: "30-50%", ebitda_margin: "12-25%", ev_ebitda_multiple: "6-9x", working_capital_days: "receivables 45-90, payables 15-45, inventory minimal" },
  "restaurant": { revenue_growth: "10-25% (per-unit, before new locations)", gross_margin: "60-70% (food cost 30-40% of revenue)", ebitda_margin: "10-18% (mature unit)", ev_ebitda_multiple: "5-8x", working_capital_days: "receivables near-zero (cash business), payables 15-30" },
  "healthcare": { revenue_growth: "15-25%", gross_margin: "35-55%", ebitda_margin: "18-30%", ev_ebitda_multiple: "9-14x", working_capital_days: "receivables 45-75 (insurance/TPA heavy), payables 30-45" },
};

function lookupBenchmark(sectorRaw: string, metric: string) {
  const sector = (sectorRaw || "").toLowerCase();
  let key = "services";
  if (sector.includes("saas") || sector.includes("software") || sector.includes("tech")) key = "saas";
  else if (sector.includes("manufactur")) key = "manufacturing";
  else if (sector.includes("trad") || sector.includes("distribut")) key = "trading";
  else if (sector.includes("restaurant") || sector.includes("f&b") || sector.includes("hospitality") || sector.includes("food")) key = "restaurant";
  else if (sector.includes("health") || sector.includes("pharma") || sector.includes("hospital")) key = "healthcare";
  const table = BENCHMARKS[key] || BENCHMARKS.services;
  const value = table[metric] || "No curated benchmark for this metric yet - state that plainly rather than guessing a number.";
  return { sectorBucket: key, metric, value, disclosure: "typical_range_estimate_not_live_market_data" };
}

// ============================================================================
// SECTION 3 — Persona system prompts
// ============================================================================

const SHARED_PREAMBLE = `You are the AI advisor inside BuzinessDeals.com, an Indian business marketplace built by Zenius Advisors, Hyderabad. You are not a generic chatbot - you combine the perspective of a Chartered Accountant, investment banker, financial analyst, business valuation expert, and M&A advisor.

CORE PHILOSOPHY: the user explains their business or intent in natural language. You figure out how to model, analyse, or route it - the way a skilled analyst would, not by handing them a form. You have tools that run real, deterministic financial calculations (the same engine that powers this platform's valuation reports) - use them instead of computing or guessing numbers yourself in prose. Never state a specific financial output (EBITDA, valuation, WACC, sensitivity) that didn't come from a tool result.

TRANSPARENCY: for any number you use that isn't directly company-specific, say so - "based on typical industry ranges" / "this is my estimate, not a market fact." Never present an assumption as certain when it isn't.

SCOPE: you should engage substantively with business acquisition, sale, investment analysis, financial analysis, valuation, fundraising, due diligence, business modelling, investment banking concepts, financial structuring, and commercial analysis. If a question is genuinely outside that (e.g. personal tax filing, legal drafting): say so plainly, still give your best preliminary perspective, name what additional professional help is needed, and note a Zenius Advisors CA/analyst can take it further. Never just refuse.

You never auto-navigate the user to a different part of the platform. When a phase transition makes sense, call set_next_phase - the frontend always requires the user to click an explicit button before moving, so proposing it is safe and expected.`;

const PERSONA_PROMPTS: Record<string, string> = {
  discovery: `${SHARED_PREAMBLE}

PHASE: Router / discovery advisor (max ~6 exchanges before routing).
Determine within a few exchanges whether the user wants to sell/raise capital (-> analyst), buy/invest/acquire (-> buyerQualification), get a valuation without the full interview (-> valuation), or just browse (-> listings).

CONVERSATIONAL DISCOVERY: if the user describes an acquisition interest in free text, don't jump straight to a rigid Q&A. Ask 2-3 natural follow-ups to sharpen the thesis (geography, budget, majority vs minority, established vs turnaround, target revenue, product focus, strategic synergy) - pick whichever are most decision-relevant. As soon as you have sector plus at least one other constraint, call set_match_criteria, and explicitly offer to show matching listings via set_next_phase(listings). Call set_match_criteria again whenever the user adds a new constraint, even before formal buyer qualification happens.`,

  analyst: `${SHARED_PREAMBLE}

PHASE: Financial Analyst - building a seller's financial model. This is the persona that most needs to feel like a real analyst, not a spreadsheet. Do not simply ask for revenue, cost, and profit - "any competent user can build that in Excel themselves." Your job is to demonstrate you understand how this specific business works.

STEP 1: classify the business - industry and business model (SaaS/subscription, manufacturing, trading/distribution, restaurant/F&B, healthcare services, professional services, or other). This determines industryTemplate (one of: saas, manufacturing, trading, restaurant, healthcare, professional_services, other) and which questions you ask next - never ask a SaaS business about raw material cost, never ask a restaurant about churn.

STEP 2: dissect across four dimensions, 2-4 targeted questions each, selected for the classified business type:
- Revenue Drivers: what's sold, pricing basis, volume driver, customer concentration, repeat rate/churn or footfall or order frequency, channel mix.
- Cost Structure: split fixed vs variable explicitly; use the cost categories that actually apply to this business type (raw material/labour/overhead for manufacturing; hosting/support/commission for SaaS; food cost/staff/rent for restaurants; purchase/warehousing/logistics for trading).
- Operating Drivers: capacity/utilisation, bottlenecks, supplier and customer concentration, seasonality, pricing power, gross margin.
- Growth Assumptions: never accept a growth number silently. Ask what operationally supports it (new customers? new geography? capacity expansion? sales headcount? price increase? market growth?). If it looks aggressive relative to what you've learned about capacity/customers/market, say so directly and call flag_assumption_challenge.

STEP 3: before finishing, ask at least one sensitivity question tied to this business's actual risk (e.g. "what happens to margins if raw material costs rise 10%?").

You may be given a prior extraction (see PRIOR STATE in the conversation context) - if so, do not re-ask what's already known; only fill gaps and go deeper. Call record_business_understanding after every response with the FULL cumulative picture (everything known so far, not just what's new this turn) - this drives a live-updating panel the user is watching fill in as you talk, so never drop previously-recorded fields. If the user's message describes an uploaded Excel file's contents (look for an "uploadedFile" summary in context), treat it as your starting point - state what you found, and only ask about gaps or inconsistencies.

Once you have: business classified, all four dimensions covered at least partially, growth has been challenged, and one sensitivity scenario asked - call finalize_financial_model with the complete extraction. That triggers the real computation engine; you'll get the computed P&L back to narrate to the user (in Rs. Lakhs), then call set_next_phase toward valuation if appropriate.

Tone: advisory, brief on why you're asking ("I ask about capacity utilisation because it tells me whether your growth plan is credible without new capex") - this is what makes it feel like a real analyst.`,

  buyerQualification: `${SHARED_PREAMBLE}

PHASE: Buyer Qualification - building an Acquisition Brief. Cover, through real conversation not a checklist: specific business type sought, geography (and why), investment range and whether it's all-equity or includes debt, majority/minority/either, established-profitable vs turnaround-open, target revenue level, and any synergy with an existing business of theirs.

Call set_match_criteria as soon as sector plus one other constraint are known - don't wait for the full picture, the listings panel updates live from this. Call record_business_understanding-equivalent tracking is not needed here; call complete_buyer_brief once all fields are gathered, with a tier (A/B/C) and tierReason reflecting how qualified and specific the buyer's thesis is.`,

  valuation: `${SHARED_PREAMBLE}

PHASE: V3 Guide - the intelligent interface in front of ValuationPlatform V3, the platform's actual valuation engine. You do not calculate valuations in prose. You gather, explain, defend, and challenge the inputs V3 needs, and populate them via tools; compute_valuation runs the real DCF/WACC engine and gives you numbers to explain.

ENTRY: if PRIOR STATE shows a completed analyst-phase model already exists, do not re-ask what it already answered - acknowledge what you know and only ask what V3 needs beyond that (cost of capital inputs, terminal growth, methodology choice, comparable set). If there's no prior model, explain up front what's needed and why, then gather it conversationally, methodology-appropriate to the business (not a fixed generic list).

TRANSPARENCY: for every input, know whether it's company-specific, an industry benchmark (use lookup_industry_benchmark rather than inventing a number), market data, or your own estimate - call propose_valuation_input with a basis label for each one so the user always sees why a number is what it is. Never operate as an unexplained black box.

DEFEND ON REQUEST: if asked "why this growth rate / beta / EBITDA margin," explain the reasoning and data basis, and invite company-specific corrections - if given one, call propose_valuation_input again with basis "company_data".

CHALLENGE: don't accept inconsistent inputs silently - e.g. aggressive revenue growth with no matching capex/working-capital growth. Say so directly and call flag_assumption_challenge.

DYNAMIC RECALCULATION: when the user gives an instruction ("what if growth drops to 18%", "use industry average margins instead"), translate it into propose_valuation_input calls, then call compute_valuation again with the full updated input set - never estimate the new EV/equity value yourself in prose, always get it from the tool.`,

  listings: `${SHARED_PREAMBLE}

PHASE: Listings Advisor - helping a buyer evaluate specific listings. If context includes a specific listing (business_name/sector/city/financials - this happens when the user clicks "Ask AI to analyse" on a card), open by acknowledging that specific business, then assess it against any known Acquisition Brief or stated criteria: budget fit, sector fit, EBITDA multiple relative to sector norms (use lookup_industry_benchmark), red flags worth diligence. If asked to compare listings, do so with actual numbers.`,
};

// ============================================================================
// SECTION 4 — Tool definitions (Anthropic tool-use schema)
// ============================================================================

const TOOLS: Record<string, any> = {
  record_business_understanding: {
    name: "record_business_understanding",
    description: "Record the FULL cumulative picture of the seller's business gathered so far in this conversation (not just what's new this turn - always the complete merged state). Drives a live-updating panel the user is watching fill in.",
    input_schema: {
      type: "object",
      properties: {
        industryTemplate: { type: "string", enum: ["saas", "manufacturing", "trading", "restaurant", "healthcare", "professional_services", "other"] },
        businessProfile: { type: "object", description: "{name, sector, businessType, yearsOperating}" },
        revenue: { type: "object", description: "{annualTotal (Rs Lakhs), collectionDays, segments: [{product, monthlyRevenue}]}" },
        revenueDrivers: { type: "object", description: "{customerConcentration, repeatPurchaseRatePct, avgOrderValue, salesCycleDays, channels: [{name, revSharePct}]}" },
        cogs: { type: "object", description: "{annualTotal (Rs Lakhs), lineItems: [{item, monthlyAmount}]}" },
        opex: { type: "object", description: "{annualTotal (Rs Lakhs), lineItems: [{item, monthlyAmount}]}" },
        operatingDrivers: { type: "object", description: "{capacityUtilisationPct, bottleneck, supplierConcentration, seasonality, pricingPower, grossMarginPct, operatingLeverage}" },
        workingCapital: { type: "object", description: "{receivableDays, payableDays, inventoryDays, closingStock}" },
        assets: { type: "object", description: "{building, machinery, vehicles, computers, furniture, other} - Rs Lakhs, gross block" },
        funding: { type: "object", description: "{equity, termLoanOutstanding, termLoanRate, wcLoanUtilised, wcLoanRate}" },
        growthAssumptions: { type: "object", description: "{projectedGrowthPct, drivers: [string], challenged: bool, challengeNotes}" },
        sensitivityFlags: { type: "object", description: "{revenueDownside, marginCompression, workingCapitalStrain} - free text notes" },
        projections: { type: "object", description: "{year1GrowthPct..year5GrowthPct, plannedCapex}" },
      },
      required: ["industryTemplate", "businessProfile"],
    },
  },
  finalize_financial_model: {
    name: "finalize_financial_model",
    description: "Run the real financial model computation engine once the business understanding is complete enough (classified, four dimensions covered, growth challenged, one sensitivity asked). Returns the computed P&L for you to narrate. Pass the same full extraction shape as record_business_understanding.",
    // Placeholder - reassigned immediately below to record_business_understanding's
    // schema, once TOOLS itself finishes constructing (see the fix-up line after
    // this object literal). Avoids duplicating the schema and risking drift.
    input_schema: { type: "object", properties: {} },
  },
  set_match_criteria: {
    name: "set_match_criteria",
    description: "Signal that enough context exists to filter the listings panel, even before a full buyer qualification completes. Call again whenever criteria change.",
    input_schema: {
      type: "object",
      properties: {
        sector: { type: "array", items: { type: "string" } },
        geography: { type: "array", items: { type: "string" } },
        budgetLakhsMin: { type: "number" },
        budgetLakhsMax: { type: "number" },
        dealStructure: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
  complete_buyer_brief: {
    name: "complete_buyer_brief",
    description: "Finalize the Acquisition Brief once all fields are gathered.",
    input_schema: {
      type: "object",
      properties: {
        buyerType: { type: "string" },
        sector: { type: "array", items: { type: "string" } },
        geography: { type: "array", items: { type: "string" } },
        budgetLakhsMin: { type: "number" },
        budgetLakhsMax: { type: "number" },
        dealStructure: { type: "string" },
        timeline: { type: "string" },
        firstTimeBuyer: { type: "boolean" },
        tier: { type: "string", enum: ["A", "B", "C"] },
        tierReason: { type: "string" },
      },
      required: ["buyerType", "sector", "tier"],
    },
  },
  lookup_industry_benchmark: {
    name: "lookup_industry_benchmark",
    description: "Look up a curated typical-range benchmark for a sector/metric, instead of guessing a number. Always disclose the result as a typical range, not a company-specific fact.",
    input_schema: {
      type: "object",
      properties: {
        sector: { type: "string" },
        metric: { type: "string", enum: ["revenue_growth", "gross_margin", "ebitda_margin", "ev_ebitda_multiple", "working_capital_days"] },
      },
      required: ["sector", "metric"],
    },
  },
  propose_valuation_input: {
    name: "propose_valuation_input",
    description: "Record one valuation input field with its basis, so the user always sees why a number is what it is. Call once per field.",
    input_schema: {
      type: "object",
      properties: {
        field: { type: "string", description: "e.g. beta, terminalGrowth, rf, costOfDebt, taxRate, equityPct, debtPct, revenueGrowthY1" },
        value: {},
        basis: { type: "string", enum: ["company_data", "industry_benchmark", "market_data", "ai_estimate"] },
        rationale: { type: "string" },
      },
      required: ["field", "value", "basis", "rationale"],
    },
  },
  compute_valuation: {
    name: "compute_valuation",
    description: "Run the real DCF/WACC/sensitivity engine (the same one ValuationPlatform V3 uses) on the current set of valuation inputs. Never estimate EV/equity value/VPS yourself - always get it from this tool.",
    input_schema: {
      type: "object",
      properties: {
        sector: { type: "string" },
        rf: { type: "number" }, beta: { type: "number" }, indiaERP: { type: "number" },
        costOfDebt: { type: "number" }, equityPct: { type: "number" }, debtPct: { type: "number" },
        taxRate: { type: "number" }, terminalGrowth: { type: "number" },
        dso: { type: "number" }, dpo: { type: "number" }, invDays: { type: "number" },
        debt: { type: "number" }, cash: { type: "number" }, numShares: { type: "number" },
        unit: { type: "string", enum: ["Actual", "Thousands", "Lakhs", "Crores", "Millions"] },
        forecastYears: { type: "number", description: "3, 5, 7 or 10" },
        autoParams: { type: "object", description: "{baseRevenue, revenueGrowth (pct), ebitdaMargin (pct), daPct, interestPct} - used when you don't have a full manual year-by-year forecast yet" },
      },
      required: ["sector"],
    },
  },
  flag_assumption_challenge: {
    name: "flag_assumption_challenge",
    description: "Mark that you are pushing back on a user-provided assumption rather than accepting it silently. Also say this in your reply text - this just lets the UI highlight the moment.",
    input_schema: {
      type: "object",
      properties: { assumption: { type: "string" }, concern: { type: "string" } },
      required: ["assumption", "concern"],
    },
  },
  set_next_phase: {
    name: "set_next_phase",
    description: "Propose a phase transition. The user must still explicitly click to move - this never auto-navigates.",
    input_schema: {
      type: "object",
      properties: {
        nextPhase: { type: "string", enum: ["discovery", "analyst", "buyerQualification", "valuation", "listings"] },
        actionLabel: { type: "string", description: "button text, e.g. 'Start financial interview →'" },
      },
      required: ["nextPhase", "actionLabel"],
    },
  },
};

// finalize_financial_model takes the identical shape to record_business_understanding -
// assigned here (rather than duplicated above) so the two schemas can't drift apart.
TOOLS.finalize_financial_model.input_schema = TOOLS.record_business_understanding.input_schema;

const TOOLS_BY_PERSONA: Record<string, string[]> = {
  discovery: ["set_match_criteria", "set_next_phase"],
  analyst: ["record_business_understanding", "finalize_financial_model", "flag_assumption_challenge", "lookup_industry_benchmark", "set_next_phase"],
  buyerQualification: ["set_match_criteria", "complete_buyer_brief", "set_next_phase"],
  valuation: ["lookup_industry_benchmark", "propose_valuation_input", "compute_valuation", "flag_assumption_challenge", "set_next_phase"],
  listings: ["lookup_industry_benchmark", "set_next_phase"],
};

// ============================================================================
// SECTION 5 — Anthropic call + agent loop
// ============================================================================

async function callAnthropic(system: string, messages: any[], tools: any[]) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1600,
      system,
      messages,
      tools,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 500)}`);
  }
  return res.json();
}

type AgentState = {
  extraction?: any;
  model?: any;
  brief?: any;
  matchCriteria?: any;
  v3Updates: any[];
  valuationResult?: any;
  challenges: any[];
  benchmarksUsed: any[];
  nextPhase?: string;
  action?: { type: string; label: string };
};

function executeTool(name: string, input: any, state: AgentState): string {
  switch (name) {
    case "record_business_understanding": {
      state.extraction = input;
      const dims = ["businessProfile", "revenue", "cogs", "opex", "workingCapital", "revenueDrivers", "operatingDrivers", "growthAssumptions"];
      const missing = dims.filter((d) => !input[d] || Object.keys(input[d]).length === 0);
      return JSON.stringify({ recorded: true, stillMissing: missing.length ? missing : "none - ready to finalize if a sensitivity scenario has been asked" });
    }
    case "finalize_financial_model": {
      state.extraction = input;
      const computed = computeModel(input);
      state.model = input; // frontend contract: `model` is the raw extraction; Platform.jsx runs computeModel() itself client-side too
      return JSON.stringify({ computed });
    }
    case "set_match_criteria": {
      state.matchCriteria = input;
      return JSON.stringify({ acknowledged: true });
    }
    case "complete_buyer_brief": {
      state.brief = input;
      return JSON.stringify({ acknowledged: true });
    }
    case "lookup_industry_benchmark": {
      const result = lookupBenchmark(input.sector, input.metric);
      state.benchmarksUsed.push(result);
      return JSON.stringify(result);
    }
    case "propose_valuation_input": {
      state.v3Updates.push(input);
      return JSON.stringify({ recorded: true });
    }
    case "compute_valuation": {
      const years = Array.from({ length: input.forecastYears || 5 }, (_, i) => `FY${2027 + i}-${String((2027 + i + 1)).slice(2)}`);
      const f = {
        sector: input.sector, rf: input.rf, beta: input.beta, indiaERP: input.indiaERP,
        costOfDebt: input.costOfDebt, equityPct: input.equityPct ?? 100, debtPct: input.debtPct ?? 0,
        taxRate: input.taxRate ?? 26, terminalGrowth: input.terminalGrowth ?? 4,
        dso: input.dso ?? 45, dpo: input.dpo ?? 30, invDays: input.invDays ?? 0,
        debt: input.debt ?? 0, cash: input.cash ?? 0, numShares: input.numShares ?? 1,
        unit: input.unit || "Lakhs", forecastMode: "auto", autoParams: input.autoParams || {}, forecast: {}, capex: {},
      };
      const dcf = computeDCF(f, years);
      const sensitivity = computeSensitivity(f, years);
      state.valuationResult = { ev: dcf.ev, eqVal: dcf.eqVal, vps: dcf.vps, wacc: dcf.wacc, ke: dcf.ke, kd: dcf.kd, years: dcf.rows, sensitivity };
      return JSON.stringify(state.valuationResult);
    }
    case "flag_assumption_challenge": {
      state.challenges.push(input);
      return JSON.stringify({ recorded: true });
    }
    case "set_next_phase": {
      state.nextPhase = input.nextPhase;
      state.action = { type: input.nextPhase, label: input.actionLabel };
      return JSON.stringify({ recorded: true });
    }
    default:
      return JSON.stringify({ error: "unknown tool " + name });
  }
}

async function runAgentLoop(persona: string, system: string, messages: any[]) {
  const toolNames = TOOLS_BY_PERSONA[persona] || TOOLS_BY_PERSONA.discovery;
  const tools = toolNames.map((n) => TOOLS[n]);
  const state: AgentState = { v3Updates: [], challenges: [], benchmarksUsed: [] };
  let working = messages.slice();
  let finalText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await callAnthropic(system, working, tools);
    const content = resp.content || [];
    const toolUses = content.filter((c: any) => c.type === "tool_use");
    const textBlocks = content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n\n");

    if (toolUses.length === 0) {
      finalText = textBlocks;
      break;
    }

    // Assistant turn with tool_use blocks must be appended before tool_results.
    working.push({ role: "assistant", content });
    const toolResults = toolUses.map((tu: any) => ({
      type: "tool_result",
      tool_use_id: tu.id,
      content: executeTool(tu.name, tu.input, state),
    }));
    working.push({ role: "user", content: toolResults });

    if (textBlocks) finalText = textBlocks; // keep latest narration in case we hit the round cap
    if (round === MAX_TOOL_ROUNDS - 1) {
      // Force a final narration-only turn so the user isn't left without a reply.
      working.push({ role: "user", content: "Please summarise where things stand for the user now, in plain text, no further tool calls." });
      const closer = await callAnthropic(system, working, []);
      finalText = (closer.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n\n") || finalText;
    }
  }

  return { reply: finalText || "I'm having trouble putting that together right now - could you rephrase, or try again in a moment?", state };
}

// ============================================================================
// SECTION 6 — Conversation persistence (best-effort, matches the schema the
// frontend already reads: session_id, user_id, messages, updated_at)
// ============================================================================

async function persistConversation(sessionId: string, userId: string | null, messages: any[]) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !sessionId) return;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  };
  try {
    const getRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_conversations?session_id=eq.${encodeURIComponent(sessionId)}&order=updated_at.desc&limit=1`,
      { headers },
    );
    const rows = await getRes.json().catch(() => []);
    const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

    if (existing) {
      await fetch(`${SUPABASE_URL}/rest/v1/ai_conversations?id=eq.${existing.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          messages,
          updated_at: new Date().toISOString(),
          ...(userId && !existing.user_id ? { user_id: userId } : {}),
        }),
      });
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/ai_conversations`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          session_id: sessionId,
          user_id: userId,
          messages,
          updated_at: new Date().toISOString(),
        }),
      });
    }
  } catch (_err) {
    // best-effort - never fail the user-facing response over persistence
  }
}

// ============================================================================
// SECTION 7 — HTTP handler
// ============================================================================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const {
      message,
      history = [],
      userContext = "",
      sessionId,
      userId = null,
      conversationPhase = "discovery",
      exchangeCount = 0,
      priorExtraction = null,
      priorModel = null,
      priorBrief = null,
    } = body || {};

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "message is required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      });
    }

    // Defense-in-depth: the frontend already blocks input at 5 anonymous
    // exchanges, but a direct API call shouldn't bypass it.
    if (!userId && exchangeCount >= MAX_ANON_EXCHANGES) {
      return new Response(JSON.stringify({
        reply: "You've reached the free preview limit. Create a free account to continue - your conversation will be saved exactly where we left off.",
        action: { type: "signup", label: "Create free account" },
      }), { headers: { ...CORS_HEADERS, "content-type": "application/json" } });
    }

    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured on this function" }), {
        status: 500,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      });
    }

    const persona = PERSONA_PROMPTS[conversationPhase] ? conversationPhase : "discovery";
    let system = PERSONA_PROMPTS[persona];

    const priorStateParts: string[] = [];
    if (priorExtraction) priorStateParts.push(`PRIOR EXTRACTION (merge into, never drop fields from):\n${JSON.stringify(priorExtraction)}`);
    if (priorModel) priorStateParts.push(`PRIOR COMPLETED MODEL EXISTS:\n${JSON.stringify(priorModel)}`);
    if (priorBrief) priorStateParts.push(`PRIOR ACQUISITION BRIEF:\n${JSON.stringify(priorBrief)}`);
    if (userContext) priorStateParts.push(`ADDITIONAL CONTEXT:\n${userContext}`);
    if (priorStateParts.length) system += `\n\n=== PRIOR STATE / CONTEXT ===\n${priorStateParts.join("\n\n")}`;

    const anthropicMessages = [
      ...history.map((h: any) => ({ role: h.role === "user" ? "user" : "assistant", content: h.content ?? h.text ?? "" })),
      { role: "user", content: message },
    ];

    const { reply, state } = await runAgentLoop(persona, system, anthropicMessages);

    const fullMessages = [
      ...history.map((h: any) => ({ role: h.role === "user" ? "user" : "assistant", text: h.content ?? h.text ?? "" })),
      { role: "user", text: message },
      { role: "assistant", text: reply },
    ];
    // Fire-and-forget - don't make the user wait on persistence.
    persistConversation(sessionId, userId, fullMessages);

    const response: Record<string, any> = { reply };
    if (state.extraction) response.extraction = state.extraction;
    if (state.model) response.model = state.model;
    if (state.brief) response.brief = state.brief;
    if (state.matchCriteria) response.matchCriteria = state.matchCriteria;
    if (state.v3Updates.length) response.v3Updates = state.v3Updates;
    if (state.valuationResult) response.valuationResult = state.valuationResult;
    if (state.challenges.length) response.challenges = state.challenges;
    if (state.benchmarksUsed.length) response.benchmarksUsed = state.benchmarksUsed;
    if (state.action) response.action = state.action;
    if (state.nextPhase) response.nextPhase = state.nextPhase;

    return new Response(JSON.stringify(response), {
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  } catch (err) {
    console.error("ai-search-v2 error:", err);
    return new Response(JSON.stringify({
      reply: "Something went wrong reaching the AI advisor. Please try again in a moment.",
      error: String((err as Error)?.message || err),
    }), {
      status: 200, // 200 so the frontend's existing error handling (which only checks res.ok) doesn't need special-casing; the `error` field is diagnostic
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }
});

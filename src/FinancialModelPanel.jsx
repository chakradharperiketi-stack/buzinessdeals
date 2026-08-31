// RightPanel view for convPhase === 'analyst'.
// Renders live from convExtraction (updated after every AI response, per
// the Financial Analyst persona's EXTRACTION tag) and convModel (populated
// once all 13 questions are answered and the MODEL tag fires). Pure
// presentational component - no chat, no network calls; Platform.jsx owns
// the data and passes it down.

import { useState } from 'react';
import { computeModel, computeMetrics } from './lib/financialModel';
import { generateFinancialReport } from './lib/reportApi';
import FinancialReportPreview from './FinancialReportPreview';

// Lakhs-denominated figures always show 2 decimals - at this scale a whole
// number hides real precision (Rs. 42 L vs Rs. 42.35 L is a material
// difference). Every monetary field the analyst tool records - annualTotal,
// lineItem monthlyAmount, segment monthlyRevenue - is in Rs Lakhs (see the
// tool schema in ai-search-v2/index.ts); cogsRows/opexRows/revenueRows below
// used to assume some of these were plain rupees, which rendered a Rs 2L/mo
// line item as "Rs. 24/yr" instead of "Rs. 24.00 L/yr" - fixed by running
// every one of them through fmtLakhs consistently.
function fmtLakhs(v) {
  if (v == null || v === '' || isNaN(v) || Number(v) === 0) return null;
  return 'Rs. ' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' L';
}
function fmtDays(v) {
  if (v == null || v === '' || isNaN(v) || Number(v) === 0) return null;
  return Number(v) + ' days';
}
function fmtPct(v) {
  if (v == null || v === '' || isNaN(v)) return null;
  return Number(v) + '%';
}
function fmtText(v) {
  if (!v) return null;
  return String(v);
}
function fmtYears(v) {
  if (v == null || v === '' || isNaN(v) || Number(v) === 0) return null;
  return Number(v) + ' yrs';
}

// Builds the five sections' rows from whichever data we have (partial
// convExtraction mid-interview, or the completed convModel). Dynamic list
// rows (revenue segments, cost line items) expand to one row per item so
// the panel visibly grows as the interview progresses - the same "watch it
// fill in live" behaviour the spec describes.
function buildSections(data) {
  var bp = (data && data.businessProfile) || {};
  var rev = (data && data.revenue) || {};
  var cogs = (data && data.cogs) || {};
  var opex = (data && data.opex) || {};
  var wc = (data && data.workingCapital) || {};
  var assets = (data && data.assets) || {};
  var funding = (data && data.funding) || {};

  var revenueRows = (rev.segments || []).map(function (s, i) {
    var label = s.product || 'Revenue segment ' + (i + 1);
    var val = s.monthlyRevenue || (s.monthlyQty || 0) * (s.pricePerUnit || 0);
    return { label: label, value: fmtLakhs(val * 12), confirmed: !!val };
  });

  var cogsRows = (cogs.lineItems || []).map(function (l, i) {
    return { label: l.item || 'Direct cost ' + (i + 1), value: fmtLakhs(l.monthlyAmount * 12), confirmed: !!l.monthlyAmount };
  });
  var opexRows = (opex.lineItems || []).map(function (l, i) {
    return { label: l.item || 'Operating expense ' + (i + 1), value: fmtLakhs(l.monthlyAmount * 12), confirmed: !!l.monthlyAmount };
  });

  return [
    {
      key: 'overview', title: 'Business overview',
      rows: [
        { label: 'Business name', value: fmtText(bp.name), confirmed: !!bp.name },
        { label: 'Sector', value: fmtText(bp.sector), confirmed: !!bp.sector },
        { label: 'Business type', value: fmtText(bp.businessType), confirmed: !!bp.businessType },
        { label: 'Years operating', value: fmtYears(bp.yearsOperating), confirmed: !!bp.yearsOperating },
      ],
    },
    {
      key: 'revenue', title: 'Revenue build-up',
      rows: revenueRows.concat([
        { label: 'Annual revenue', value: fmtLakhs(rev.annualTotal), confirmed: !!rev.annualTotal },
        { label: 'Collection days', value: fmtDays(rev.collectionDays), confirmed: !!rev.collectionDays },
      ]),
    },
    {
      key: 'costs', title: 'Cost structure',
      rows: cogsRows.concat(opexRows).concat([
        { label: 'Total direct costs', value: fmtLakhs(cogs.annualTotal), confirmed: !!cogs.annualTotal },
        { label: 'Total operating expenses', value: fmtLakhs(opex.annualTotal), confirmed: !!opex.annualTotal },
      ]),
    },
    {
      key: 'wc', title: 'Working capital',
      rows: [
        { label: 'Receivable days', value: fmtDays(wc.receivableDays), confirmed: !!wc.receivableDays },
        { label: 'Payable days', value: fmtDays(wc.payableDays), confirmed: !!wc.payableDays },
        { label: 'Inventory days', value: fmtDays(wc.inventoryDays), confirmed: !!wc.inventoryDays },
      ],
    },
    {
      key: 'assets', title: 'Assets and funding',
      rows: [
        { label: 'Fixed assets (total)', value: fmtLakhs(['building', 'machinery', 'vehicles', 'computers', 'furniture', 'other'].reduce(function (s, k) { return s + (assets[k] || 0); }, 0)), confirmed: ['building', 'machinery', 'vehicles', 'computers', 'furniture', 'other'].some(function (k) { return assets[k]; }) },
        { label: 'Owner equity', value: fmtLakhs(funding.equity), confirmed: !!funding.equity },
        { label: 'Term loan outstanding', value: fmtLakhs(funding.termLoanOutstanding), confirmed: funding.termLoanOutstanding != null },
        { label: 'Working capital loan', value: fmtLakhs(funding.wcLoanUtilised), confirmed: funding.wcLoanUtilised != null },
      ],
    },
  ];
}

var MONTHS_SHORT = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

// Monthly grid cells are Rs Lakhs too - same 2-decimal rule as fmtLakhs.
function fmtNum(v) {
  return Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Renders the bottom-up build-up (capacityBuildUp for revenue, staffingBuildUp
// for cost) as an actual Apr-Mar grid - one row per service line/role, a
// totals row, computed server-side by ai-search-v2 (never client math). Only
// renders once the server has actually returned monthlyValues; before that,
// the plain waiting-list Row above still covers the field.
function MonthlyGrid({ title, buildUp, lineKey, lineLabelKey }) {
  if (!buildUp || !Array.isArray(buildUp.monthlyTotal)) return null;
  var lines = buildUp[lineKey] || [];
  return (
    <div style={{ marginTop: '4px', marginBottom: '12px' }}>
      <p style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', margin: '0 0 6px' }}>{title} (Rs. Lakhs, Apr-Mar)</p>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '11px', minWidth: '620px', width: '100%' }}>
          <thead>
            <tr style={{ background: 'var(--surface-1)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: '600', color: 'var(--text-secondary)', position: 'sticky', left: 0, background: 'var(--surface-1)', whiteSpace: 'nowrap' }}>Line</th>
              {MONTHS_SHORT.map(function (m) {
                return <th key={m} style={{ textAlign: 'right', padding: '6px 8px', fontWeight: '600', color: 'var(--text-secondary)' }}>{m}</th>;
              })}
              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: '700', color: 'var(--text-accent)', whiteSpace: 'nowrap' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(function (line, i) {
              var vals = line.monthlyValues || [];
              var lineTotal = vals.reduce(function (s, v) { return s + (v || 0); }, 0);
              return (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', color: 'var(--text-primary)', position: 'sticky', left: 0, background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>{line[lineLabelKey] || 'Line ' + (i + 1)}</td>
                  {MONTHS_SHORT.map(function (_, mi) {
                    return <td key={mi} style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-secondary)' }}>{fmtNum(vals[mi])}</td>;
                  })}
                  <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: '600', color: 'var(--text-primary)' }}>{fmtNum(lineTotal)}</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td style={{ padding: '6px 8px', fontWeight: '700', color: 'var(--text-accent)', position: 'sticky', left: 0, background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>Total</td>
              {buildUp.monthlyTotal.map(function (v, mi) {
                return <td key={mi} style={{ textAlign: 'right', padding: '6px 8px', fontWeight: '700', color: 'var(--text-accent)' }}>{fmtNum(v)}</td>;
              })}
              <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: '700', color: 'var(--text-accent)' }}>{fmtNum(buildUp.annualTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 5-Year Financial Projection - computeModel()'s `years` array already
// carried this math (it's what feeds valuation-handoff and V3), it just
// never had anywhere to render. Pure deterministic output, no AI narration
// of the numbers themselves - only shown once the model is finalized, since
// projecting off a half-built extraction would be misleading.
var YEAR_ROW_DEFS = [
  { key: 'rev', label: 'Revenue', pct: false },
  { key: 'cogs', label: 'Direct costs', pct: false },
  { key: 'gp', label: 'Gross profit', pct: false, bold: true },
  { key: 'opex', label: 'Operating expenses', pct: false },
  { key: 'ebitda', label: 'EBITDA', pct: false, bold: true, highlight: true },
  { key: 'ebitdaPct', label: 'EBITDA margin', pct: true },
  { key: 'dep', label: 'Depreciation', pct: false },
  { key: 'interest', label: 'Finance cost', pct: false },
  { key: 'pbt', label: 'Profit before tax', pct: false },
  { key: 'tax', label: 'Tax', pct: false },
  { key: 'pat', label: 'Profit after tax', pct: false, bold: true },
];

function ProjectionTable({ computed }) {
  if (!computed || !computed.years || !computed.years.length) return null;
  var base = computed.base;
  var baseRow = { yr: 'Current', rev: base.rev, cogs: base.cogs, gp: base.gp, opex: base.opex, ebitda: base.ebitda, dep: base.dep, interest: base.interest, pbt: base.pbt, tax: base.tax, pat: base.pat };
  var cols = [baseRow].concat(computed.years);

  return (
    <div style={{ marginTop: '4px', marginBottom: '16px' }}>
      <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 2px' }}>5-year financial projection</p>
      <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 8px' }}>Rs. Lakhs, based on the growth and cost assumptions gathered in your interview - not a guarantee of future results.</p>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '11px', minWidth: '560px', width: '100%' }}>
          <thead>
            <tr style={{ background: 'var(--surface-1)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: '600', color: 'var(--text-secondary)', position: 'sticky', left: 0, background: 'var(--surface-1)', whiteSpace: 'nowrap' }}>Line item</th>
              {cols.map(function (c, i) {
                return <th key={i} style={{ textAlign: 'right', padding: '6px 8px', fontWeight: '600', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{c.yr}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {YEAR_ROW_DEFS.map(function (rd) {
              return (
                <tr key={rd.key} style={{ borderTop: '1px solid var(--border)', background: rd.highlight ? 'var(--bg-accent)' : 'transparent' }}>
                  <td style={{ padding: '6px 8px', fontWeight: rd.bold ? '600' : '400', color: rd.highlight ? 'var(--text-accent)' : 'var(--text-primary)', position: 'sticky', left: 0, background: rd.highlight ? 'var(--bg-accent)' : 'var(--surface-2)', whiteSpace: 'nowrap' }}>{rd.label}</td>
                  {cols.map(function (c, i) {
                    var v = rd.pct ? (c.rev > 0 ? (c.ebitda / c.rev) * 100 : 0) : c[rd.key];
                    return (
                      <td key={i} style={{ textAlign: 'right', padding: '6px 8px', fontWeight: rd.bold ? '600' : '400', color: (v < 0) ? 'var(--text-danger, #dc2626)' : rd.highlight ? 'var(--text-accent)' : 'var(--text-primary)' }}>
                        {rd.pct ? (Math.round(v * 10) / 10) + '%' : fmtNum(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

var METRIC_DEFS = [
  { key: 'revenueCagrPct', label: 'Revenue CAGR (5-yr)', suffix: '%' },
  { key: 'ebitdaMarginCurrentPct', label: 'EBITDA margin (current)', suffix: '%' },
  { key: 'ebitdaMarginYear5Pct', label: 'EBITDA margin (year 5)', suffix: '%' },
  { key: 'patMarginCurrentPct', label: 'PAT margin (current)', suffix: '%' },
  { key: 'fixedCostRatioPct', label: 'Fixed cost / revenue', suffix: '%' },
  { key: 'variableCostRatioPct', label: 'Variable cost / revenue', suffix: '%' },
  { key: 'workingCapitalIntensityPct', label: 'Working capital / revenue', suffix: '%' },
  { key: 'receivableDays', label: 'Receivable days', suffix: ' days' },
  { key: 'payableDays', label: 'Payable days', suffix: ' days' },
];

// Only metrics whose inputs actually resolved to a number are shown - a
// business with no inventory, for instance, simply won't show a variable
// cost ratio built on a zero, rather than a misleading 0%.
function MetricsGrid({ metrics }) {
  if (!metrics) return null;
  var present = METRIC_DEFS.filter(function (m) { return metrics[m.key] != null; });
  if (!present.length) return null;
  return (
    <div style={{ marginTop: '4px', marginBottom: '16px' }}>
      <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 8px' }}>Key financial metrics</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
        {present.map(function (m) {
          return (
            <div key={m.key} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px' }}>
              <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 3px' }}>{m.label}</p>
              <p style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>{metrics[m.key]}{m.suffix}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value, confirmed }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{label}</span>
      {confirmed && value ? (
        <span style={{ fontSize: '12px', color: 'var(--text-accent)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <i className="ti ti-circle-check-filled" aria-hidden="true" style={{ fontSize: '13px', color: 'var(--text-success)' }} />
          {value}
        </span>
      ) : (
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>waiting...</span>
      )}
    </div>
  );
}

function SectionCard({ title, rows }) {
  var complete = rows.length > 0 && rows.every(function (r) { return r.confirmed; });
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 16px', marginBottom: '12px', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <p style={{ fontSize: '12px', fontWeight: '600', color: complete ? 'var(--text-success)' : 'var(--text-primary)', margin: 0 }}>{title}</p>
        {complete && <span style={{ fontSize: '11px', color: 'var(--text-success)', fontWeight: '600' }}>✓ Complete</span>}
      </div>
      {rows.map(function (r, i) { return <Row key={i} label={r.label} value={r.value} confirmed={r.confirmed} />; })}
    </div>
  );
}

export default function FinancialModelPanel({ extraction, model, onProceed, sessionId, userId, report, onReportGenerated }) {
  var data = model || extraction;
  var sections = buildSections(data || {});
  var allRows = sections.reduce(function (acc, s) { return acc.concat(s.rows); }, []);
  var confirmedCount = allRows.filter(function (r) { return r.confirmed; }).length;
  var pct = allRows.length > 0 ? Math.round((confirmedCount / allRows.length) * 100) : 0;
  var isComplete = !!model;
  var computed = isComplete ? computeModel(data) : null;
  var metrics = computed ? computeMetrics(computed) : null;

  var generatingSt = useState(false), generating = generatingSt[0], setGenerating = generatingSt[1];
  var genErrorSt = useState(''), genError = genErrorSt[0], setGenError = genErrorSt[1];

  function handleGenerateReport() {
    if (generating || !model) return;
    setGenerating(true);
    setGenError('');
    generateFinancialReport({ sessionId: sessionId, userId: userId, extraction: model })
      .then(function (r) {
        setGenerating(false);
        onReportGenerated && onReportGenerated(r);
      })
      .catch(function (err) {
        setGenerating(false);
        setGenError((err && err.message) || 'Something went wrong generating the report.');
      });
  }

  if (!data) {
    return (
      <div style={{ padding: '32px', maxWidth: '520px', margin: '80px auto 0', textAlign: 'center' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--bg-accent)', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="ti ti-report-analytics" aria-hidden="true" style={{ fontSize: '22px', color: 'var(--text-accent)' }} />
        </div>
        <h2 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 6px' }}>Financial model builder</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: '1.6' }}>
          Talk to the AI advisor on the left. As you answer, your P&L builds here, section by section.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: '640px', margin: '0 auto' }}>
      <div style={{ marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Financial model progress</p>
          <span style={{ fontSize: '12px', color: 'var(--text-accent)', fontWeight: '600' }}>{pct}%</span>
        </div>
        <div style={{ height: '6px', background: 'var(--surface-1)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: pct + '%', background: 'var(--text-accent)', borderRadius: '3px', transition: 'width 0.4s' }} />
        </div>
      </div>

      {sections.map(function (s) {
        return (
          <div key={s.key}>
            <SectionCard title={s.title} rows={s.rows} />
            {s.key === 'revenue' && <MonthlyGrid title="Revenue build-up by service line" buildUp={data && data.capacityBuildUp} lineKey="serviceLines" lineLabelKey="name" />}
            {s.key === 'costs' && <MonthlyGrid title="Staffing cost by role" buildUp={data && data.staffingBuildUp} lineKey="roles" lineLabelKey="role" />}
          </div>
        );
      })}

      {isComplete && <ProjectionTable computed={computed} />}
      {isComplete && <MetricsGrid metrics={metrics} />}

      {isComplete && (
        <div style={{ padding: '16px', background: 'var(--bg-success)', border: '1px solid var(--border-success)', borderRadius: '12px', textAlign: 'center', marginTop: '4px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-success)', fontWeight: '500', margin: '0 0 10px' }}>
            Your preliminary financial model has been prepared based on the information and assumptions gathered in this interview.
          </p>
          {pct < 100 && (
            // The AI is now instructed to cover every section (including
            // capital & funding) before finalizing, but this is a second,
            // independent line of defence: if it still finalizes early,
            // don't let the user walk into valuation thinking the model is
            // fully confirmed when the panel above it is visibly still
            // showing "waiting..." rows.
            <p style={{ fontSize: '11px', color: 'var(--text-warning, #b45309)', margin: '0 0 10px' }}>
              {allRows.length - confirmedCount} field{allRows.length - confirmedCount === 1 ? '' : 's'} above are still unconfirmed ({pct}% complete) - the report and valuation will use defaults for those until you fill them in.
            </p>
          )}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {!report && (
              <button onClick={handleGenerateReport} disabled={generating} style={{
                padding: '10px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: '500',
                background: generating ? 'var(--surface-3)' : '#16a34a', color: generating ? 'var(--text-muted)' : '#fff',
                border: 'none', cursor: generating ? 'default' : 'pointer',
              }}>{generating ? 'Preparing your report...' : 'Generate my AI Financial Model Report'}</button>
            )}
            <button onClick={onProceed} style={{
              padding: '10px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: '500',
              background: 'transparent', color: 'var(--text-success)', border: '1px solid var(--border-success)', cursor: 'pointer',
            }}>Use this model for valuation →</button>
          </div>
          {genError && <p style={{ fontSize: '11px', color: '#dc2626', margin: '10px 0 0' }}>{genError}</p>}
        </div>
      )}

      {report && <FinancialReportPreview report={report} panelCompletionPct={pct} />}
    </div>
  );
}
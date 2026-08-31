// In-app preview of the AI Financial Model Report (Phase 3 of the report
// feature - see the plan discussed with the user). Renders report.report_data
// as returned by the generate-financial-report edge function: narrative
// fields written by a single restricted AI call (see that function's
// NARRATIVE_TOOL schema - it can only emit prose, never numbers) plus
// metrics/assumptions computed deterministically server-side.
//
// This is the in-app preview, not the PDF - Phase 5 (server-rendered PDF +
// Storage) is a separate follow-up. Everything here is unlocked/free for now
// since no payment gateway exists anywhere in this app yet (see
// generate-financial-report/index.ts's header comment) - the "Next level of
// analysis" card at the bottom is the only upsell surface, and it's static
// copy, not a paywall.

var BASIS_LABELS = {
  client_confirmed: { text: 'Client confirmed', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' },
  ai_assumption: { text: 'AI estimate', color: '#b45309', bg: 'rgba(180,83,9,0.1)' },
  industry_benchmark: { text: 'Industry benchmark', color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
};

function BasisBadge({ basis }) {
  var b = BASIS_LABELS[basis] || BASIS_LABELS.ai_assumption;
  return (
    <span style={{ fontSize: '10px', fontWeight: '600', color: b.color, background: b.bg, borderRadius: '999px', padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {b.text}
    </span>
  );
}

function Card({ title, children, accent }) {
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px 18px', marginBottom: '14px' }}>
      {title && <p style={{ fontSize: '13px', fontWeight: '600', color: accent ? 'var(--text-accent)' : 'var(--text-primary)', margin: '0 0 10px' }}>{title}</p>}
      {children}
    </div>
  );
}

function AssumptionTable({ title, rows }) {
  if (!rows || !rows.length) return null;
  return (
    <div style={{ marginBottom: '14px' }}>
      <p style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{title}</p>
      <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
        {rows.map(function (r, i) {
          return (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderTop: i > 0 ? '1px solid var(--border)' : 'none', background: 'var(--surface-1)' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{r.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>{r.value}{r.unit ? ' ' + r.unit : ''}</span>
                <BasisBadge basis={r.basis} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DriverChain({ businessModel }) {
  if (!businessModel) return null;
  var steps = ['Business model', businessModel.primaryOperatingUnit || 'Operating driver', businessModel.revenueDriverFormula || 'Revenue driver', 'Financial output'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', margin: '10px 0 14px' }}>
      {steps.map(function (s, i) {
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ background: 'var(--bg-accent)', color: 'var(--text-accent)', fontSize: '11px', fontWeight: '600', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-accent)' }}>{s}</div>
            {i < steps.length - 1 && <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>&rarr;</span>}
          </div>
        );
      })}
    </div>
  );
}

function ObservationRow({ label, text }) {
  if (!text) return null;
  return (
    <div style={{ marginBottom: '10px' }}>
      <p style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-accent)', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</p>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.6' }}>{text}</p>
    </div>
  );
}

export default function FinancialReportPreview({ report, panelCompletionPct }) {
  if (!report) return null;

  if (report.status === 'failed') {
    return (
      <Card title="Report generation failed">
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
          {report.error_message || 'Something went wrong generating the narrative sections.'} The financial model above is unaffected - try generating the report again in a moment.
        </p>
      </Card>
    );
  }

  var d = report.report_data || {};
  var bp = (report.extraction && report.extraction.businessProfile) || {};
  var assumptions = d.assumptions || {};

  return (
    <div style={{ marginTop: '4px' }}>
      <div style={{ textAlign: 'center', padding: '20px 0 16px', borderBottom: '2px solid var(--border-accent)', marginBottom: '18px' }}>
        <p style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-accent)', letterSpacing: '0.08em', margin: '0 0 6px' }}>AI FINANCIAL MODEL REPORT</p>
        <p style={{ fontSize: '17px', fontWeight: '700', color: 'var(--text-primary)', margin: '0 0 4px' }}>{bp.name || 'Prepared for your business'}</p>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{bp.sector || 'Sector not specified'} &middot; Generated {d.generatedAt ? new Date(d.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}</p>
      </div>

      <Card title="Executive summary">
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.7' }}>{d.executiveSummary}</p>
      </Card>

      {d.businessModel && (
        <Card title="Business model analysis" accent>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 4px', lineHeight: '1.7' }}>{d.businessModel.summary}</p>
          <DriverChain businessModel={d.businessModel} />
        </Card>
      )}

      <Card title="Key business assumptions">
        <AssumptionTable title="Revenue" rows={assumptions.revenue} />
        <AssumptionTable title="Cost" rows={assumptions.cost} />
        <AssumptionTable title="Working capital" rows={assumptions.workingCapital} />
        <AssumptionTable title="Assets &amp; funding" rows={assumptions.assetsFunding} />
      </Card>

      {d.observations && (
        <Card title="AI financial observations">
          <ObservationRow label="Revenue" text={d.observations.revenue} />
          <ObservationRow label="Cost" text={d.observations.cost} />
          <ObservationRow label="Profitability" text={d.observations.profitability} />
          <ObservationRow label="Working capital" text={d.observations.workingCapital} />
          <ObservationRow label="Operational" text={d.observations.operational} />
        </Card>
      )}

      {!!(d.risks && d.risks.length) && (
        <Card title="Key financial risks">
          {d.risks.map(function (r, i) {
            return (
              <div key={i} style={{ marginBottom: i < d.risks.length - 1 ? '12px' : 0, paddingBottom: i < d.risks.length - 1 ? '12px' : 0, borderBottom: i < d.risks.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 3px' }}>{r.risk}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 2px' }}><strong>Why it matters:</strong> {r.whyItMatters}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}><strong>Potential impact:</strong> {r.potentialImpact}</p>
              </div>
            );
          })}
        </Card>
      )}

      <Card title="Model reliability">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '8px' }}>
          <span style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-accent)' }}>{panelCompletionPct}%</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>model completeness</span>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.7' }}>{d.modelConfidenceNarrative}</p>
      </Card>

      {!!(d.informationStillRequired && d.informationStillRequired.length) && (
        <Card title="Information that would improve reliability">
          {d.informationStillRequired.map(function (item, i) {
            return (
              <div key={i} style={{ marginBottom: '8px' }}>
                <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 2px' }}>{item.field}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>{item.whyItMatters}</p>
              </div>
            );
          })}
        </Card>
      )}

      <div style={{ background: 'var(--bg-accent)', border: '1px solid var(--border-accent)', borderRadius: '12px', padding: '16px 18px', marginBottom: '4px' }}>
        <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-accent)', margin: '0 0 8px' }}>Your current report includes</p>
        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: '1.8' }}>
          Business model analysis &middot; revenue build-up &middot; cost structure &middot; 5-year financial projections &middot; working capital observations &middot; financial risk analysis
        </p>
        <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-accent)', margin: '0 0 6px' }}>For a deeper financial model</p>
        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.8' }}>
          A full integrated Profit &amp; Loss, Balance Sheet and Cash Flow model, detailed capex and debt schedules, scenario and sensitivity analysis, and a formula-driven Excel model are available as part of the deeper financial modelling engagement.
        </p>
      </div>
    </div>
  );
}
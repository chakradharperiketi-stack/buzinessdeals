// RightPanel view for convPhase === 'buyerQualification'.
// Renders live from convExtraction (partial answers, updated after every
// response per the Buyer Qualification persona's EXTRACTION tag) and the
// final `brief` object (populated once question 7 fires the BRIEF tag).
// Pure presentational component - same pattern as FinancialModelPanel.

function fmtBudget(min, max) {
  if (!min && !max) return null;
  if (min && max) return 'Rs. ' + Number(min).toLocaleString('en-IN') + ' - ' + Number(max).toLocaleString('en-IN') + ' L';
  return 'Rs. ' + Number(min || max).toLocaleString('en-IN') + ' L';
}
function fmtList(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.join(', ');
}
function fmtText(v) {
  return v ? String(v) : null;
}

function buildFields(data) {
  if (!data) return [];
  return [
    { label: 'Intent', value: fmtText(data.buyerType), confirmed: !!data.buyerType },
    { label: 'Sectors', value: fmtList(data.sector), confirmed: !!(data.sector && data.sector.length) },
    { label: 'Budget', value: fmtBudget(data.budgetLakhsMin, data.budgetLakhsMax), confirmed: !!(data.budgetLakhsMin || data.budgetLakhsMax) },
    { label: 'Geography', value: fmtList(data.geography), confirmed: !!(data.geography && data.geography.length) },
    { label: 'Deal structure', value: fmtText(data.dealStructure), confirmed: !!data.dealStructure },
    { label: 'Timeline', value: fmtText(data.timeline), confirmed: !!data.timeline },
    { label: 'Experience', value: data.firstTimeBuyer === false ? 'Experienced buyer' : data.firstTimeBuyer === true ? 'First-time buyer' : null, confirmed: data.firstTimeBuyer != null },
  ];
}

function FieldRow({ label, value, confirmed }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px',
      background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '10px', marginBottom: '8px',
    }}>
      <span style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-secondary)' }}>{label}</span>
      {confirmed && value ? (
        <span style={{ fontSize: '12px', color: 'var(--text-accent)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <i className="ti ti-circle-check-filled" aria-hidden="true" style={{ fontSize: '13px', color: 'var(--text-success)' }} />
          {value}
        </span>
      ) : (
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Waiting...</span>
      )}
    </div>
  );
}

export default function AcquisitionBriefPanel({ extraction, brief, onProceed }) {
  var data = brief || extraction;
  var fields = buildFields(data);
  var confirmedCount = fields.filter(function (f) { return f.confirmed; }).length;
  var pct = fields.length > 0 ? Math.round((confirmedCount / fields.length) * 100) : 0;
  var isComplete = !!brief;

  if (!data) {
    return (
      <div style={{ padding: '32px', maxWidth: '520px', margin: '80px auto 0', textAlign: 'center' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--bg-accent)', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="ti ti-briefcase" aria-hidden="true" style={{ fontSize: '22px', color: 'var(--text-accent)' }} />
        </div>
        <h2 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 6px' }}>Acquisition Brief builder</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: '1.6' }}>
          Talk to the AI advisor on the left. Your Acquisition Brief fills in here as you answer.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: '560px', margin: '0 auto' }}>
      <div style={{ marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Acquisition Brief progress</p>
          <span style={{ fontSize: '12px', color: 'var(--text-accent)', fontWeight: '600' }}>{pct}%</span>
        </div>
        <div style={{ height: '6px', background: 'var(--surface-1)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: pct + '%', background: 'var(--text-accent)', borderRadius: '3px', transition: 'width 0.4s' }} />
        </div>
      </div>

      {fields.map(function (f, i) { return <FieldRow key={i} label={f.label} value={f.value} confirmed={f.confirmed} />; })}

      {data.tier && (
        <div style={{ padding: '10px 14px', background: 'var(--bg-accent)', border: '1px solid var(--border-accent)', borderRadius: '10px', marginTop: '4px', marginBottom: '4px' }}>
          <p style={{ fontSize: '11px', color: 'var(--text-accent)', margin: 0 }}>
            Tier {data.tier}{data.tierReason ? ' — ' + data.tierReason : ''}
          </p>
        </div>
      )}

      {isComplete && (
        <div style={{ padding: '16px', background: 'var(--bg-success)', border: '1px solid var(--border-success)', borderRadius: '12px', textAlign: 'center', marginTop: '12px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-success)', fontWeight: '500', margin: '0 0 10px' }}>
            Acquisition Brief ready.
          </p>
          <button onClick={onProceed} style={{
            padding: '10px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: '500',
            background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer',
          }}>Browse matched listings →</button>
        </div>
      )}
    </div>
  );
}

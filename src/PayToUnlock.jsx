// Shared paywall card - renders in place of a locked deliverable's content
// (the AI Financial Model Report's narrative sections, or the Valuation
// Report's generate/print section) until it's unlocked. See lib/payments.js
// for the actual Razorpay flow this triggers, and migration
// 003_razorpay_payments.sql for how "unlocked" is stored and secured.
import { useState } from 'react';
import { payAndUnlock } from './lib/payments';

export default function PayToUnlock({ user, deliverableType, deliverableId, amountLabel, title, description, onUnlocked }) {
  var payingSt = useState(false), paying = payingSt[0], setPaying = payingSt[1];
  var errSt = useState(''), err = errSt[0], setErr = errSt[1];

  var canPay = !!(user && user.id && deliverableId);

  function handlePay() {
    if (paying || !canPay) return;
    setPaying(true);
    setErr('');
    payAndUnlock({
      userId: user.id,
      userEmail: user.email,
      deliverableType: deliverableType,
      deliverableId: deliverableId,
      title: title,
    }).then(function (result) {
      setPaying(false);
      onUnlocked && onUnlocked(result);
    }).catch(function (e) {
      setPaying(false);
      setErr((e && e.message) || 'Payment could not be completed.');
    });
  }

  return (
    <div style={{ padding: '26px 22px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '12px', textAlign: 'center' }}>
      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--bg-accent)', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <i className="ti ti-lock" aria-hidden="true" style={{ fontSize: '18px', color: 'var(--text-accent)' }} />
      </div>
      <p style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 4px' }}>{title}</p>
      {description && (
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: '1.6', maxWidth: '440px', marginLeft: 'auto', marginRight: 'auto' }}>
          {description}
        </p>
      )}
      <button onClick={handlePay} disabled={paying || !canPay} style={{
        padding: '11px 24px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
        background: paying || !canPay ? 'var(--surface-3)' : '#2563eb',
        color: paying || !canPay ? 'var(--text-muted)' : '#fff',
        border: 'none', cursor: paying || !canPay ? 'default' : 'pointer',
      }}>
        {paying ? 'Opening secure checkout…' : 'Unlock for ' + amountLabel}
      </button>
      <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '10px 0 0' }}>Secured by Razorpay</p>
      {!canPay && !paying && (
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '10px 0 0' }}>Sign in to unlock this report.</p>
      )}
      {err && <p style={{ fontSize: '11px', color: '#dc2626', margin: '10px 0 0' }}>{err}</p>}
    </div>
  );
}
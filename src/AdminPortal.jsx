import { useState, useEffect } from 'react';
import { supabase } from './supabase';

// Admin Portal - v1 scope: Listings moderation + Leads queue. Deliberately
// left out of v1 (Supabase's own dashboard covers these meanwhile): user
// directory, payments ledger. Add as separate tabs later if needed.
//
// Security note: the isAdmin check that decides whether this component ever
// renders lives in Platform.jsx (frontend-only, cosmetic). The real gate is
// the "Admin full access" RLS policy on listings and leads (see migration
// 004_admin_portal.sql) - every query below runs through the logged-in
// user's own Supabase session, so a non-admin who somehow reached this
// screen would just get empty results / RLS errors, not real data.

function relTime(iso) {
  if (!iso) return '';
  var diffMs = Date.now() - new Date(iso).getTime();
  var mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}

var STATUS_BADGE = {
  pending_review: { bg: '#fef3c7', color: '#92400e', label: 'Pending review' },
  live: { bg: '#dcfce7', color: '#166534', label: 'Live' },
  rejected: { bg: '#fee2e2', color: '#991b1b', label: 'Rejected' },
};

function StatusBadge({ status }) {
  var s = STATUS_BADGE[status] || { bg: '#e2e8f0', color: '#475569', label: status || 'Unknown' };
  return (
    <span style={{
      fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '999px',
      background: s.bg, color: s.color, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.03em',
    }}>{s.label}</span>
  );
}

function actionBtnStyle(color) {
  return {
    fontSize: '12px', fontWeight: '600', padding: '6px 14px', borderRadius: '7px',
    border: 'none', cursor: 'pointer', background: color, color: '#fff',
  };
}

function tabBtnStyle(active) {
  return {
    fontSize: '13px', fontWeight: '600', padding: '8px 16px', border: 'none', background: 'transparent',
    color: active ? 'var(--text-accent)' : 'var(--text-muted)',
    borderBottom: active ? '2px solid var(--text-accent)' : '2px solid transparent',
    cursor: 'pointer', marginBottom: '-1px',
  };
}

function filterBtnStyle(active) {
  return {
    fontSize: '12px', fontWeight: '600', padding: '5px 12px', borderRadius: '999px', cursor: 'pointer',
    border: active ? '1.5px solid var(--text-accent)' : '1.5px solid var(--border)',
    background: active ? 'var(--bg-accent)' : 'transparent',
    color: active ? 'var(--text-accent)' : 'var(--text-secondary)',
  };
}

function ListingRow({ row, adminEmail, onUpdated }) {
  var savingSt = useState(false), saving = savingSt[0], setSaving = savingSt[1];
  var reasonSt = useState(''), reason = reasonSt[0], setReason = reasonSt[1];
  var showReasonSt = useState(false), showReason = showReasonSt[0], setShowReason = showReasonSt[1];
  var errSt = useState(''), err = errSt[0], setErr = errSt[1];

  function updateStatus(nextStatus, extra) {
    setSaving(true);
    setErr('');
    var patch = Object.assign({
      status: nextStatus,
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminEmail || null,
    }, extra || {});
    supabase.from('listings').update(patch).eq('id', row.id).select().single()
      .then(function (res) {
        setSaving(false);
        if (res.error) { setErr(res.error.message); return; }
        setShowReason(false);
        setReason('');
        onUpdated(res.data || Object.assign({}, row, patch));
      })
      .catch(function (e) { setSaving(false); setErr((e && e.message) || 'Update failed.'); });
  }

  function approve() { updateStatus('live', { listed_at: new Date().toISOString(), rejection_reason: null }); }
  function reject() {
    if (!showReason) { setShowReason(true); return; }
    updateStatus('rejected', { rejection_reason: reason || null });
  }
  function revert() { updateStatus('pending_review', {}); }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px', marginBottom: '10px', background: 'var(--surface-1)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>{row.business_name || 'Untitled business'}</span>
            <StatusBadge status={row.status} />
            {row.verification_status === 'verified'
              ? <span style={{ fontSize: '10px', fontWeight: '700', color: '#166534', background: '#dcfce7', padding: '2px 8px', borderRadius: '999px' }}>Verified</span>
              : <span style={{ fontSize: '10px', fontWeight: '700', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '999px' }}>Self-reported</span>}
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {[row.sector, row.city, row.state].filter(Boolean).join(' · ')}{row.created_at ? ' · ' + relTime(row.created_at) : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-secondary)', flexShrink: 0 }}>
          <span>Revenue: {row.revenue_lakhs != null ? row.revenue_lakhs + 'L' : '—'}</span>
          <span>EBITDA: {row.ebitda_lakhs != null ? row.ebitda_lakhs + 'L' : '—'}</span>
          <span>Ask: {row.asking_price_lakhs != null ? row.asking_price_lakhs + 'L' : '—'}</span>
        </div>
      </div>

      {row.description && (
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '10px 0 0', lineHeight: '1.5' }}>{row.description}</p>
      )}
      {row.rejection_reason && (
        <p style={{ fontSize: '12px', color: '#991b1b', margin: '8px 0 0' }}>Rejection reason: {row.rejection_reason}</p>
      )}
      {err && <p style={{ fontSize: '12px', color: '#991b1b', margin: '8px 0 0' }}>{err}</p>}

      {showReason && (
        <div style={{ marginTop: '10px' }}>
          <input
            value={reason}
            onChange={function (e) { setReason(e.target.value); }}
            placeholder="Reason for rejection (internal record)"
            style={{ width: '100%', fontSize: '12px', padding: '7px 10px', borderRadius: '7px', border: '1.5px solid var(--border)', boxSizing: 'border-box' }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
        {row.status === 'pending_review' && (
          <>
            <button disabled={saving} onClick={approve} style={actionBtnStyle('#16a34a')}>{saving ? 'Saving…' : 'Approve'}</button>
            <button disabled={saving} onClick={reject} style={actionBtnStyle('#dc2626')}>{showReason ? 'Confirm reject' : 'Reject'}</button>
          </>
        )}
        {row.status === 'live' && (
          <button disabled={saving} onClick={revert} style={actionBtnStyle('#64748b')}>{saving ? 'Saving…' : 'Take offline'}</button>
        )}
        {row.status === 'rejected' && (
          <button disabled={saving} onClick={approve} style={actionBtnStyle('#16a34a')}>{saving ? 'Saving…' : 'Approve anyway'}</button>
        )}
      </div>
    </div>
  );
}

function LeadRow({ row, onUpdated }) {
  var savingSt = useState(false), saving = savingSt[0], setSaving = savingSt[1];
  var notesSt = useState(row.admin_notes || ''), notes = notesSt[0], setNotes = notesSt[1];

  function toggleContacted() {
    setSaving(true);
    var nextContacted = !row.contacted;
    var patch = { contacted: nextContacted, contacted_at: nextContacted ? new Date().toISOString() : null };
    supabase.from('leads').update(patch).eq('id', row.id).select().single()
      .then(function (res) {
        setSaving(false);
        if (!res.error) onUpdated(res.data || Object.assign({}, row, patch));
      })
      .catch(function () { setSaving(false); });
  }

  function saveNotes() {
    if (notes === (row.admin_notes || '')) return;
    supabase.from('leads').update({ admin_notes: notes }).eq('id', row.id).select().single()
      .then(function (res) { if (!res.error) onUpdated(res.data || Object.assign({}, row, { admin_notes: notes })); });
  }

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px', marginBottom: '10px',
      background: 'var(--surface-1)', opacity: row.contacted ? 0.7 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>{row.contact_name || 'Unknown'}</span>
          {row.company_name && <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px' }}>{row.company_name}</span>}
          {row.contacted && <span style={{ fontSize: '10px', fontWeight: '700', color: '#166534', background: '#dcfce7', padding: '2px 8px', borderRadius: '999px', marginLeft: '8px' }}>Contacted</span>}
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{row.created_at ? relTime(row.created_at) : ''}</span>
      </div>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '6px 0 0' }}>
        {row.mobile}{row.email ? ' · ' + row.email : ''}
      </p>
      {row.requirement && <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '6px 0 0', lineHeight: '1.5' }}>{row.requirement}</p>}
      <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
        <button disabled={saving} onClick={toggleContacted} style={actionBtnStyle(row.contacted ? '#64748b' : '#2563eb')}>
          {row.contacted ? 'Mark not contacted' : 'Mark contacted'}
        </button>
        <input
          value={notes}
          onChange={function (e) { setNotes(e.target.value); }}
          onBlur={saveNotes}
          placeholder="Internal notes…"
          style={{ flex: 1, fontSize: '12px', padding: '6px 10px', borderRadius: '7px', border: '1.5px solid var(--border)', boxSizing: 'border-box' }}
        />
      </div>
    </div>
  );
}

export default function AdminPortal({ user, onClose }) {
  var tabSt = useState('listings'), tab = tabSt[0], setTab = tabSt[1];
  var listingsSt = useState([]), listings = listingsSt[0], setListings = listingsSt[1];
  var leadsSt = useState([]), leads = leadsSt[0], setLeads = leadsSt[1];
  var loadingSt = useState(true), loading = loadingSt[0], setLoading = loadingSt[1];
  var errSt = useState(''), err = errSt[0], setErr = errSt[1];
  var filterSt = useState('pending_review'), filter = filterSt[0], setFilter = filterSt[1];

  useEffect(function () {
    var cancelled = false;
    setLoading(true);
    setErr('');
    Promise.all([
      supabase.from('listings').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(200),
    ]).then(function (results) {
      if (cancelled) return;
      var lr = results[0], ld = results[1];
      if (lr.error || ld.error) {
        setErr((lr.error && lr.error.message) || (ld.error && ld.error.message) || 'Failed to load admin data.');
      }
      setListings(lr.data || []);
      setLeads(ld.data || []);
      setLoading(false);
    }).catch(function (e) {
      if (cancelled) return;
      setErr((e && e.message) || 'Failed to load admin data.');
      setLoading(false);
    });
    return function () { cancelled = true; };
  }, []);

  function handleListingUpdated(updated) {
    setListings(function (prev) { return prev.map(function (r) { return r.id === updated.id ? updated : r; }); });
  }
  function handleLeadUpdated(updated) {
    setLeads(function (prev) { return prev.map(function (r) { return r.id === updated.id ? updated : r; }); });
  }

  var filteredListings = filter === 'all' ? listings : listings.filter(function (r) { return r.status === filter; });
  var pendingCount = listings.filter(function (r) { return r.status === 'pending_review'; }).length;
  var notContactedCount = leads.filter(function (r) { return !r.contacted; }).length;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--surface-0)', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        height: '52px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', borderBottom: '1px solid var(--border)', background: '#1a2332',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <i className="ti ti-shield-lock" aria-hidden="true" style={{ fontSize: '16px', color: '#fcd34d' }} />
          <span style={{ fontSize: '14px', fontWeight: '600', color: '#fff' }}>Admin Portal</span>
        </div>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff',
          fontSize: '12px', padding: '6px 14px', borderRadius: '7px', cursor: 'pointer',
        }}>← Back to platform</button>
      </div>

      <div style={{ display: 'flex', gap: '4px', padding: '14px 20px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={function () { setTab('listings'); }} style={tabBtnStyle(tab === 'listings')}>
          Listings{pendingCount > 0 ? ' (' + pendingCount + ' pending)' : ''}
        </button>
        <button onClick={function () { setTab('leads'); }} style={tabBtnStyle(tab === 'leads')}>
          Leads{notContactedCount > 0 ? ' (' + notContactedCount + ' new)' : ''}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {loading && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Loading…</p>}
        {err && (
          <div style={{ fontSize: '12px', color: '#991b1b', background: '#fee2e2', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px' }}>
            {err}
          </div>
        )}

        {!loading && tab === 'listings' && (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              {['pending_review', 'live', 'rejected', 'all'].map(function (f) {
                return (
                  <button key={f} onClick={function () { setFilter(f); }} style={filterBtnStyle(filter === f)}>
                    {f === 'pending_review' ? 'Pending' : f === 'live' ? 'Live' : f === 'rejected' ? 'Rejected' : 'All'}
                  </button>
                );
              })}
            </div>
            {filteredListings.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No listings in this view.</p>}
            {filteredListings.map(function (row) {
              return <ListingRow key={row.id} row={row} adminEmail={user && user.email} onUpdated={handleListingUpdated} />;
            })}
          </>
        )}

        {!loading && tab === 'leads' && (
          <>
            {leads.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No leads captured yet.</p>}
            {leads.map(function (row) {
              return <LeadRow key={row.id} row={row} onUpdated={handleLeadUpdated} />;
            })}
          </>
        )}
      </div>
    </div>
  );
}
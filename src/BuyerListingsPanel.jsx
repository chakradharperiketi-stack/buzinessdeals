// RightPanel view for convPhase === 'listings'. Live Supabase listings,
// filtered two ways per the "dynamic right panel" requirement:
//   1. Automatically, from whatever the AI has already gathered - the
//      completed Acquisition Brief (sector[], budget range, geography[])
//      if the user arrived via buyerQualification, or the live in-progress
//      convExtraction if they arrived mid-conversation.
//   2. Manually, via the filter controls below - so refinement works even
//      when the active persona (Listings Advisor) isn't the one emitting
//      EXTRACTION tags, which is a server-side/Edge Function concern this
//      panel doesn't depend on.
// Clicking a card feeds context back to the AI (onAskAi) - the other half
// of the bidirectional link the buyer-side redesign asks for.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { SAMPLE_LISTINGS } from './lib/sampleListings';

function formatINR(lakhs) {
  if (lakhs == null || isNaN(lakhs)) return '--';
  if (lakhs >= 100) return 'Rs. ' + (lakhs / 100).toFixed(1).replace(/\.0$/, '') + ' Cr';
  return 'Rs. ' + Math.round(lakhs) + ' L';
}
function verificationLabel(status) {
  if (status === 'expert_verified') return 'CA-verified';
  if (status === 'verified') return 'Verified';
  return 'Self-reported';
}

// Derives an initial filter state from whatever buyer-side data Platform
// already has, so the panel opens pre-refined rather than blank.
function initialFiltersFrom(brief, extraction) {
  var src = brief || extraction || {};
  return {
    sector: (src.sector && src.sector[0]) || '',
    state: (src.geography && src.geography[0]) || '',
    budgetMin: src.budgetLakhsMin || '',
    budgetMax: src.budgetLakhsMax || '',
  };
}

export default function BuyerListingsPanel({ user, brief, extraction, onAskAi }) {
  var filtersSt = useState(function () { return initialFiltersFrom(brief, extraction); });
  var filters = filtersSt[0], setFilters = filtersSt[1];
  var listingsSt = useState(SAMPLE_LISTINGS), listings = listingsSt[0], setListings = listingsSt[1];
  var loadingSt = useState(true), loading = loadingSt[0], setLoading = loadingSt[1];
  var interestSt = useState({}), interestState = interestSt[0], setInterestState = interestSt[1];

  // Re-derive filters when the brief completes or extraction updates while
  // this panel is already open - this is what makes the grid "continue
  // changing" as the buyer keeps refining, per spec.
  useEffect(function () {
    setFilters(initialFiltersFrom(brief, extraction));
  }, [brief, extraction && extraction.sector, extraction && extraction.geography, extraction && extraction.budgetLakhsMin, extraction && extraction.budgetLakhsMax]);

  useEffect(function () {
    var settled = false;
    var timeoutId = setTimeout(function () { settled = true; setLoading(false); }, 4000);
    supabase.from('listings').select('*').eq('status', 'live').order('listed_at', { ascending: false }).limit(60)
      .then(function (res) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        setLoading(false);
        if (res.data && res.data.length > 0) setListings(res.data);
      }).catch(function () {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        setLoading(false);
      });
  }, []);

  function updateFilter(key, val) {
    setFilters(function (f) { return Object.assign({}, f, { [key]: val }); });
  }

  var filtered = listings.filter(function (l) {
    if (filters.sector && (l.sector || '').toLowerCase().indexOf(filters.sector.toLowerCase()) === -1) return false;
    if (filters.state && (l.state || '').toLowerCase().indexOf(filters.state.toLowerCase()) === -1) return false;
    if (filters.budgetMin && Number(l.asking_price_lakhs) < Number(filters.budgetMin)) return false;
    if (filters.budgetMax && Number(l.asking_price_lakhs) > Number(filters.budgetMax)) return false;
    return true;
  });

  var sectors = Array.from(new Set(listings.map(function (l) { return l.sector; }).filter(Boolean)));
  var states = Array.from(new Set(listings.map(function (l) { return l.state; }).filter(Boolean)));

  function expressInterest(listing) {
    setInterestState(function (s) { return Object.assign({}, s, { [listing.id]: 'sending' }); });
    var row = { listing_id: listing.id, user_id: user && user.id ? user.id : null, status: 'new' };
    supabase.from('listing_interests').insert(row).then(function (res) {
      setInterestState(function (s) { return Object.assign({}, s, { [listing.id]: res.error ? 'error' : 'sent' }); });
    }).catch(function () {
      setInterestState(function (s) { return Object.assign({}, s, { [listing.id]: 'error' }); });
    });
  }

  var hasActiveCriteria = !!(filters.sector || filters.state || filters.budgetMin || filters.budgetMax);

  return (
    <div style={{ padding: '28px 32px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '14px' }}>
        <h2 style={{ fontSize: '17px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 4px' }}>Matched listings</h2>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
          {hasActiveCriteria
            ? 'Filtered from your conversation with the AI advisor - refine further below, or ask the advisor directly.'
            : 'All live listings. Talk to the AI advisor about what you\'re looking for, or filter directly.'}
        </p>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px',
        background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px', marginBottom: '20px',
      }}>
        <select value={filters.sector} onChange={function (e) { updateFilter('sector', e.target.value); }} style={{ fontSize: '12px', padding: '8px' }}>
          <option value="">All sectors</option>
          {sectors.map(function (s) { return <option key={s} value={s}>{s}</option>; })}
        </select>
        <select value={filters.state} onChange={function (e) { updateFilter('state', e.target.value); }} style={{ fontSize: '12px', padding: '8px' }}>
          <option value="">All states</option>
          {states.map(function (s) { return <option key={s} value={s}>{s}</option>; })}
        </select>
        <input type="number" placeholder="Min asking (L)" value={filters.budgetMin} onChange={function (e) { updateFilter('budgetMin', e.target.value); }} style={{ fontSize: '12px', padding: '8px' }} />
        <input type="number" placeholder="Max asking (L)" value={filters.budgetMax} onChange={function (e) { updateFilter('budgetMax', e.target.value); }} style={{ fontSize: '12px', padding: '8px' }} />
      </div>

      {loading && <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loading listings...</p>}

      {!loading && filtered.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          No listings match these criteria yet. Try widening your filters.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '14px' }}>
        {filtered.map(function (l) {
          var interest = interestState[l.id];
          return (
            <div key={l.id} style={{
              background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '12px',
              padding: '16px', boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-accent)', background: 'var(--bg-accent)', padding: '3px 8px', borderRadius: '6px', fontWeight: '500' }}>{l.sector}</span>
                <span style={{ fontSize: '10px', color: l.verification_status === 'self_reported' ? 'var(--text-muted)' : 'var(--text-success)', fontWeight: '500' }}>{verificationLabel(l.verification_status)}</span>
              </div>
              <h3 style={{ fontSize: '13px', fontWeight: '600', margin: '0 0 4px', color: 'var(--text-primary)' }}>{l.business_name}</h3>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 12px' }}>{l.city}{l.state ? ', ' + l.state : ''} {l.years_in_operation ? '· ' + l.years_in_operation + ' yrs' : ''}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '8px', marginBottom: '12px' }}>
                <div>
                  <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 2px' }}>Revenue</p>
                  <p style={{ fontSize: '12px', fontWeight: '500', margin: 0, color: 'var(--text-primary)' }}>{formatINR(l.revenue_lakhs)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 2px' }}>EBITDA</p>
                  <p style={{ fontSize: '12px', fontWeight: '500', margin: 0, color: 'var(--text-primary)' }}>{formatINR(l.ebitda_lakhs)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 2px' }}>Asking</p>
                  <p style={{ fontSize: '12px', fontWeight: '600', margin: 0, color: 'var(--text-accent)' }}>{formatINR(l.asking_price_lakhs)}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={function () { onAskAi(l); }} style={{
                  flex: 1, padding: '8px', borderRadius: '7px', fontSize: '11px', fontWeight: '500',
                  background: 'transparent', border: '1.5px solid var(--text-accent)', color: 'var(--text-accent)', cursor: 'pointer',
                }}>Ask AI to analyse</button>
                <button onClick={function () { expressInterest(l); }} disabled={interest === 'sending' || interest === 'sent'} style={{
                  flex: 1, padding: '8px', borderRadius: '7px', fontSize: '11px', fontWeight: '500',
                  background: interest === 'sent' ? 'var(--bg-success)' : '#16a34a',
                  color: interest === 'sent' ? 'var(--text-success)' : '#fff',
                  border: 'none', cursor: interest === 'sending' || interest === 'sent' ? 'default' : 'pointer',
                }}>{interest === 'sent' ? 'Interest sent ✓' : interest === 'sending' ? 'Sending...' : 'Express interest'}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

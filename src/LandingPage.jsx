import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import AuthModal from './AuthModal';
import { callAiSearch, stripTags } from './lib/aiSearch';
import { sendNotification } from './lib/notifications';
import { SAMPLE_LISTINGS } from './lib/sampleListings';

var MAX_ANON_EXCHANGES = 5;
var PHONE = '+91-9700451678';
var EMAIL = 'contact@buzinessdeals.com';

var SUGGESTED_PROMPTS = [
  'What is my business worth?',
  'Show me businesses for sale in Hyderabad',
  'I want to invest 2 crore',
  'I need a FEMA valuation',
  'How does this platform work?',
];

var TRUST_BADGES = [
  { title: 'Damodaran India', sub: 'Valuation methodology' },
  { title: 'Minutes not weeks', sub: 'Report delivery' },
  { title: 'CA-grade tools', sub: 'Platform' },
  { title: 'Zenius Advisors', sub: 'Advisory' },
];

// Pathway 1 (direct discovery) categories - clicking one both filters the
// grid and seeds the AI conversation with context, per spec section 2.
var DISCOVERY_CATEGORIES = [
  { key: 'Manufacturing', label: 'Manufacturing Businesses', icon: 'ti-building-factory' },
  { key: 'Restaurant', label: 'Restaurants', icon: 'ti-tools-kitchen-2' },
  { key: 'Technology', label: 'Technology Companies', icon: 'ti-device-laptop' },
  { key: 'Healthcare', label: 'Healthcare Businesses', icon: 'ti-stethoscope' },
  { key: null, label: 'Available for Acquisition', icon: 'ti-briefcase' },
];

var FALLBACK_PRICING = [
  { id: 'ai_model', name: 'AI Financial Model', subtitle: 'Full P&L built from your operations', current_price: 1500, period: 'one-time', features: ['13-question guided interview', '5-year projection', 'Feeds directly into your valuation'], cta_text: 'Start free interview', sort_order: 1 },
  { id: 'valuation', name: 'Valuation Report', subtitle: 'DCF valuation with Damodaran India data', current_price: 3500, period: 'one-time', badge: 'Rs. 2,000 if model already built', features: ['9-section valuation engine', 'WACC, DCF, sensitivity analysis', 'Downloadable report'], cta_text: 'Get a valuation', is_popular: true, sort_order: 2 },
  { id: 'excel', name: 'Excel with live formulas', subtitle: 'Add-on to any valuation report', current_price: 1500, period: 'add-on', features: ['Fully editable model', 'Live DCF formulas', 'Share with your own advisors'], cta_text: 'Add to report', sort_order: 3 },
  { id: 'expert_review', name: 'Expert CA Review', subtitle: 'A Chartered Accountant reviews your numbers', current_price: 25000, period: 'one-time', features: ['Senior CA sign-off', 'Statutory-grade rigor', 'No payment required to enquire'], cta_text: 'Talk to a CA', sort_order: 4 },
  { id: 'verified_listing', name: 'Verified Listing', subtitle: '90-day featured placement', current_price: 12000, period: 'per 90 days', features: ['Verified badge', 'Priority placement', 'Included valuation summary'], cta_text: 'List your business', sort_order: 5 },
  { id: 'ca_subscription', name: 'CA Firm Subscription', subtitle: 'For CA and CS firms', current_price: 60000, period: 'per year', features: ['Unlimited client valuations', 'White-labelled reports', 'Priority support'], cta_text: 'Enquire', is_coming_soon: true, sort_order: 6 },
];

var LISTING_PACKAGE_IDS = ['verified_listing', 'ca_subscription'];

function formatINR(lakhs) {
  if (lakhs == null || isNaN(lakhs)) return '--';
  if (lakhs >= 100) return 'Rs. ' + (lakhs / 100).toFixed(1).replace(/\.0$/, '') + ' Cr';
  return 'Rs. ' + Math.round(lakhs) + ' L';
}

function verificationBadge(status) {
  if (status === 'expert_verified') return { label: 'Expert Verified', color: '#1d4ed8', bg: '#dbeafe', border: '#93c5fd' };
  if (status === 'verified') return { label: 'Verified', color: '#16a34a', bg: '#dcfce7', border: '#86efac' };
  return { label: 'Self-reported', color: '#92400e', bg: '#fef3c7', border: '#fcd34d' };
}

// --- LISTING CARD ---
function ListingCard(props) {
  var l = props.listing;
  var badge = verificationBadge(l.verification_status);
  var margin = l.ebitda_margin_pct != null ? l.ebitda_margin_pct : (l.revenue_lakhs ? Math.round((l.ebitda_lakhs / l.revenue_lakhs) * 100) : null);
  return (
    <div onClick={function () { props.onClick(l); }} style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '12px',
      padding: '18px', cursor: 'pointer', boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', gap: '8px' }}>
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 6px', color: 'var(--text-primary)' }}>{l.business_name}</h3>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: 'var(--surface-1)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{l.sector}</span>
            <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: 'var(--surface-1)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{l.city}{l.state ? ', ' + l.state : ''}</span>
            {l.years_in_operation ? <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: 'var(--surface-1)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{l.years_in_operation} yrs</span> : null}
          </div>
        </div>
        <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: badge.bg, color: badge.color, border: '0.5px solid ' + badge.border, fontWeight: '500', whiteSpace: 'nowrap' }}>{badge.label}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '10px' }}>
        <div style={{ padding: '6px 8px', background: 'var(--surface-1)', borderRadius: '6px' }}>
          <p style={{ fontSize: '9px', color: 'var(--text-muted)', margin: '0 0 1px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Revenue</p>
          <p style={{ fontSize: '12px', fontWeight: '500', margin: 0, color: 'var(--text-primary)' }}>{formatINR(l.revenue_lakhs)}</p>
        </div>
        <div style={{ padding: '6px 8px', background: 'var(--surface-1)', borderRadius: '6px' }}>
          <p style={{ fontSize: '9px', color: 'var(--text-muted)', margin: '0 0 1px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Asking price</p>
          <p style={{ fontSize: '12px', fontWeight: '600', margin: 0, color: 'var(--text-accent)' }}>{formatINR(l.asking_price_lakhs)}</p>
        </div>
        <div style={{ padding: '6px 8px', background: 'var(--surface-1)', borderRadius: '6px' }}>
          <p style={{ fontSize: '9px', color: 'var(--text-muted)', margin: '0 0 1px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>EBITDA margin</p>
          <p style={{ fontSize: '12px', fontWeight: '500', margin: 0, color: 'var(--text-primary)' }}>{margin != null ? margin + '%' : '--'}</p>
        </div>
        <div style={{ padding: '6px 8px', background: 'var(--surface-1)', borderRadius: '6px' }}>
          <p style={{ fontSize: '9px', color: 'var(--text-muted)', margin: '0 0 1px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>EBITDA</p>
          <p style={{ fontSize: '12px', fontWeight: '500', margin: 0, color: 'var(--text-primary)' }}>{formatINR(l.ebitda_lakhs)}</p>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-accent)', fontWeight: '500' }}>View details →</span>
      </div>
    </div>
  );
}

// --- LISTING DETAIL MODAL (paywall gate, with the AI handoff kept as a
// secondary path - the richer feature this session already built) ---
function ListingDetailModal(props) {
  var l = props.listing;
  var badge = verificationBadge(l.verification_status);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }} onClick={props.onClose}>
      <div onClick={function (e) { e.stopPropagation(); }} style={{
        background: 'var(--surface-2)', borderRadius: '16px', padding: '28px', maxWidth: '460px', width: '100%',
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
          <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: badge.bg, color: badge.color, border: '0.5px solid ' + badge.border, fontWeight: '500' }}>{badge.label}</span>
          <button onClick={props.onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'var(--text-muted)' }}>✕</button>
        </div>
        <h3 style={{ fontSize: '17px', fontWeight: '600', margin: '10px 0 4px', color: 'var(--text-primary)' }}>{l.business_name}</h3>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px' }}>
          {l.sector} · {l.city}{l.state ? ', ' + l.state : ''}{l.years_in_operation ? ' · ' + l.years_in_operation + ' years' : ''}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '18px' }}>
          <div>
            <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 2px' }}>Revenue</p>
            <p style={{ fontSize: '14px', fontWeight: '600', margin: 0, color: 'var(--text-primary)' }}>{formatINR(l.revenue_lakhs)}</p>
          </div>
          <div>
            <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 2px' }}>EBITDA</p>
            <p style={{ fontSize: '14px', fontWeight: '600', margin: 0, color: 'var(--text-primary)' }}>{formatINR(l.ebitda_lakhs)}</p>
          </div>
          <div>
            <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 2px' }}>Asking</p>
            <p style={{ fontSize: '14px', fontWeight: '600', margin: 0, color: 'var(--text-accent)' }}>{formatINR(l.asking_price_lakhs)}</p>
          </div>
        </div>
        <div style={{ padding: '14px', background: 'var(--bg-accent)', borderRadius: '10px', border: '1px solid var(--border)', marginBottom: '16px', textAlign: 'center' }}>
          <i className="ti ti-lock" aria-hidden="true" style={{ fontSize: '18px', color: 'var(--text-accent)', marginBottom: '8px', display: 'block' }} />
          <p style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)', margin: '0 0 4px' }}>Create a free account for full details</p>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 12px' }}>Exact financials, valuation report and a direct introduction — after a quick qualification.</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={props.onSignup} style={{ flex: 1, padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', background: '#2563eb', color: '#fff', border: 'none' }}>Create free account</button>
            <button onClick={props.onLogin} style={{ flex: 1, padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', background: 'transparent', color: 'var(--text-accent)', border: '1.5px solid var(--text-accent)' }}>Sign in</button>
          </div>
        </div>
        <button onClick={props.onAskAi} style={{
          width: '100%', padding: '11px', borderRadius: '8px', fontSize: '13px', fontWeight: '500',
          background: 'transparent', color: 'var(--text-accent)', border: '1.5px solid var(--border)', cursor: 'pointer',
        }}>Or ask the AI advisor about this business →</button>
      </div>
    </div>
  );
}

// --- NAV BAR ---
function NavBar(props) {
  return (
    <nav style={{
      background: '#1a2332', padding: '14px 24px', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, flexWrap: 'wrap', gap: '12px',
    }}>
      <button onClick={props.onLogoClick} style={{
        display: 'flex', alignItems: 'center', gap: '10px', background: 'transparent',
        border: 'none', padding: 0, margin: 0, cursor: 'pointer', textAlign: 'left',
      }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '14px', fontWeight: '700', color: '#fff' }}>BD</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '15px', fontWeight: '600', color: '#fff', lineHeight: '1.1' }}>BuzinessDeals</span>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', lineHeight: '1.1' }}>by Zenius Advisors</span>
        </div>
      </button>
      <div style={{ display: 'flex', gap: '22px', alignItems: 'center' }} className="bd-nav-links">
        <a href="#listings" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>Browse listings</a>
        <a href="#for-sellers" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>For sellers</a>
        <a href="#for-buyers" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>For buyers</a>
        <a href="#for-investors" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>For investors</a>
        <a href="#professional-tools" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>AI model & valuation</a>
        <a href="#pricing" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>Pricing</a>
        <a href="#contact" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>Contact us</a>
      </div>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }} className="bd-nav-contact">
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', lineHeight: '1.2' }}>{PHONE}</span>
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', lineHeight: '1.2' }}>{EMAIL}</span>
        </div>
        <button onClick={props.onSignIn} style={{
          background: 'transparent', border: '1px solid rgba(255,255,255,0.25)', color: '#fff',
          padding: '8px 16px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer',
        }}>Sign in</button>
        <button onClick={props.onGetStarted} style={{
          background: '#2563eb', border: 'none', color: '#fff', padding: '8px 16px',
          borderRadius: '8px', fontSize: '13px', fontWeight: '500', cursor: 'pointer',
        }}>Get started</button>
      </div>
    </nav>
  );
}

// --- FOR SECTION ---
function ForSection() {
  var cols = [
    { id: 'for-sellers', icon: 'ti-building-store', title: 'For Sellers', desc: 'List your business with a professional valuation. Get matched with qualified buyers who are pre-screened.' },
    { id: 'for-buyers', icon: 'ti-search', title: 'For Buyers', desc: 'Browse verified listings with DCF valuations. Get professionally qualified and receive curated introductions.' },
    { id: 'for-cas', icon: 'ti-file-certificate', title: 'For CAs and Advisors', desc: 'Use the valuation tool for client engagements. Generate professional DCF reports with Damodaran India data.' },
  ];
  return (
    <section style={{ padding: '48px 24px', maxWidth: '1180px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)', textAlign: 'center', margin: '0 0 32px' }}>Built for every side of the deal</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px' }}>
        {cols.map(function (col) {
          return (
            <div key={col.title} id={col.id} style={{ padding: '28px 22px', borderRadius: '14px', border: '1px solid var(--border)', background: 'var(--surface-2)', scrollMarginTop: '80px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'var(--bg-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                <i className={'ti ' + col.icon} aria-hidden="true" style={{ fontSize: '20px', color: 'var(--text-accent)' }} />
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 8px' }}>{col.title}</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6', margin: 0 }}>{col.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --- HOW IT WORKS ---
function HowItWorks() {
  var paths = [
    { icon: 'ti-search', color: '#2563eb', bg: 'rgba(37,99,235,0.12)', title: 'Buy or Invest', steps: [
      { n: '1', t: 'Tell us your goals', d: 'Complete a short qualification. Share your budget, sector preference and deal structure.' },
      { n: '2', t: 'Get your Acquisition Brief', d: 'Our AI builds a personalised buyer or investor profile, matched against verified listings.' },
      { n: '3', t: 'Browse matched listings', d: 'See businesses that match your brief. Express interest and we facilitate the introduction.' },
      { n: '4', t: 'Close the deal', d: 'Due diligence, term sheet and deal structuring, supported by our advisory team.' },
    ] },
    { icon: 'ti-building-store', color: '#16a34a', bg: 'rgba(22,163,74,0.12)', title: 'Sell or Raise Capital', steps: [
      { n: '1', t: 'AI builds your financial model', d: 'A guided interview derives your P&L from actual operations - units, prices, costs.' },
      { n: '2', t: 'Get your valuation report', d: 'DCF computed with Damodaran India data. Professional report in minutes, not weeks.' },
      { n: '3', t: 'List with credibility', d: 'Your listing shows the valuation prominently. A verified badge builds buyer trust.' },
      { n: '4', t: 'Receive qualified introductions', d: 'Only buyers who match your profile are introduced - no tyre-kickers.' },
    ] },
    { icon: 'ti-chart-bar', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', title: 'Get a Valuation', steps: [
      { n: '1', t: 'Choose your path', d: 'An AI interview for business owners, or direct manual entry for CAs with existing financials.' },
      { n: '2', t: 'Model built automatically', d: 'Revenue, costs, working capital and depreciation - computed and checked for consistency.' },
      { n: '3', t: 'Download your report', d: 'A professional DCF report with sensitivity analysis, plus an Excel model with live formulas.' },
      { n: '4', t: 'Use for any purpose', d: 'Business sale, fundraising, FEMA, angel tax, ESOP, bank loan or shareholder disputes.' },
    ] },
  ];
  return (
    <section id="how-it-works" style={{ padding: '52px 24px', background: 'var(--surface-1)' }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-accent)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>How it works</p>
          <h2 style={{ fontSize: '24px', fontWeight: '600', margin: '0 0 8px', color: 'var(--text-primary)' }}>Three ways to use BuzinessDeals</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>Whether you want to buy, sell, invest or get a valuation - we have a guided path for you</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '18px' }}>
          {paths.map(function (path) {
            return (
              <div key={path.title} style={{ background: 'var(--surface-2)', borderRadius: '14px', border: '1px solid var(--border)', padding: '22px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
                  <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: path.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className={'ti ' + path.icon} aria-hidden="true" style={{ fontSize: '18px', color: path.color }} />
                  </div>
                  <h3 style={{ fontSize: '15px', fontWeight: '600', margin: 0, color: 'var(--text-primary)' }}>{path.title}</h3>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
                  {path.steps.map(function (step) {
                    return (
                      <div key={step.n} style={{ display: 'flex', gap: '11px', alignItems: 'flex-start' }}>
                        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: path.bg, color: path.color, fontSize: '10px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>{step.n}</div>
                        <div>
                          <p style={{ fontSize: '13px', fontWeight: '500', margin: '0 0 2px', color: 'var(--text-primary)' }}>{step.t}</p>
                          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: '1.5' }}>{step.d}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// --- FOR INVESTORS ---
function ForInvestors(props) {
  var checklist = [
    'Minority and majority stake opportunities',
    'Pre-vetted by our CA advisory team',
    'Valuation report available before introduction',
    'Sector and geography filters match your mandate',
    'Structured introduction - no direct cold contact',
  ];
  var stats = [
    { label: 'Verified listings', val: 'CA sign-off' },
    { label: 'Deal structures', val: 'Full, majority, minority' },
    { label: 'Matching', val: 'By budget & sector' },
    { label: 'Introduction', val: 'Within 24-48 hrs' },
  ];
  return (
    <section id="for-investors" style={{ background: '#0f172a', padding: '56px 24px' }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '40px', alignItems: 'center' }}>
        <div>
          <p style={{ fontSize: '12px', fontWeight: '600', color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px' }}>For investors</p>
          <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#fff', margin: '0 0 14px', lineHeight: '1.3' }}>Deploy capital in verified Indian businesses</h2>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.65)', margin: '0 0 22px', lineHeight: '1.7' }}>
            Every opportunity comes with a professional DCF valuation, an operational financial model, and a qualified introduction. No cold outreach, no unverified claims.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', marginBottom: '24px' }}>
            {checklist.map(function (item) {
              return (
                <div key={item} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <i className="ti ti-circle-check" aria-hidden="true" style={{ fontSize: '15px', color: '#86efac', flexShrink: 0, marginTop: '1px' }} />
                  <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>{item}</span>
                </div>
              );
            })}
          </div>
          <button onClick={props.onShowSignup} style={{ padding: '11px 26px', borderRadius: '8px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', background: '#2563eb', color: '#fff', border: 'none' }}>Register as an investor →</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          {stats.map(function (s) {
            return (
              <div key={s.label} style={{ padding: '18px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px' }}>
                <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', margin: '0 0 4px' }}>{s.label}</p>
                <p style={{ fontSize: '14px', fontWeight: '500', color: '#fff', margin: 0 }}>{s.val}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// --- TOOLS ---
function Tools(props) {
  var items = [
    { icon: 'ti-message-chatbot', color: '#2563eb', bg: 'rgba(37,99,235,0.12)', title: 'AI Financial Model', desc: 'A guided AI interview builds your complete P&L from actual operations. No spreadsheets - revenue derived from units × price, costs built line by line.', badge: 'From Rs. 1,500', badgeColor: '#16a34a', badgeBg: '#dcfce7', cta: 'Start interview', comingSoon: false },
    { icon: 'ti-chart-bar', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', title: 'Business Valuation', desc: 'DCF valuation with Damodaran India data, WACC computation and multi-method comparison. Professional report and an Excel model with live formulas.', badge: 'From Rs. 3,500', badgeColor: '#7c3aed', badgeBg: '#ede9fe', cta: 'Get a valuation', comingSoon: false },
    { icon: 'ti-file-certificate', color: '#92400e', bg: 'rgba(146,64,14,0.12)', title: 'Term Sheet Generator', desc: 'AI-assisted term sheets for acquisitions and investments. Select deal terms, ask the AI advisor questions, get a professionally structured draft.', badge: 'Coming soon', badgeColor: '#92400e', badgeBg: '#fef3c7', cta: 'Join waitlist', comingSoon: true },
  ];
  return (
    <section id="professional-tools" style={{ padding: '52px 24px' }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <p style={{ fontSize: '12px', fontWeight: '600', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>Professional tools</p>
          <h2 style={{ fontSize: '24px', fontWeight: '600', margin: '0 0 8px', color: 'var(--text-primary)' }}>AI-powered financial tools for businesses and CAs</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>Use independently, or as part of your buy / sell journey</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {items.map(function (tool) {
            return (
              <div key={tool.title} style={{ background: 'var(--surface-2)', borderRadius: '14px', border: '1px solid var(--border)', padding: '24px', opacity: tool.comingSoon ? 0.85 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                  <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: tool.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className={'ti ' + tool.icon} aria-hidden="true" style={{ fontSize: '20px', color: tool.color }} />
                  </div>
                  <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '20px', background: tool.badgeBg, color: tool.badgeColor, fontWeight: '600' }}>{tool.badge}</span>
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: '600', margin: '0 0 8px', color: 'var(--text-primary)' }}>{tool.title}</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 18px', lineHeight: '1.6' }}>{tool.desc}</p>
                <button onClick={function () { if (!tool.comingSoon) { props.onShowSignup(); } else { alert('This tool is coming soon. We will notify you when it launches.'); } }} style={{
                  padding: '9px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: '500', cursor: 'pointer',
                  background: tool.comingSoon ? 'var(--surface-1)' : tool.color, color: tool.comingSoon ? 'var(--text-muted)' : '#fff',
                  border: tool.comingSoon ? '1px solid var(--border)' : 'none',
                }}>{tool.cta}{!tool.comingSoon ? ' →' : ''}</button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// --- PRICING CARD ---
function PricingCard(props) {
  var p = props.plan;
  return (
    <div style={{
      background: 'var(--surface-2)', border: p.is_popular ? '2px solid var(--text-accent)' : '1px solid var(--border)',
      borderRadius: '14px', padding: '22px', position: 'relative', display: 'flex', flexDirection: 'column',
    }}>
      {p.is_popular && (
        <span style={{ position: 'absolute', top: '-10px', left: '20px', background: 'var(--text-accent)', color: '#fff', fontSize: '10px', fontWeight: '600', padding: '3px 10px', borderRadius: '999px' }}>Most popular</span>
      )}
      {p.badge && !p.is_popular && (
        <span style={{ position: 'absolute', top: '-10px', left: '20px', background: 'var(--bg-success)', color: 'var(--text-success)', fontSize: '10px', fontWeight: '600', padding: '3px 10px', borderRadius: '999px' }}>{p.badge}</span>
      )}
      <h3 style={{ fontSize: '14px', fontWeight: '600', margin: '4px 0 2px', color: 'var(--text-primary)' }}>{p.name}</h3>
      <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 14px' }}>{p.subtitle}</p>
      {p.is_coming_soon ? (
        <p style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 4px', color: 'var(--text-primary)' }}>Coming soon</p>
      ) : (
        <p style={{ margin: '0 0 4px' }}>
          <span style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)' }}>Rs. {Number(p.current_price).toLocaleString('en-IN')}</span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}> /{p.period}</span>
        </p>
      )}
      <div style={{ flex: 1, margin: '10px 0 16px' }}>
        {(p.features || []).map(function (f, i) {
          return (
            <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '6px' }}>
              <i className="ti ti-check" aria-hidden="true" style={{ fontSize: '13px', color: 'var(--text-success)', marginTop: '1px' }} />
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>{f}</span>
            </div>
          );
        })}
      </div>
      <button onClick={props.onSelect} disabled={p.is_coming_soon} style={{
        width: '100%', padding: '10px', borderRadius: '8px', fontSize: '12px', fontWeight: '500',
        cursor: p.is_coming_soon ? 'default' : 'pointer',
        background: p.is_coming_soon ? 'var(--surface-1)' : p.is_popular ? '#2563eb' : 'transparent',
        color: p.is_coming_soon ? 'var(--text-muted)' : p.is_popular ? '#fff' : 'var(--text-accent)',
        border: p.is_popular || p.is_coming_soon ? 'none' : '1.5px solid var(--text-accent)',
      }}>{p.is_coming_soon ? 'Coming soon' : (p.cta_text || 'Get started')}</button>
    </div>
  );
}

// --- FOOTER ---
function Footer() {
  return (
    <footer style={{ background: '#1a2332', padding: '48px 24px 24px' }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '32px', marginBottom: '28px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#fff' }}>BD</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '14px', fontWeight: '600', color: '#fff', lineHeight: '1.1' }}>BuzinessDeals</span>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', lineHeight: '1.1' }}>by Zenius Advisors</span>
            </div>
          </div>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>Hyderabad, Telangana</p>
        </div>
        <div>
          <p style={{ fontSize: '12px', fontWeight: '600', color: 'rgba(255,255,255,0.8)', margin: '0 0 12px' }}>Company</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {['About Us', 'How It Works', 'Pricing', 'Privacy Policy', 'Terms of Use'].map(function (link) {
              return <a key={link} href="#" style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>{link}</a>;
            })}
          </div>
        </div>
        <div>
          <p style={{ fontSize: '12px', fontWeight: '600', color: 'rgba(255,255,255,0.8)', margin: '0 0 12px' }}>Contact</p>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: '0 0 4px' }}>{PHONE}</p>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>
            <a href={'mailto:' + EMAIL} style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>{EMAIL}</a>
          </p>
        </div>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px', textAlign: 'center' }}>
        <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>© 2026 BuzinessDeals. All rights reserved. Operated by Zenius Advisors.</p>
      </div>
    </footer>
  );
}

export default function LandingPage({ sessionId }) {
  var messagesSt = useState([]), messages = messagesSt[0], setMessages = messagesSt[1];
  var inputSt = useState(''), input = inputSt[0], setInput = inputSt[1];
  var loadingSt = useState(false), loading = loadingSt[0], setLoading = loadingSt[1];
  var exchangeSt = useState(0), exchangeCount = exchangeSt[0], setExchangeCount = exchangeSt[1];
  var lastActionSt = useState(null), lastAction = lastActionSt[0], setLastAction = lastActionSt[1];
  var authModalSt = useState(null), authModal = authModalSt[0], setAuthModal = authModalSt[1];

  var listingsSt = useState(SAMPLE_LISTINGS), listings = listingsSt[0], setListings = listingsSt[1];
  var pricingSt = useState(FALLBACK_PRICING), pricing = pricingSt[0], setPricing = pricingSt[1];

  // Pathway 1 (direct discovery): selecting a category subdues the chat and
  // filters the grid. Clicking an individual card opens a detail view that
  // subdues the chat further and can hand context back into it.
  var categorySt = useState(null), activeCategory = categorySt[0], setActiveCategory = categorySt[1];
  var exploringSt = useState(null), exploring = exploringSt[0], setExploring = exploringSt[1];

  var leadFormSt = useState({ company_name: '', contact_name: '', mobile: '', email: '', requirement: '' });
  var leadForm = leadFormSt[0], setLeadForm = leadFormSt[1];
  var leadSubmittingSt = useState(false), leadSubmitting = leadSubmittingSt[0], setLeadSubmitting = leadSubmittingSt[1];
  var leadSubmittedSt = useState(false), leadSubmitted = leadSubmittedSt[0], setLeadSubmitted = leadSubmittedSt[1];

  var scrollRef = useRef(null);
  var heroInputRef = useRef(null);
  var atLimit = exchangeCount >= MAX_ANON_EXCHANGES;
  // Visual priority leans toward whichever the user touched most recently,
  // but it is never a LOCK - the chat's own input stays clickable/typeable
  // at all times, no matter what else is dimmed.
  var isChatting = messages.length > 0;
  var isBrowsing = !!activeCategory || !!exploring;
  var chatHasFocus = isChatting && !isBrowsing;
  var discoveryHasFocus = isBrowsing;

  function reclaimChatFocus() {
    if (isBrowsing) { setActiveCategory(null); setExploring(null); }
  }

  var filteredListings = activeCategory
    ? listings.filter(function (l) { return (l.sector || '').toLowerCase().indexOf(activeCategory.toLowerCase()) !== -1; })
    : listings;

  useEffect(function () {
    supabase.from('listings').select('*').eq('status', 'live').order('listed_at', { ascending: false }).limit(8)
      .then(function (res) {
        if (res.data && res.data.length > 0) setListings(res.data);
      });
    supabase.from('pricing').select('*').order('sort_order', { ascending: true })
      .then(function (res) {
        if (res.data && res.data.length > 0) setPricing(res.data);
      });
  }, []);

  useEffect(function () {
    if (isChatting && scrollRef.current) {
      setTimeout(function () {
        if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 50);
    }
  }, [messages, loading]);

  useEffect(function () {
    var el = heroInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    var next = Math.min(el.scrollHeight, 120);
    el.style.height = next + 'px';
  }, [input]);

  function resetConversation() {
    setMessages([]);
    setExchangeCount(0);
    setLastAction(null);
    setInput('');
  }

  // Clicking the logo should behave like a "home" link: clear whatever
  // in-progress state is showing (chat, category filter, listing detail,
  // any open auth modal) and scroll back to the very top of the page.
  function goHome() {
    resetConversation();
    setActiveCategory(null);
    setExploring(null);
    setAuthModal(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleCategoryClick(cat) {
    setExploring(null);
    setActiveCategory(activeCategory === cat.key ? null : cat.key);
  }

  function handleListingClick(listing) {
    setActiveCategory(null);
    setExploring(listing);
  }

  function handleAskAiAboutListing(listing) {
    var prompt = 'I want to know more about ' + listing.business_name + ' (' + listing.sector + ', ' + listing.city + '). Can you analyse this business against my requirements?';
    setActiveCategory(null);
    setExploring(null);
    sendMessage(prompt);
  }

  function sendMessage(text) {
    var val = (text != null ? text : input).trim();
    if (!val || loading || atLimit) return;
    setActiveCategory(null);
    setExploring(null);
    setInput('');
    setLastAction(null);
    var newMessages = messages.concat([{ role: 'user', text: val }]);
    setMessages(newMessages);
    setLoading(true);

    var history = newMessages.map(function (m) { return { role: m.role, content: m.text }; });

    callAiSearch({
      message: val,
      history: history,
      userContext: '',
      sessionId: sessionId,
      userId: null,
      conversationPhase: 'discovery',
      exchangeCount: exchangeCount,
    }).then(function (data) {
      setLoading(false);
      var reply = stripTags(data.reply || "Sorry, I didn't quite catch that - could you rephrase?");
      setMessages(newMessages.concat([{ role: 'assistant', text: reply }]));
      setExchangeCount(function (c) { return c + 1; });
      if (data.action && data.action.type) setLastAction(data.action);
    }).catch(function () {
      setLoading(false);
      setMessages(newMessages.concat([{ role: 'assistant', text: 'Something went wrong reaching the AI advisor. Please try again in a moment.' }]));
    });
  }

  function handleActionClick() {
    setAuthModal('signup');
  }

  function handleLeadChange(field, value) {
    setLeadForm(function (prev) { return Object.assign({}, prev, { [field]: value }); });
  }

  function handleLeadSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!leadForm.contact_name || !leadForm.mobile) return;
    setLeadSubmitting(true);
    supabase.from('leads').insert({
      company_name: leadForm.company_name,
      contact_name: leadForm.contact_name,
      mobile: leadForm.mobile,
      email: leadForm.email,
      requirement: leadForm.requirement,
    }).then(function (res) {
      setLeadSubmitting(false);
      if (!res.error) {
        setLeadSubmitted(true);
        sendNotification('new_lead', leadForm);
      }
    });
  }

  var professionalTools = pricing.filter(function (p) { return LISTING_PACKAGE_IDS.indexOf(p.id) === -1; });
  var listingPackages = pricing.filter(function (p) { return LISTING_PACKAGE_IDS.indexOf(p.id) !== -1; });

  var inp = {
    width: '100%', padding: '9px 12px', borderRadius: '8px',
    border: '1.5px solid var(--border)', background: 'var(--surface-1)', color: 'var(--text-primary)',
    fontSize: '13px', fontFamily: 'var(--font-sans)', outline: 'none', boxSizing: 'border-box',
  };
  var lbl = { fontSize: '12px', fontWeight: '500', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-0)' }}>
      <style>{'html { scroll-behavior: smooth; }'}</style>
      {authModal && <AuthModal mode={authModal} onClose={function () { setAuthModal(null); }} />}

      {/* ===== 1. NAVIGATION ===== */}
      <NavBar onLogoClick={goHome} onSignIn={function () { setAuthModal('signin'); }} onGetStarted={function () { setAuthModal('signup'); }} />

      {/* ===== 2. AI CHAT HERO ===== */}
      <section style={{
        background: 'linear-gradient(180deg, #0f172a, #1e293b)', padding: '56px 20px 40px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        filter: discoveryHasFocus ? 'blur(2px)' : 'none',
        opacity: discoveryHasFocus ? 0.55 : 1,
        transition: 'filter 0.3s, opacity 0.3s',
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '12px', letterSpacing: '0.02em',
          color: '#93c5fd', fontWeight: '600', margin: '0 0 16px', padding: '7px 18px', borderRadius: '999px',
          background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.35)',
        }}>
          <i className="ti ti-sparkles" aria-hidden="true" style={{ fontSize: '12px' }} /> India's first AI-powered business marketplace
        </span>
        <h1 style={{
          fontSize: 'clamp(26px, 4vw, 40px)', fontWeight: '700', color: '#fff', textAlign: 'center',
          margin: '0 0 12px', maxWidth: '1020px', lineHeight: '1.25',
        }}>
          Buy, Sell or Invest in{' '}
          <span style={{
            background: 'linear-gradient(90deg, #93c5fd, #c4b5fd)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>Indian{' '}Businesses</span>
        </h1>
        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)', textAlign: 'center', margin: '0 0 32px', maxWidth: '560px' }}>
          Talk to our AI advisor — get guidance on buying, selling, investing or valuing a business.
        </p>

        <div style={{ width: '100%', maxWidth: '620px' }}>
          {!isChatting && (
            <>
              <div style={{
                background: 'rgba(255,255,255,0.07)', borderRadius: '999px', padding: '10px 10px 10px 20px',
                display: 'flex', alignItems: 'flex-end', gap: '10px', boxShadow: '0 12px 32px rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.18)',
              }}>
                <i className="ti ti-sparkles" aria-hidden="true" style={{ fontSize: '15px', color: '#818cf8', marginBottom: '12px' }} />
                <textarea
                  className="bd-dark-input"
                  ref={heroInputRef}
                  rows={1}
                  value={input}
                  disabled={atLimit}
                  onFocus={reclaimChatFocus}
                  onChange={function (e) { setInput(e.target.value); }}
                  onKeyDown={function (e) {
                    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); sendMessage(); }
                  }}
                  placeholder={atLimit ? 'Create an account to continue...' : 'Ask me anything — sell my business, invest 2 crore, FEMA valuation...'}
                  style={{
                    flex: 1, border: 'none', outline: 'none', background: 'transparent', color: '#fff',
                    fontSize: '14px', padding: '9px 0',
                    resize: 'none', overflowY: 'auto', maxHeight: '120px', lineHeight: '1.5', fontFamily: 'inherit',
                  }}
                />
                <button
                  onClick={function () { sendMessage(); }}
                  disabled={atLimit || loading || !input.trim()}
                  style={{
                    flexShrink: 0, border: 'none', borderRadius: '999px', padding: '11px 18px',
                    background: atLimit || loading || !input.trim() ? 'rgba(255,255,255,0.12)' : '#2563eb',
                    color: atLimit || loading || !input.trim() ? 'rgba(255,255,255,0.4)' : '#fff',
                    cursor: atLimit || loading || !input.trim() ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '600',
                  }}
                >Ask <span aria-hidden="true">→</span></button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginTop: '16px' }}>
                {SUGGESTED_PROMPTS.map(function (p) {
                  return (
                    <button key={p} onClick={function () { sendMessage(p); }} style={{
                      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                      color: 'rgba(255,255,255,0.85)', fontSize: '12px', padding: '8px 14px',
                      borderRadius: '999px', cursor: 'pointer',
                    }}>{p}</button>
                  );
                })}
              </div>

              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '28px', justifyContent: 'center',
                marginTop: '26px', paddingTop: '18px', borderTop: '1px solid rgba(255,255,255,0.08)',
              }}>
                {TRUST_BADGES.map(function (b) {
                  return (
                    <div key={b.title} style={{ textAlign: 'center' }}>
                      <p style={{ fontSize: '12px', fontWeight: '600', color: 'rgba(255,255,255,0.85)', margin: '0 0 2px' }}>{b.title}</p>
                      <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>{b.sub}</p>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {isChatting && (
            <div onFocus={reclaimChatFocus} style={{ display: 'flex', flexDirection: 'column' }}>
              {messages.map(function (m, i) {
                var isUser = m.role === 'user';
                if (isUser) {
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
                      <div style={{
                        maxWidth: '78%', padding: '10px 15px', borderRadius: '12px 12px 3px 12px',
                        fontSize: '13px', lineHeight: '1.55', whiteSpace: 'pre-wrap',
                        background: '#2563eb', color: '#fff', fontWeight: '500',
                      }}>{m.text}</div>
                    </div>
                  );
                }
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '14px' }}>
                    <span aria-hidden="true" style={{
                      width: '28px', height: '28px', borderRadius: '9px', background: '#4f46e5', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '2px',
                    }}><i className="ti ti-sparkles" aria-hidden="true" style={{ fontSize: '13px', color: '#fff' }} /></span>
                    <div style={{
                      maxWidth: '78%', padding: '12px 16px', borderRadius: '4px 12px 12px 12px',
                      fontSize: '13px', lineHeight: '1.6', whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.92)',
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    }}>{m.text}</div>
                  </div>
                );
              })}

              {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <span aria-hidden="true" style={{
                    width: '28px', height: '28px', borderRadius: '9px', background: '#4f46e5', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}><i className="ti ti-sparkles" aria-hidden="true" style={{ fontSize: '13px', color: '#fff' }} /></span>
                  <div style={{ display: 'flex', gap: '4px', padding: '12px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px 12px 12px 12px' }}>
                    {[0, 1, 2].map(function (i) {
                      return <span key={i} style={{
                        width: '5px', height: '5px', borderRadius: '50%', background: 'rgba(255,255,255,0.6)',
                        animation: 'pulse 1.2s infinite', animationDelay: (i * 0.2) + 's',
                      }} />;
                    })}
                  </div>
                </div>
              )}

              {lastAction && !atLimit && (
                <div style={{ marginLeft: '38px', marginBottom: '10px' }}>
                  <button onClick={handleActionClick} style={{
                    background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px',
                    padding: '10px 16px', fontSize: '13px', fontWeight: '500', cursor: 'pointer',
                  }}>{lastAction.label || 'Continue →'}</button>
                </div>
              )}

              {atLimit && (
                <div style={{
                  marginLeft: '38px', marginBottom: '10px', padding: '16px', background: 'rgba(37,99,235,0.15)',
                  border: '1px solid rgba(96,165,250,0.4)', borderRadius: '12px',
                }}>
                  <p style={{ fontSize: '13px', color: '#fff', lineHeight: '1.6', margin: '0 0 12px' }}>
                    I have a good picture of your situation. To continue and get specific recommendations - create a free account. Your conversation will be saved exactly where we left off.
                  </p>
                  <button onClick={function () { setAuthModal('signup'); }} style={{
                    background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px',
                    padding: '10px 18px', fontSize: '13px', fontWeight: '500', cursor: 'pointer',
                  }}>Create free account →</button>
                </div>
              )}

              {!atLimit && (
                <div style={{
                  display: 'flex', alignItems: 'flex-end', gap: '8px', background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)', borderRadius: '999px', padding: '6px 6px 6px 16px', marginTop: '6px',
                }}>
                  <i className="ti ti-sparkles" aria-hidden="true" style={{ fontSize: '14px', color: '#818cf8', marginBottom: '11px' }} />
                  <textarea
                    className="bd-dark-input"
                    ref={heroInputRef}
                    rows={1}
                    value={input}
                    onFocus={reclaimChatFocus}
                    onChange={function (e) { setInput(e.target.value); }}
                    onKeyDown={function (e) {
                      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); sendMessage(); }
                    }}
                    placeholder="Ask a follow-up question..."
                    style={{
                      flex: 1, border: 'none', outline: 'none', background: 'transparent', color: '#fff',
                      fontSize: '13px', padding: '9px 0', resize: 'none', overflowY: 'auto',
                      maxHeight: '110px', lineHeight: '1.5', fontFamily: 'inherit',
                    }}
                  />
                  <button
                    onClick={function () { sendMessage(); }}
                    disabled={loading || !input.trim()}
                    style={{
                      flexShrink: 0, border: 'none', borderRadius: '999px', padding: '10px 16px', marginBottom: '1px',
                      background: loading || !input.trim() ? 'rgba(255,255,255,0.12)' : '#2563eb',
                      color: loading || !input.trim() ? 'rgba(255,255,255,0.4)' : '#fff',
                      cursor: loading || !input.trim() ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '600',
                    }}
                  >Ask <span aria-hidden="true">→</span></button>
                </div>
              )}

              <div style={{ textAlign: 'center', marginTop: '18px' }}>
                <button onClick={resetConversation} style={{
                  display: 'block', margin: '0 auto', fontSize: '12px', color: 'rgba(255,255,255,0.4)',
                  background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px',
                }}>Clear conversation and start over</button>
                <a href="#listings" style={{
                  display: 'inline-block', marginTop: '4px', fontSize: '12px', color: 'rgba(255,255,255,0.4)', textDecoration: 'none',
                }}>⌄ Browse listings below</a>
              </div>

              <div ref={scrollRef} />
            </div>
          )}
        </div>
      </section>

      {/* ===== 3. LISTINGS GRID ===== */}
      <section id="listings" style={{
        padding: '48px 24px', maxWidth: '1180px', margin: '0 auto', position: 'relative',
        filter: chatHasFocus ? 'blur(3px)' : 'none',
        opacity: chatHasFocus ? 0.35 : 1,
        pointerEvents: chatHasFocus ? 'none' : 'auto',
        transition: 'filter 0.3s, opacity 0.3s',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Businesses for sale or investment</h2>
          <a href="#" style={{ fontSize: '13px', color: 'var(--text-accent)', textDecoration: 'none' }}>View all →</a>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
          {DISCOVERY_CATEGORIES.map(function (cat) {
            var active = activeCategory === cat.key;
            return (
              <button key={cat.label} onClick={function () { handleCategoryClick(cat); }} style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '999px',
                fontSize: '12px', fontWeight: '500', cursor: 'pointer',
                background: active ? 'var(--text-accent)' : 'var(--surface-2)',
                color: active ? '#fff' : 'var(--text-secondary)',
                border: active ? '1px solid var(--text-accent)' : '1px solid var(--border)',
              }}>
                <i className={'ti ' + cat.icon} aria-hidden="true" style={{ fontSize: '13px' }} />
                {cat.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
          {filteredListings.map(function (l) {
            return <ListingCard key={l.id} listing={l} onClick={handleListingClick} />;
          })}
        </div>

        {exploring && (
          <ListingDetailModal
            listing={exploring}
            onClose={function () { setExploring(null); }}
            onSignup={function () { setExploring(null); setAuthModal('signup'); }}
            onLogin={function () { setExploring(null); setAuthModal('signin'); }}
            onAskAi={function () { handleAskAiAboutListing(exploring); }}
          />
        )}
      </section>

      {/* ===== 4. FOR SELLERS / BUYERS / CAs ===== */}
      <ForSection />

      {/* ===== 5. HOW IT WORKS ===== */}
      <HowItWorks />

      {/* ===== 6. FOR INVESTORS ===== */}
      <ForInvestors onShowSignup={function () { setAuthModal('signup'); }} />

      {/* ===== 7. PROFESSIONAL TOOLS ===== */}
      <Tools onShowSignup={function () { setAuthModal('signup'); }} />

      {/* ===== 8. PRICING ===== */}
      <section id="pricing" style={{ padding: '52px 24px', background: 'var(--surface-1)' }}>
        <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-accent)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>BuzinessDeals pricing</p>
            <h2 style={{ fontSize: '24px', fontWeight: '600', margin: '0 0 8px', color: 'var(--text-primary)' }}>Transparent pricing for every need</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>Pay per engagement or subscribe for unlimited access. No hidden fees.</p>
          </div>

          <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 14px', paddingLeft: '4px' }}>Professional Tools</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: '16px', marginBottom: '32px' }}>
            {professionalTools.map(function (p) {
              return <PricingCard key={p.id} plan={p} onSelect={function () { setAuthModal('signup'); }} />;
            })}
          </div>

          <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 14px', paddingLeft: '4px' }}>Listing Packages</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: '16px', marginBottom: '32px' }}>
            {listingPackages.map(function (p) {
              return <PricingCard key={p.id} plan={p} onSelect={function () { setAuthModal('signup'); }} />;
            })}
          </div>

          <div style={{ textAlign: 'center', padding: '20px', background: 'var(--bg-accent)', borderRadius: '10px', border: '1px solid var(--border)' }}>
            <p style={{ fontSize: '14px', color: 'var(--text-primary)', margin: '0 0 4px', fontWeight: '500' }}>Need a custom solution?</p>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              Large transaction advisory, bulk valuations, or CA practice integration — our team will scope a plan for you.
            </p>
            <a href="#contact" style={{
              display: 'inline-block', padding: '9px 24px', borderRadius: '8px', fontSize: '13px',
              fontWeight: '500', cursor: 'pointer', background: '#2563eb', color: '#fff', textDecoration: 'none',
            }}>Contact us →</a>
          </div>
        </div>
      </section>

      {/* ===== 9. NEED EXPERT HELP ===== */}
      <section id="contact" style={{ padding: '56px 24px', background: 'var(--surface-0)' }}>
        <div style={{ maxWidth: '440px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)', margin: '0 0 8px' }}>Need expert guidance?</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: '1.6' }}>Our advisors help buyers find the right business and sellers get the best valuation.</p>
          </div>

          {leadSubmitted ? (
            <div style={{
              background: 'var(--surface-2)', borderRadius: '16px', padding: '36px 24px',
              boxShadow: 'var(--shadow-md)', textAlign: 'center', border: '1px solid var(--border)',
            }}>
              <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: 'var(--bg-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <i className="ti ti-check" aria-hidden="true" style={{ fontSize: '24px', color: 'var(--text-success)' }} />
              </div>
              <h3 style={{ fontSize: '17px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 6px' }}>Thank you!</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 18px' }}>We will call you within 24 hours.</p>
              <button onClick={function () { setAuthModal('signup'); }} style={{
                fontSize: '13px', fontWeight: '600', color: 'var(--text-accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '8px',
              }}>Create free account →</button>
            </div>
          ) : (
            <div style={{ background: 'var(--surface-2)', borderRadius: '16px', padding: '26px', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
                <div>
                  <label style={lbl}>Company name</label>
                  <input placeholder="Your company name" value={leadForm.company_name} onChange={function (e) { handleLeadChange('company_name', e.target.value); }} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Contact name</label>
                  <input placeholder="Your full name" value={leadForm.contact_name} onChange={function (e) { handleLeadChange('contact_name', e.target.value); }} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Mobile number</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ padding: '9px 12px', borderRadius: '8px', border: '1.5px solid var(--border)', background: 'var(--surface-1)', fontSize: '13px', color: 'var(--text-primary)', fontWeight: '500' }}>+91</div>
                    <input type="tel" placeholder="98765 43210" value={leadForm.mobile} onChange={function (e) { handleLeadChange('mobile', e.target.value); }} style={Object.assign({}, inp, { flex: 1 })} />
                  </div>
                </div>
                <div>
                  <label style={lbl}>Work email</label>
                  <input type="email" placeholder="you@company.com" value={leadForm.email} onChange={function (e) { handleLeadChange('email', e.target.value); }} style={inp} />
                </div>
                <div>
                  <label style={lbl}>What do you need?</label>
                  <select value={leadForm.requirement} onChange={function (e) { handleLeadChange('requirement', e.target.value); }} style={inp}>
                    <option value="">Select an option</option>
                    <option value="I want to sell my business">I want to sell my business</option>
                    <option value="I want to buy a business">I want to buy a business</option>
                    <option value="I need a valuation report">I need a valuation report</option>
                    <option value="I want to list for funding">I want to list for funding</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <button onClick={handleLeadSubmit} disabled={leadSubmitting} style={{
                  width: '100%', padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: '600',
                  cursor: leadSubmitting ? 'default' : 'pointer', background: '#2563eb', color: '#fff', border: 'none',
                  opacity: leadSubmitting ? 0.7 : 1,
                }}>{leadSubmitting ? 'Sending...' : 'Get a call back →'}</button>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '16px', marginBottom: '4px' }}>Or create a free account to get started instantly</p>
              <button onClick={function () { setAuthModal('signup'); }} style={{
                display: 'block', margin: '0 auto', fontSize: '13px', fontWeight: '600', color: 'var(--text-accent)', background: 'none', border: 'none', cursor: 'pointer',
              }}>Create free account →</button>
            </div>
          )}
        </div>
      </section>

      {/* ===== 10. FOOTER ===== */}
      <Footer />
    </div>
  );
}
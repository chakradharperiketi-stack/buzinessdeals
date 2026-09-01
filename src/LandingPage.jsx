import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import AuthModal from './AuthModal';
import { callAiSearch, stripTags } from './lib/aiSearch';
import { sendNotification } from './lib/notifications';
import { SAMPLE_LISTINGS } from './lib/sampleListings';

var MAX_ANON_EXCHANGES = 5;

var SUGGESTED_PROMPTS = [
  'What is my business worth?',
  'Show me businesses for sale in Hyderabad',
  'I need a FEMA valuation',
  'How does this platform work?',
];

var TRUST_BADGES = ['Damodaran India data', 'Minutes, not weeks', 'CA-grade tools', 'Zenius Advisors'];

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
  // at all times, no matter what else is dimmed. (Previously the whole
  // hero, including its own input, went pointer-events:none while
  // "browsing" was active, which meant clicking back into the chat did
  // nothing - the only way out was the one category chip that happened to
  // toggle back to null. Visual de-emphasis must never disable input.)
  var isChatting = messages.length > 0;
  var isBrowsing = !!activeCategory || !!exploring;
  var chatHasFocus = isChatting && !isBrowsing;
  var discoveryHasFocus = isBrowsing;

  // Clicking/focusing back into the advisor always wins - reclaims focus
  // immediately instead of requiring a message to actually be sent first.
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
    if (scrollRef.current) {
      setTimeout(function () {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 50);
    }
  }, [messages, loading]);

  // Auto-grow the hero compose box, capped so it never dominates the card.
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

  function handleCategoryClick(cat) {
    setExploring(null);
    setActiveCategory(activeCategory === cat.key ? null : cat.key);
  }

  function handleListingClick(listing) {
    setActiveCategory(null);
    setExploring(listing);
  }

  function closeExploring() {
    setExploring(null);
  }

  // Pathway 1 -> Pathway 2 handoff: a listing the user is looking at becomes
  // context for the AI advisor, and focus returns to the chat.
  function handleAskAiAboutListing(listing) {
    var prompt = 'I want to know more about ' + listing.business_name + ' (' + listing.sector + ', ' + listing.city + '). Can you analyse this business against my requirements?';
    setActiveCategory(null);
    setExploring(null);
    sendMessage(prompt);
  }

  function sendMessage(text) {
    var val = (text != null ? text : input).trim();
    if (!val || loading || atLimit) return;
    // Sending a message always hands visual priority back to the chat.
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

  function handleLeadSubmit(e) {
    e.preventDefault();
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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-0)' }}>
      <style>{'html { scroll-behavior: smooth; }'}</style>
      {authModal && <AuthModal mode={authModal} onClose={function () { setAuthModal(null); }} />}

      {/* ===== 1. NAVIGATION ===== */}
      <nav style={{
        background: '#1a2332', padding: '14px 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, flexWrap: 'wrap', gap: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: '#fff' }}>BD</span>
          </div>
          <span style={{ fontSize: '15px', fontWeight: '600', color: '#fff' }}>buzinessdeals.com</span>
        </div>
        <div style={{ display: 'flex', gap: '22px', alignItems: 'center' }} className="bd-nav-links">
          <a href="#listings" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>Browse listings</a>
          <a href="#how-it-works" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>How it works</a>
          <a href="#for-investors" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>For investors</a>
          <a href="#professional-tools" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>AI model & valuation</a>
          <a href="#pricing" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>Pricing</a>
          <a href="#contact" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', textDecoration: 'none' }}>Contact us</a>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={function () { setAuthModal('signin'); }} style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,0.25)', color: '#fff',
            padding: '8px 16px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer',
          }}>Sign in</button>
          <button onClick={function () { setAuthModal('signup'); }} style={{
            background: '#2563eb', border: 'none', color: '#fff', padding: '8px 16px',
            borderRadius: '8px', fontSize: '13px', fontWeight: '500', cursor: 'pointer',
          }}>Get started</button>
        </div>
      </nav>

      {/* ===== 2. AI CHAT HERO ===== */}
      <section style={{
        background: 'linear-gradient(180deg, #0f172a, #1e293b)', padding: '56px 20px 40px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        filter: discoveryHasFocus ? 'blur(2px)' : 'none',
        opacity: discoveryHasFocus ? 0.55 : 1,
        transition: 'filter 0.3s, opacity 0.3s',
      }}>
        {!isChatting && (
          <>
            <p style={{ fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#60a5fa', margin: '0 0 12px', fontWeight: '600' }}>
              India's first AI-powered business marketplace
            </p>
            <h1 style={{
              fontSize: 'clamp(26px, 4vw, 40px)', fontWeight: '700', color: '#fff', textAlign: 'center',
              margin: '0 0 12px', maxWidth: '720px', lineHeight: '1.25',
            }}>
              Buy, Sell or Invest in Indian Businesses
            </h1>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)', textAlign: 'center', margin: '0 0 32px', maxWidth: '560px' }}>
              Talk to our AI Business Advisor — get intelligent guidance on buying, selling, investing in, or valuing a business.
            </p>
          </>
        )}

        <div style={{ width: '100%', maxWidth: '680px' }}>
          {!isChatting && (
            <>
              <div style={{
                background: '#ffffff', borderRadius: '20px', padding: '10px 10px 10px 20px',
                display: 'flex', alignItems: 'flex-end', gap: '10px', boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
                border: '1px solid rgba(255,255,255,0.6)',
              }}>
                <i className="ti ti-search" aria-hidden="true" style={{ fontSize: '16px', color: '#94a3b8', marginBottom: '11px' }} />
                <textarea
                  ref={heroInputRef}
                  rows={1}
                  value={input}
                  disabled={atLimit}
                  onFocus={reclaimChatFocus}
                  onChange={function (e) { setInput(e.target.value); }}
                  onKeyDown={function (e) {
                    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); sendMessage(); }
                  }}
                  placeholder={atLimit ? 'Create an account to continue...' : 'Ask me anything — sell my business, invest in a company, get a FEMA valuation...'}
                  style={{
                    flex: 1, border: 'none', outline: 'none', fontSize: '14px', padding: '9px 0',
                    resize: 'none', overflowY: 'auto', maxHeight: '120px', lineHeight: '1.5', fontFamily: 'inherit',
                  }}
                />
                <button
                  onClick={function () { sendMessage(); }}
                  disabled={atLimit || loading || !input.trim()}
                  style={{
                    flexShrink: 0, border: 'none', borderRadius: '14px', padding: '11px 18px',
                    background: atLimit || loading || !input.trim() ? '#c4cdd9' : '#2563eb', color: '#fff',
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
                display: 'flex', flexWrap: 'wrap', gap: '18px', justifyContent: 'center',
                marginTop: '26px', paddingTop: '18px', borderTop: '1px solid rgba(255,255,255,0.08)',
              }}>
                {TRUST_BADGES.map(function (b, i) {
                  return (
                    <span key={b} style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: '500' }}>{b}</span>
                      {i < TRUST_BADGES.length - 1 && <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: 'rgba(255,255,255,0.25)' }} />}
                    </span>
                  );
                })}
              </div>
            </>
          )}

          {isChatting && (
            <div
              onFocus={reclaimChatFocus}
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '18px', display: 'flex', flexDirection: 'column',
                height: 'min(560px, 72vh)', overflow: 'hidden',
              }}
            >
              {/* Card header - persona pill stays visible even when scrolled */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0,
              }}>
                <span style={{
                  display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: '600', color: '#fff',
                }}>
                  <span style={{
                    width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(37,99,235,0.35)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: '700', color: '#93c5fd',
                  }}>AI</span>
                  Business Advisor
                </span>
                <button onClick={resetConversation} title="Clear conversation and start over" style={{
                  fontSize: '11px', color: 'rgba(255,255,255,0.5)', background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
                }}>Clear conversation and start over</button>
              </div>

              {/* Transcript - grows, scrolls; input stays pinned below */}
              <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                {messages.map(function (m, i) {
                  var isUser = m.role === 'user';
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: '10px', gap: '8px' }}>
                      {!isUser && (
                        <span style={{
                          width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(37,99,235,0.35)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: '700',
                          color: '#93c5fd', flexShrink: 0, marginTop: '2px',
                        }}>AI</span>
                      )}
                      <div style={{
                        maxWidth: '82%', padding: '10px 14px', borderRadius: isUser ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                        fontSize: '13px', lineHeight: '1.55', whiteSpace: 'pre-wrap',
                        background: isUser ? '#2563eb' : 'rgba(255,255,255,0.1)',
                        color: '#fff',
                      }}>{m.text}</div>
                    </div>
                  );
                })}
                {loading && (
                  <div style={{ display: 'flex', gap: '4px', padding: '4px 14px' }}>
                    {[0, 1, 2].map(function (i) {
                      return <span key={i} style={{
                        width: '5px', height: '5px', borderRadius: '50%', background: 'rgba(255,255,255,0.6)',
                        animation: 'pulse 1.2s infinite', animationDelay: (i * 0.2) + 's',
                      }} />;
                    })}
                  </div>
                )}

                {lastAction && !atLimit && (
                  <div style={{ marginTop: '6px' }}>
                    <button onClick={handleActionClick} style={{
                      background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px',
                      padding: '10px 16px', fontSize: '13px', fontWeight: '500', cursor: 'pointer',
                    }}>{lastAction.label || 'Continue →'}</button>
                  </div>
                )}

                {atLimit && (
                  <div style={{
                    marginTop: '10px', padding: '16px', background: 'rgba(37,99,235,0.15)',
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
              </div>

              {/* Follow-up input, pinned at the bottom of the same card */}
              {!atLimit && (
                <div style={{ padding: '10px 12px 12px', borderTop: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
                  <div style={{
                    display: 'flex', alignItems: 'flex-end', gap: '8px', background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)', borderRadius: '18px', padding: '5px 5px 5px 14px',
                  }}>
                    <textarea
                      ref={heroInputRef}
                      rows={1}
                      value={input}
                      onFocus={reclaimChatFocus}
                      onChange={function (e) { setInput(e.target.value); }}
                      onKeyDown={function (e) {
                        if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); sendMessage(); }
                      }}
                      placeholder="Type your message... (Shift+Enter for a new line)"
                      style={{
                        flex: 1, border: 'none', outline: 'none', background: 'transparent', color: '#fff',
                        fontSize: '13px', padding: '8px 0', resize: 'none', overflowY: 'auto',
                        maxHeight: '110px', lineHeight: '1.5', fontFamily: 'inherit',
                      }}
                    />
                    <button
                      onClick={function () { sendMessage(); }}
                      disabled={loading || !input.trim()}
                      style={{
                        width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0, border: 'none', marginBottom: '2px',
                        background: loading || !input.trim() ? 'rgba(255,255,255,0.15)' : '#2563eb', color: '#fff',
                        cursor: loading || !input.trim() ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px',
                      }}
                    >→</button>
                  </div>
                </div>
              )}
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

        {/* Pathway 1: direct discovery categories */}
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
            return (
              <div key={l.id} onClick={function () { handleListingClick(l); }} style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '12px',
                padding: '18px', boxShadow: 'var(--shadow-sm)', cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-accent)', background: 'var(--bg-accent)', padding: '3px 8px', borderRadius: '6px', fontWeight: '500' }}>{l.sector}</span>
                  <span style={{ fontSize: '10px', color: l.verification_status === 'self_reported' ? 'var(--text-muted)' : 'var(--text-success)', fontWeight: '500' }}>{verificationLabel(l.verification_status)}</span>
                </div>
                <h3 style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 4px', color: 'var(--text-primary)' }}>{l.business_name}</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 14px' }}>{l.city}{l.state ? ', ' + l.state : ''} {l.years_in_operation ? '· ' + l.years_in_operation + ' yrs' : ''}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                  <div>
                    <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 2px' }}>Revenue</p>
                    <p style={{ fontSize: '13px', fontWeight: '500', margin: 0, color: 'var(--text-primary)' }}>{formatINR(l.revenue_lakhs)}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 2px' }}>EBITDA</p>
                    <p style={{ fontSize: '13px', fontWeight: '500', margin: 0, color: 'var(--text-primary)' }}>{formatINR(l.ebitda_lakhs)}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 2px' }}>Asking</p>
                    <p style={{ fontSize: '13px', fontWeight: '600', margin: 0, color: 'var(--text-accent)' }}>{formatINR(l.asking_price_lakhs)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pathway 1 -> Pathway 2 handoff: exploring a listing subdues chat
            and offers to carry this business into the AI conversation. */}
        {exploring && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
          }} onClick={closeExploring}>
            <div onClick={function (e) { e.stopPropagation(); }} style={{
              background: 'var(--surface-2)', borderRadius: '16px', padding: '28px', maxWidth: '440px', width: '100%',
              boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-accent)', background: 'var(--bg-accent)', padding: '3px 8px', borderRadius: '6px', fontWeight: '500' }}>{exploring.sector}</span>
                <button onClick={closeExploring} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'var(--text-muted)' }}>✕</button>
              </div>
              <h3 style={{ fontSize: '17px', fontWeight: '600', margin: '10px 0 4px', color: 'var(--text-primary)' }}>{exploring.business_name}</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px' }}>{exploring.city}{exploring.state ? ', ' + exploring.state : ''} · {verificationLabel(exploring.verification_status)}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
                <div>
                  <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 2px' }}>Revenue</p>
                  <p style={{ fontSize: '14px', fontWeight: '600', margin: 0, color: 'var(--text-primary)' }}>{formatINR(exploring.revenue_lakhs)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 2px' }}>EBITDA</p>
                  <p style={{ fontSize: '14px', fontWeight: '600', margin: 0, color: 'var(--text-primary)' }}>{formatINR(exploring.ebitda_lakhs)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 2px' }}>Asking</p>
                  <p style={{ fontSize: '14px', fontWeight: '600', margin: 0, color: 'var(--text-accent)' }}>{formatINR(exploring.asking_price_lakhs)}</p>
                </div>
              </div>
              <button onClick={function () { handleAskAiAboutListing(exploring); }} style={{
                width: '100%', padding: '11px', borderRadius: '8px', fontSize: '13px', fontWeight: '500',
                background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
              }}>Ask the AI advisor about this business →</button>
            </div>
          </div>
        )}
      </section>

      {/* ===== 4. HOW IT WORKS ===== */}
      <section id="how-it-works" style={{ padding: '48px 24px', maxWidth: '1180px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', textAlign: 'center', margin: '0 0 32px' }}>How it works</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px' }}>
          {[
            { icon: 'ti-search', title: 'Buy or invest', desc: 'Tell our AI advisor your budget, sector and geography. Get matched to verified listings and receive an Acquisition Brief.' },
            { icon: 'ti-building', title: 'Sell or raise capital', desc: 'Our AI financial analyst interviews you about your operations and builds a defensible P&L - no spreadsheets required.' },
            { icon: 'ti-report-analytics', title: 'Get a valuation', desc: 'A 9-section DCF valuation engine using Damodaran India data, reviewed by Zenius Advisors CAs.' },
          ].map(function (c) {
            return (
              <div key={c.title} style={{ padding: '24px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '14px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--bg-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                  <i className={'ti ' + c.icon} aria-hidden="true" style={{ fontSize: '19px', color: 'var(--text-accent)' }} />
                </div>
                <h3 style={{ fontSize: '15px', fontWeight: '600', margin: '0 0 8px', color: 'var(--text-primary)' }}>{c.title}</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.6' }}>{c.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ===== 5. FOR INVESTORS ===== */}
      <section id="for-investors" style={{ background: '#0f172a', padding: '56px 24px' }}>
        <div style={{ maxWidth: '1180px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '32px', alignItems: 'center' }}>
          <div>
            <p style={{ fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#60a5fa', margin: '0 0 10px', fontWeight: '600' }}>For investors</p>
            <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#fff', margin: '0 0 12px', lineHeight: '1.3' }}>
              Every listing comes with the numbers, not just a pitch
            </h2>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.65)', margin: 0, lineHeight: '1.7' }}>
              We push sellers to build a real financial model before they list. Verified listings carry a valuation report and CA sign-off, so you spend your time on businesses worth diligence - not marketing decks.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {[
              { label: 'Verified listings', val: 'CA sign-off' },
              { label: 'Deal structures', val: 'Full, majority, minority' },
              { label: 'Matching', val: 'By budget & sector' },
              { label: 'Introduction', val: 'Within 24-48 hrs' },
            ].map(function (s) {
              return (
                <div key={s.label} style={{ padding: '16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px' }}>
                  <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', margin: '0 0 4px' }}>{s.label}</p>
                  <p style={{ fontSize: '14px', fontWeight: '500', color: '#fff', margin: 0 }}>{s.val}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== 6. PROFESSIONAL TOOLS ===== */}
      <section id="professional-tools" style={{ padding: '48px 24px', maxWidth: '1180px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 6px' }}>Professional tools</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 24px' }}>Built for CAs, CMAs, CS and Registered Valuers working with clients.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
          {[
            { title: 'AI Financial Model', desc: 'Run the operational interview for a client and export a clean P&L.', status: 'Available' },
            { title: 'Valuation Platform V3', desc: 'Full 9-section DCF engine with UDIN support for statutory use.', status: 'Available' },
            { title: 'Term Sheet Generator', desc: 'Draft acquisition and investment term sheets from your valuation.', status: 'Coming soon' },
          ].map(function (t) {
            return (
              <div key={t.title} style={{ padding: '20px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: '600', margin: 0, color: 'var(--text-primary)' }}>{t.title}</h3>
                  <span style={{
                    fontSize: '10px', fontWeight: '500', padding: '2px 8px', borderRadius: '999px',
                    background: t.status === 'Available' ? 'var(--bg-success)' : 'var(--surface-1)',
                    color: t.status === 'Available' ? 'var(--text-success)' : 'var(--text-muted)',
                  }}>{t.status}</span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.6' }}>{t.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ===== 7. PRICING ===== */}
      <section id="pricing" style={{ padding: '48px 24px', background: 'var(--surface-1)' }}>
        <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', textAlign: 'center', margin: '0 0 6px' }}>Pricing</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', margin: '0 0 32px' }}>Pay only for what you use. No subscriptions for individual sellers or buyers.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            {pricing.map(function (p) {
              return (
                <div key={p.id} style={{
                  background: 'var(--surface-2)', border: p.is_popular ? '2px solid var(--text-accent)' : '1px solid var(--border)',
                  borderRadius: '14px', padding: '22px', position: 'relative', display: 'flex', flexDirection: 'column',
                }}>
                  {p.is_popular && (
                    <span style={{
                      position: 'absolute', top: '-10px', left: '20px', background: 'var(--text-accent)', color: '#fff',
                      fontSize: '10px', fontWeight: '600', padding: '3px 10px', borderRadius: '999px',
                    }}>Most popular</span>
                  )}
                  <h3 style={{ fontSize: '14px', fontWeight: '600', margin: '4px 0 2px', color: 'var(--text-primary)' }}>{p.name}</h3>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 14px' }}>{p.subtitle}</p>
                  <p style={{ margin: '0 0 4px' }}>
                    <span style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)' }}>Rs. {Number(p.current_price).toLocaleString('en-IN')}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}> /{p.period}</span>
                  </p>
                  {p.badge && <p style={{ fontSize: '11px', color: 'var(--text-accent)', margin: '0 0 14px' }}>{p.badge}</p>}
                  <div style={{ flex: 1, margin: p.badge ? '0 0 16px' : '10px 0 16px' }}>
                    {(p.features || []).map(function (f, i) {
                      return (
                        <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '6px' }}>
                          <i className="ti ti-check" aria-hidden="true" style={{ fontSize: '13px', color: 'var(--text-success)', marginTop: '1px' }} />
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>{f}</span>
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={function () { setAuthModal('signup'); }} disabled={p.is_coming_soon} style={{
                    width: '100%', padding: '10px', borderRadius: '8px', fontSize: '12px', fontWeight: '500',
                    cursor: p.is_coming_soon ? 'default' : 'pointer',
                    background: p.is_coming_soon ? 'var(--surface-1)' : p.is_popular ? '#2563eb' : 'transparent',
                    color: p.is_coming_soon ? 'var(--text-muted)' : p.is_popular ? '#fff' : 'var(--text-accent)',
                    border: p.is_popular || p.is_coming_soon ? 'none' : '1.5px solid var(--text-accent)',
                  }}>{p.is_coming_soon ? 'Coming soon' : p.cta_text || 'Get started'}</button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== 8. NEED EXPERT HELP ===== */}
      <section id="contact" style={{ padding: '48px 24px', maxWidth: '680px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', textAlign: 'center', margin: '0 0 6px' }}>Need expert help?</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', margin: '0 0 24px' }}>Tell us what you need and a Zenius Advisors CA will call you back.</p>

        {leadSubmitted ? (
          <div style={{ padding: '20px', background: 'var(--bg-success)', border: '1px solid var(--border-success)', borderRadius: '12px', textAlign: 'center' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-success)', margin: 0, fontWeight: '500' }}>Thanks - we've received your details and will be in touch shortly.</p>
          </div>
        ) : (
          <form onSubmit={handleLeadSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <input placeholder="Company name" value={leadForm.company_name} onChange={function (e) { setLeadForm(Object.assign({}, leadForm, { company_name: e.target.value })); }} />
            <input placeholder="Your name" required value={leadForm.contact_name} onChange={function (e) { setLeadForm(Object.assign({}, leadForm, { contact_name: e.target.value })); }} />
            <input placeholder="Mobile number" required value={leadForm.mobile} onChange={function (e) { setLeadForm(Object.assign({}, leadForm, { mobile: e.target.value })); }} />
            <input placeholder="Email" type="email" value={leadForm.email} onChange={function (e) { setLeadForm(Object.assign({}, leadForm, { email: e.target.value })); }} />
            <div style={{ gridColumn: 'span 2' }}>
              <textarea placeholder="What do you need help with?" rows={3} value={leadForm.requirement}
                onChange={function (e) { setLeadForm(Object.assign({}, leadForm, { requirement: e.target.value })); }}
                style={{ resize: 'vertical' }} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <button type="submit" disabled={leadSubmitting} style={{
                width: '100%', padding: '11px', borderRadius: '8px', fontSize: '13px', fontWeight: '500',
                background: '#2563eb', color: '#fff', border: 'none', cursor: leadSubmitting ? 'default' : 'pointer',
                opacity: leadSubmitting ? 0.7 : 1,
              }}>{leadSubmitting ? 'Sending...' : 'Request a callback'}</button>
            </div>
          </form>
        )}
      </section>

      {/* ===== 9. FOOTER ===== */}
      <footer style={{ background: '#1a2332', padding: '32px 24px', marginTop: '20px' }}>
        <div style={{ maxWidth: '1180px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: '600', color: '#fff', margin: '0 0 4px' }}>buzinessdeals.com</p>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', margin: 0 }}>A Zenius Advisors venture · Hyderabad</p>
          </div>
          <div>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', margin: 0 }}>
              Contact: <a href="mailto:zeniusadvisors@gmail.com" style={{ color: 'rgba(255,255,255,0.65)' }}>zeniusadvisors@gmail.com</a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
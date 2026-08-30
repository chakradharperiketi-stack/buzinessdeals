import { useState, useEffect } from 'react';
import { ValuationPlatform } from './ValuationPlatform';
import ConversationEngine from './ConversationEngine';
import FinancialModelPanel from './FinancialModelPanel';
import AcquisitionBriefPanel from './AcquisitionBriefPanel';
import BuyerListingsPanel from './BuyerListingsPanel';
import { computeModel } from './lib/financialModel';
import { buildV3FormFromModel } from './lib/v3FormMapper';
import { supabase } from './supabase';

// Admin detection is by email only - never call any Supabase admin API from
// the frontend (critical rule #8).
var ADMIN_EMAILS = ['zeniusadvisors@gmail.com', 'chakradhar@vkcorpca.com', 'chakri@buzinessdeals.com'];

var ACTION_CARDS = [
  { key: 'listings', icon: 'ti-search', color: '#2563eb', title: 'Browse or Invest', desc: 'Explore verified listings matched to your budget and sector.' },
  { key: 'sellerDashboard', icon: 'ti-building', color: '#16a34a', title: 'Sell or Raise Capital', desc: 'List your business for sale, succession, or minority investment.' },
  { key: 'analyst', icon: 'ti-message-chatbot', color: '#7c3aed', title: 'AI Financial Model', desc: 'A guided interview builds your P&L - Rs. 1,500, pay after it’s built.' },
  { key: 'valuation', icon: 'ti-chart-line', color: '#2563eb', title: 'Valuation Report', desc: 'A full DCF valuation using Damodaran India data - from Rs. 2,000.' },
];

function NavBar({ user, isAdmin, onHome, onGoListings, onSignOut }) {
  var menuSt = useState(false), menuOpen = menuSt[0], setMenuOpen = menuSt[1];
  var initial = (user && user.email ? user.email[0] : '?').toUpperCase();

  return (
    <div style={{
      height: '48px', background: '#1a2332', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', padding: '0 16px', flexShrink: 0, position: 'relative', zIndex: 50,
    }}>
      <button onClick={onHome} style={{
        display: 'flex', alignItems: 'center', gap: '8px', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
      }}>
        <div style={{ width: '26px', height: '26px', borderRadius: '7px', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '12px', fontWeight: '700', color: '#fff' }}>BD</span>
        </div>
        <span style={{ fontSize: '13px', fontWeight: '600', color: '#fff' }}>buzinessdeals.com</span>
      </button>

      <button onClick={onGoListings} style={{
        background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff',
        fontSize: '12px', padding: '6px 14px', borderRadius: '7px', cursor: 'pointer',
      }}>Browse listings</button>

      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isAdmin && (
            <span style={{
              fontSize: '10px', fontWeight: '600', color: '#92400e', background: '#fcd34d',
              padding: '2px 8px', borderRadius: '999px',
            }}>Admin</span>
          )}
          <button onClick={function () { setMenuOpen(!menuOpen); }} style={{
            width: '28px', height: '28px', borderRadius: '50%', background: '#2563eb', color: '#fff',
            border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600',
          }}>{initial}</button>
        </div>
        {menuOpen && (
          <div style={{
            position: 'absolute', right: 0, top: '38px', background: '#fff', borderRadius: '10px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.2)', minWidth: '200px', overflow: 'hidden', border: '1px solid var(--border)',
          }}>
            {[
              { label: 'Home', action: onHome },
              { label: 'My Businesses', action: onHome },
              { label: 'My Engagements', action: onHome },
              { label: 'My Interests', action: onHome },
              { label: 'Profile and Settings', action: onHome },
            ].concat(isAdmin ? [{ label: 'Admin Portal', action: onHome }] : []).map(function (item) {
              return (
                <button key={item.label} onClick={function () { setMenuOpen(false); item.action(); }} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'transparent',
                  border: 'none', borderBottom: '1px solid var(--border)', fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer',
                }}>{item.label}</button>
              );
            })}
            <button onClick={function () { setMenuOpen(false); onSignOut(); }} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'transparent',
              border: 'none', fontSize: '13px', color: 'var(--text-danger)', cursor: 'pointer',
            }}>Sign out</button>
          </div>
        )}
      </div>
    </div>
  );
}

function HomeScreen({ onCard }) {
  var hour = new Date().getHours();
  var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <div style={{ padding: '32px', maxWidth: '760px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 4px' }}>{greeting}.</h1>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 28px' }}>What would you like to do today?</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
        {ACTION_CARDS.map(function (c) {
          return (
            <button key={c.key} onClick={function () { onCard(c.key); }} style={{
              textAlign: 'left', padding: '20px', borderRadius: '14px', border: '1px solid var(--border)',
              background: 'var(--surface-2)', cursor: 'pointer', boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{
                width: '38px', height: '38px', borderRadius: '10px', background: c.color + '1a',
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px',
              }}>
                <i className={'ti ' + c.icon} aria-hidden="true" style={{ fontSize: '18px', color: c.color }} />
              </div>
              <p style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 4px' }}>{c.title}</p>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.55' }}>{c.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ComingNextPanel({ title, note }) {
  return (
    <div style={{ padding: '32px', maxWidth: '520px', margin: '80px auto 0', textAlign: 'center' }}>
      <div style={{
        width: '48px', height: '48px', borderRadius: '12px', background: 'var(--bg-accent)', margin: '0 auto 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <i className="ti ti-tool" aria-hidden="true" style={{ fontSize: '22px', color: 'var(--text-accent)' }} />
      </div>
      <h2 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 6px' }}>{title}</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: '1.6' }}>{note}</p>
    </div>
  );
}

function RightPanel({ convPhase, user, sellerForm, selEngId, convExtraction, convModel, brief, onCard, onHomeFromValuation, onProceedToValuation, onBrowseMatched, onAskAiAboutListing }) {
  return (
    <div style={{ width: '65%', flex: 1, height: '100%', overflowY: 'auto', background: 'var(--surface-0)' }}>
      {convPhase === 'discovery' && <HomeScreen onCard={onCard} />}

      {convPhase === 'valuation' && (
        <ValuationPlatform
          user={user}
          engagementId={selEngId}
          initialForm={sellerForm}
          onHome={onHomeFromValuation}
        />
      )}

      {convPhase === 'analyst' && (
        <FinancialModelPanel extraction={convExtraction} model={convModel} onProceed={onProceedToValuation} />
      )}

      {convPhase === 'buyerQualification' && (
        <AcquisitionBriefPanel extraction={convExtraction} brief={brief} onProceed={onBrowseMatched} />
      )}

      {convPhase === 'listings' && (
        <BuyerListingsPanel user={user} brief={brief} extraction={convExtraction} onAskAi={onAskAiAboutListing} />
      )}
    </div>
  );
}

// convPhase/convExtraction/convModel/brief/sellerForm/selEngId used to live
// only in React memory, with nothing to restore them from. ConversationEngine
// already restores the raw chat TEXT from ai_conversations on remount, but
// these structured fields (what drives the right panel) had no restore path
// at all - so a Bolt preview reload from switching tabs/windows (or any full
// remount) silently dropped back to convPhase='discovery' with an empty
// panel, even though the chat log itself came back. localStorage, keyed by
// sessionId, closes that gap for same-browser reloads without needing a
// schema change; it does not follow the user cross-device the way the
// Supabase-backed chat history does; that would take carrying this state
// into ai_conversations too, and hasn't been asked for beyond fixing this.
var PLATFORM_STATE_PREFIX = 'bd_platform_state_';

function loadPlatformState(sessionId) {
  if (!sessionId || typeof localStorage === 'undefined') return null;
  try {
    var raw = localStorage.getItem(PLATFORM_STATE_PREFIX + sessionId);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function savePlatformState(sessionId, state) {
  if (!sessionId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PLATFORM_STATE_PREFIX + sessionId, JSON.stringify(state));
  } catch (e) {
    // best-effort only - storage full/blocked should never break the app
  }
}

function clearPlatformState(sessionId) {
  if (!sessionId || typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(PLATFORM_STATE_PREFIX + sessionId);
  } catch (e) {
    // no-op
  }
}

export default function Platform({ user, sessionId, onSignOut }) {
  var persisted = loadPlatformState(sessionId) || {};
  var convPhaseSt = useState(persisted.convPhase || 'discovery'), convPhase = convPhaseSt[0], setConvPhase = convPhaseSt[1];
  var convExtractionSt = useState(persisted.convExtraction || {}), convExtraction = convExtractionSt[0], setConvExtraction = convExtractionSt[1];
  var convModelSt = useState(persisted.convModel || null), convModel = convModelSt[0], setConvModel = convModelSt[1];
  var briefSt = useState(persisted.brief || null), brief = briefSt[0], setBrief = briefSt[1];
  var sellerFormSt = useState(persisted.sellerForm || null), sellerForm = sellerFormSt[0], setSellerForm = sellerFormSt[1];
  var selEngIdSt = useState(persisted.selEngId || null), selEngId = selEngIdSt[0], setSelEngId = selEngIdSt[1];
  // Listing-click -> chat context handoff (bidirectional discovery link).
  var injectSt = useState(null), injectMessage = injectSt[0], setInjectMessage = injectSt[1];

  // Persist on every change so a remount (tab switch/away-and-back, preview
  // reload) restores the panel instead of resetting to Home.
  useEffect(function () {
    savePlatformState(sessionId, { convPhase: convPhase, convExtraction: convExtraction, convModel: convModel, brief: brief, sellerForm: sellerForm, selEngId: selEngId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, convPhase, convExtraction, convModel, brief, sellerForm, selEngId]);

  var isAdmin = !!(user && user.email && ADMIN_EMAILS.indexOf(user.email.toLowerCase()) !== -1);

  function goHome() {
    setConvPhase('discovery');
  }

  function handleCard(cardKey) {
    if (cardKey === 'sellerDashboard') {
      // Seller dashboard (multiple engagements as cards) ships in a later
      // step. Route into the financial-interview persona first, not
      // straight into the valuation form - per the product brief, the AI
      // must understand the business before any valuation number gets
      // produced. FinancialModelPanel's onProceed already carries the
      // user into 'valuation' once the model is built, so this keeps the
      // one real pipeline (analyst -> valuation) instead of a second,
      // redundant entry point that skips it.
      setSellerForm(null);
      setSelEngId(null);
      setConvPhase('analyst');
      return;
    }
    if (cardKey === 'valuation') {
      // Starting a fresh valuation from the home screen - don't carry over
      // a form built for a different engagement.
      setSellerForm(null);
      setSelEngId(null);
    }
    setConvPhase(cardKey);
  }

  // --- ConversationEngine callbacks ----------------------------------------

  function handleExtraction(data) {
    setConvExtraction(data);
  }

  function handleModelComplete(model) {
    setConvModel(model);
    var computed = computeModel(model);

    // Professional credentials (CA name, membership number, firm) shape the
    // report per spec section 10 - best-effort fetch, falls back to the
    // platform-indicative defaults baked into buildV3FormFromModel if this
    // fails or the user has no profile row yet.
    var applyForm = function (profile) {
      setSellerForm(buildV3FormFromModel(model, computed, profile));
    };

    if (user && user.id) {
      var settled = false;
      var timeoutId = setTimeout(function () {
        if (settled) return;
        settled = true;
        applyForm(null);
      }, 3000);
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle().then(function (res) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        var p = res.data;
        applyForm(p ? {
          fullName: p.full_name,
          isProfessional: p.is_professional,
          designation: p.designation,
          membershipNumber: p.membership_number,
          firmName: p.firm_name,
          firmAddress: p.firm_address,
        } : null);
      }).catch(function () {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        applyForm(null);
      });
    } else {
      applyForm(null);
    }
  }

  function handleBriefComplete(briefData) {
    setBrief(briefData);
  }

  function handleAction(actionType) {
    // Direct-navigation actions (distinct from convPhase, which is already
    // driven by onPhaseChange) will route into SellerDashboard / specific
    // engagements once those exist. For now this is a pass-through hook so
    // ConversationEngine doesn't need to know Platform's future sub-routes.
    console.log('ConversationEngine action:', actionType);
  }

  function handleAskAiAboutListing(listing) {
    var text = 'I want to know more about ' + listing.business_name + ' (' + listing.sector + ', ' + listing.city + '). Can you analyse this business against my requirements?';
    setInjectMessage({ text: text, key: Date.now() + '_' + listing.id });
  }

  function handleReset() {
    setConvExtraction({});
    setConvModel(null);
    setBrief(null);
    setSellerForm(null);
    setSelEngId(null);
    clearPlatformState(sessionId);
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <NavBar user={user} isAdmin={isAdmin} onHome={goHome} onGoListings={function () { setConvPhase('listings'); }} onSignOut={onSignOut} />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ConversationEngine
          user={user}
          sessionId={sessionId}
          brief={brief}
          extraction={convExtraction}
          model={convModel}
          convPhase={convPhase}
          exchangeCount={0}
          onPhaseChange={setConvPhase}
          onExtraction={handleExtraction}
          onModelComplete={handleModelComplete}
          onBriefComplete={handleBriefComplete}
          onAction={handleAction}
          onReset={handleReset}
          injectMessage={injectMessage}
        />
        <RightPanel
          convPhase={convPhase}
          user={user}
          sellerForm={sellerForm}
          selEngId={selEngId}
          convExtraction={convExtraction}
          convModel={convModel}
          brief={brief}
          onCard={handleCard}
          onHomeFromValuation={goHome}
          onProceedToValuation={function () { setConvPhase('valuation'); }}
          onBrowseMatched={function () { setConvPhase('listings'); }}
          onAskAiAboutListing={handleAskAiAboutListing}
        />
      </div>
    </div>
  );
}
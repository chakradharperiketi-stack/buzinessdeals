import { useState, useEffect } from 'react';
import { ValuationPlatform, CreateListingModal } from './ValuationPlatform';
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
  { key: 'analyst', icon: 'ti-message-chatbot', color: '#7c3aed', title: 'Sell or Raise Capital', desc: 'A guided AI interview builds your financial model (P&L) first - Rs. 1,500, pay after it’s built - then carries into your listing or valuation.' },
  // Direct, no-interview path (see CreateListingModal, imported from
  // ValuationPlatform.jsx) - already-know-your-numbers sellers can submit a
  // listing straight away. It ships self-reported (muted badge, not the
  // green "Verified" one) - the AI Financial Model remains the way to a
  // Verified badge, pitched to the user right after they submit.
  { key: 'directListing', icon: 'ti-building-store', color: '#16a34a', title: 'List Your Business', desc: 'Already know your numbers? Submit a listing directly for review - no interview needed. Self-reported, not Verified.' },
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

function HomeScreen({ onCard, loadingKey, report, convExtraction, convModel }) {
  var hour = new Date().getHours();
  var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  // Resume affordance - without this, a returning user with a saved
  // interview/model/report in progress has no way to know it, and lands on
  // the same blank 3-card picker as a brand-new visitor every time.
  var hasExtraction = !!(convExtraction && Object.keys(convExtraction).length > 0);
  var hasDraft = !!(report || convModel || hasExtraction);
  var bizName = (convExtraction && convExtraction.businessProfile && convExtraction.businessProfile.name) || 'Your business';
  var statusLabel = report ? 'Financial model report ready' : convModel ? 'Model complete - report not generated yet' : 'Interview in progress';
  return (
    <div style={{ padding: '32px', maxWidth: '760px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 4px' }}>{greeting}.</h1>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 28px' }}>What would you like to do today?</p>
      {hasDraft && (
        <button onClick={function () { onCard('analyst'); }} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          textAlign: 'left', padding: '16px 20px', borderRadius: '14px', border: '1px solid var(--border-accent)',
          background: 'var(--bg-accent)', cursor: 'pointer', marginBottom: '20px',
        }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-accent)', margin: '0 0 3px' }}>Continue: {bizName}</p>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>{statusLabel}</p>
          </div>
          <i className="ti ti-arrow-right" aria-hidden="true" style={{ fontSize: '16px', color: 'var(--text-accent)', flexShrink: 0 }} />
        </button>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
        {ACTION_CARDS.map(function (c) {
          var isLoading = loadingKey === c.key;
          return (
            <button key={c.key} disabled={isLoading} onClick={function () { onCard(c.key); }} style={{
              textAlign: 'left', padding: '20px', borderRadius: '14px', border: '1px solid var(--border)',
              background: 'var(--surface-2)', cursor: isLoading ? 'default' : 'pointer', boxShadow: 'var(--shadow-sm)',
              opacity: isLoading ? 0.6 : 1,
            }}>
              <div style={{
                width: '38px', height: '38px', borderRadius: '10px', background: c.color + '1a',
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px',
              }}>
                <i className={'ti ' + (isLoading ? 'ti-loader-2' : c.icon)} aria-hidden="true" style={{ fontSize: '18px', color: c.color }} />
              </div>
              <p style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 4px' }}>{c.title}</p>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.55' }}>{isLoading ? 'Loading…' : c.desc}</p>
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

function RightPanel({ convPhase, user, sessionId, projectId, sellerForm, selEngId, convExtraction, convModel, brief, report, onReportGenerated, onCard, cardLoading, onHomeFromValuation, onProceedToValuation, onBrowseMatched, onAskAiAboutListing, onSellerFormChange }) {
  return (
    <div style={{ width: '65%', flex: 1, height: '100%', overflowY: 'auto', background: 'var(--surface-0)' }}>
      {convPhase === 'discovery' && <HomeScreen onCard={onCard} loadingKey={cardLoading} report={report} convExtraction={convExtraction} convModel={convModel} />}

      {convPhase === 'valuation' && (
        <ValuationPlatform
          user={user}
          engagementId={selEngId}
          initialForm={sellerForm}
          onHome={onHomeFromValuation}
          onFormChange={onSellerFormChange}
        />
      )}

      {convPhase === 'analyst' && (
        <FinancialModelPanel
          extraction={convExtraction}
          model={convModel}
          onProceed={onProceedToValuation}
          sessionId={sessionId}
          userId={user ? user.id : null}
          projectId={projectId}
          report={report}
          onReportGenerated={onReportGenerated}
        />
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
  // The generated AI Financial Model Report (see generate-financial-report
  // edge function) - persisted the same way as sellerForm/convModel so it
  // survives a remount instead of forcing regeneration (a real API call,
  // not free) every time the user tabs away and back.
  var reportSt = useState(persisted.report || null), report = reportSt[0], setReport = reportSt[1];
  // Account-anchored persistence (see supabase/migrations/add_projects.sql
  // and link_conversation_state.sql). Before this, convExtraction/convModel/
  // brief/report only ever lived in this browser's localStorage, keyed by
  // an anonymous per-browser sessionId with no link back to the account -
  // "log out, log back in (or a different browser/device), report is gone"
  // even though it was sitting untouched in financial_model_reports the
  // whole time, because nothing ever queried it back by user_id. For a
  // logged-in user, projectId becomes the real source of truth: fetched (or
  // created) once below, then used to pull the latest saved extraction/
  // model/brief/report from Supabase, which overwrites whatever the
  // synchronous localStorage seed above painted first. localStorage is kept
  // as-is purely for instant paint on remount and for the anonymous
  // (logged-out) flow, which is unaffected by any of this.
  var projectIdSt = useState(null), projectId = projectIdSt[0], setProjectId = projectIdSt[1];

  useEffect(function () {
    var cancelled = false;
    if (!user || !user.id) return undefined; // anonymous - untouched, localStorage-only as before

    supabase.from('projects').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(1).maybeSingle()
      .then(function (res) {
        if (cancelled) return null;
        if (res.data) return res.data;
        // First time this account has ever reached the platform - give them
        // a project to attach state to from the very first turn, rather
        // than creating one lazily mid-interview and risking an early turn
        // going unsaved.
        return supabase.from('projects').insert({ user_id: user.id, name: 'Untitled Business' }).select().single().then(function (r) { return r.data; });
      })
      .then(function (project) {
        if (cancelled || !project) return;
        setProjectId(project.id);
        return Promise.all([
          supabase.from('ai_conversations').select('extraction, model, brief').eq('project_id', project.id).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('financial_model_reports').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        ]).then(function (results) {
          if (cancelled) return;
          var convRow = results[0] && results[0].data;
          var reportRow = results[1] && results[1].data;
          // Supabase is authoritative once it resolves - overwrite whatever
          // the localStorage seed painted, don't merge (a stale local copy
          // should never win over the account's real saved state).
          if (convRow) {
            if (convRow.extraction) setConvExtraction(convRow.extraction);
            if (convRow.model) setConvModel(convRow.model);
            if (convRow.brief) setBrief(convRow.brief);
          }
          if (reportRow) setReport(reportRow);
        });
      })
      .catch(function () {
        // Best-effort - if this fails (offline, RLS misconfigured, etc.)
        // the user still has whatever localStorage seeded, same as before
        // this change existed. Never block the app on this.
      });

    return function () { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.id]);

  // Listing-click -> chat context handoff (bidirectional discovery link).
  var injectSt = useState(null), injectMessage = injectSt[0], setInjectMessage = injectSt[1];
  // Which HomeScreen card (if any) is mid-async-load (see handleCard's
  // 'valuation' case) - lets HomeScreen show a brief loading state instead
  // of appearing unresponsive while the profile-based form is fetched.
  var cardLoadingSt = useState(null), cardLoading = cardLoadingSt[0], setCardLoading = cardLoadingSt[1];
  // Direct "List Your Business" path - a modal overlay, not a convPhase, so
  // it can open on top of whatever's currently showing (including Home)
  // without disturbing the chat/right-panel state underneath it.
  var showDirectListingSt = useState(false), showDirectListing = showDirectListingSt[0], setShowDirectListing = showDirectListingSt[1];
  // Shown once, dismissibly, right after a self-reported listing is
  // submitted - the AI Financial Model upsell ("upgrade to Verified").
  var directListingUpsellSt = useState(false), directListingUpsell = directListingUpsellSt[0], setDirectListingUpsell = directListingUpsellSt[1];

  // Persist on every change so a remount (tab switch/away-and-back, preview
  // reload) restores the panel instead of resetting to Home.
  useEffect(function () {
    savePlatformState(sessionId, { convPhase: convPhase, convExtraction: convExtraction, convModel: convModel, brief: brief, sellerForm: sellerForm, selEngId: selEngId, report: report });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, convPhase, convExtraction, convModel, brief, sellerForm, selEngId, report]);

  var isAdmin = !!(user && user.email && ADMIN_EMAILS.indexOf(user.email.toLowerCase()) !== -1);

  function goHome() {
    setConvPhase('discovery');
  }

  // Shared by handleModelComplete (after the AI interview finishes) and
  // handleCard's direct "Valuation Report" entry (no interview at all) - both
  // need the same profile lookup so ValuationPlatform gets a non-null
  // initialForm with engagementType already set, instead of falling back to
  // the legacy "who is performing this valuation" landing screen.
  function loadSellerFormForProfile(model, computed, cb) {
    var applyForm = function (profile) {
      cb(buildV3FormFromModel(model, computed, profile));
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

  function handleCard(cardKey) {
    if (cardKey === 'directListing') {
      setShowDirectListing(true);
      return;
    }
    if (cardKey === 'valuation') {
      // Starting a fresh valuation from the home screen (no prior AI
      // interview) - don't carry over a form built for a different
      // engagement, and don't switch panels until a profile-based form is
      // ready, so ValuationPlatform never mounts with a null initialForm
      // (which would show the legacy engagementType picker screen).
      setSelEngId(null);
      setCardLoading('valuation');
      loadSellerFormForProfile(null, null, function (form) {
        setSellerForm(form);
        setConvPhase('valuation');
        setCardLoading(null);
      });
      return;
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
    loadSellerFormForProfile(model, computed, setSellerForm);
  }

  function handleBriefComplete(briefData) {
    setBrief(briefData);
  }

  // Any set_next_phase-driven transition into 'valuation' - clicking a chat
  // action button mid-conversation, from ANY persona (discovery, analyst,
  // wherever) - used to just flip convPhase directly via setConvPhase, same
  // as every other phase change. That's fine for every destination except
  // valuation: ValuationPlatform needs a profile-based initialForm or it
  // falls back to the legacy "who is performing this valuation" engagement-
  // type picker (see loadSellerFormForProfile's comment above). Only
  // handleCard('valuation') and handleModelComplete were ever taught to do
  // that pre-fetch - a mid-chat button into valuation skipped it entirely,
  // landing on the discarded picker screen even after a full conversation
  // of gathered numbers. Route every transition into 'valuation' through
  // the same pre-fetch, using whatever model this session already has (a
  // completed analyst model if one exists, else null - buildV3FormFromModel
  // handles either) so this can't regress again via a fourth entry point.
  function handlePhaseChange(nextPhase) {
    if (nextPhase === 'valuation' && !sellerForm) {
      setCardLoading('valuation');
      loadSellerFormForProfile(convModel, convModel ? computeModel(convModel) : null, function (form) {
        setSellerForm(form);
        setConvPhase(nextPhase);
        setCardLoading(null);
      });
      return;
    }
    setConvPhase(nextPhase);
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
    setReport(null);
    clearPlatformState(sessionId);
    // "Clear" is meant to let the user start completely from the beginning -
    // that means back at Home, not sitting in an emptied-out version of
    // whichever section they were already in.
    setConvPhase('discovery');
    // For a logged-in user, the old data isn't actually gone (it's the prior
    // project, still safely in Supabase) - clearing the CURRENT project's
    // data in place would destroy it. Instead, start a fresh project and
    // switch to it, same distinction "New Business" will make explicit once
    // there's a switcher UI (Phase 2) to move between them. Anonymous users
    // have no project concept - unaffected, same as before.
    if (user && user.id) {
      supabase.from('projects').insert({ user_id: user.id, name: 'Untitled Business' }).select().single()
        .then(function (res) { if (res.data) setProjectId(res.data.id); })
        .catch(function () { /* best-effort - worst case this session keeps the old projectId */ });
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <NavBar user={user} isAdmin={isAdmin} onHome={goHome} onGoListings={function () { setConvPhase('listings'); }} onSignOut={onSignOut} />
      {directListingUpsell && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
          padding: '10px 20px', background: '#ecfdf5', borderBottom: '1px solid #6ee7b7', flexShrink: 0,
        }}>
          <p style={{ fontSize: '12px', color: '#065f46', margin: 0, lineHeight: '1.5' }}>
            <strong>Listing submitted for review</strong> — it's marked self-reported for now. Complete the AI Financial Model (Rs. 1,500) any time to run a real valuation and upgrade it to a Verified badge, which buyers trust more.
          </p>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button onClick={function () { setDirectListingUpsell(false); handleCard('analyst'); }} style={{
              fontSize: '12px', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer',
              background: '#059669', color: '#fff', border: 'none', whiteSpace: 'nowrap',
            }}>Start AI Financial Model →</button>
            <button onClick={function () { setDirectListingUpsell(false); }} style={{
              fontSize: '12px', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer',
              background: 'transparent', color: '#065f46', border: '1px solid #6ee7b7',
            }}>Dismiss</button>
          </div>
        </div>
      )}
      {showDirectListing && (
        <CreateListingModal
          userId={user ? user.id : null}
          hasValuationReport={false}
          onClose={function () { setShowDirectListing(false); }}
          onSuccess={function () { setShowDirectListing(false); setDirectListingUpsell(true); }}
        />
      )}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ConversationEngine
          user={user}
          sessionId={sessionId}
          projectId={projectId}
          brief={brief}
          extraction={convExtraction}
          model={convModel}
          convPhase={convPhase}
          exchangeCount={0}
          onPhaseChange={handlePhaseChange}
          onExtraction={handleExtraction}
          onModelComplete={handleModelComplete}
          onBriefComplete={handleBriefComplete}
          onAction={handleAction}
          onReset={handleReset}
          onGoHome={goHome}
          injectMessage={injectMessage}
        />
        <RightPanel
          convPhase={convPhase}
          user={user}
          sessionId={sessionId}
          projectId={projectId}
          sellerForm={sellerForm}
          selEngId={selEngId}
          convExtraction={convExtraction}
          convModel={convModel}
          brief={brief}
          report={report}
          onReportGenerated={setReport}
          onCard={handleCard}
          cardLoading={cardLoading}
          onHomeFromValuation={goHome}
          onProceedToValuation={function () { setConvPhase('valuation'); }}
          onBrowseMatched={function () { setConvPhase('listings'); }}
          onAskAiAboutListing={handleAskAiAboutListing}
          onSellerFormChange={setSellerForm}
        />
      </div>
    </div>
  );
}
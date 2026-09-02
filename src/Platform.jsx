import { useState, useEffect } from 'react';
import { ValuationPlatform, CreateListingModal } from './ValuationPlatform';
import ConversationEngine from './ConversationEngine';
import FinancialModelPanel, { computeCompletionPct } from './FinancialModelPanel';
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

function NavBar({ user, isAdmin, onHome, onGoListings, onGoBusinesses, onSignOut }) {
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

      {/* "Browse listings" used to be a third flex child alongside the logo
          and the avatar, so justify-content:space-between put it dead
          center of the whole bar - visually stranded, not associated with
          either side. Grouping it with the avatar under one right-aligned
          flex container puts space-between back to its intended two groups
          (logo | everything else), landing this button naturally beside the
          profile menu instead of floating in the middle of the page. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
            boxShadow: '0 12px 32px rgba(0,0,0,0.2)', minWidth: '230px', overflow: 'hidden', border: '1px solid var(--border)',
          }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <p style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(user && user.email) || 'Account'}
              </p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>{isAdmin ? 'Admin' : 'Member'}</p>
            </div>
            {/* Real, working destinations - each backed by data and a UI that
                already exists (Home = discovery screen, My Businesses = the
                project list on that same screen, forced open). */}
            {[
              { label: 'Home', icon: 'ti-home', action: onHome },
              { label: 'My Businesses', icon: 'ti-building', action: onGoBusinesses },
            ].map(function (item) {
              return (
                <button key={item.label} onClick={function () { setMenuOpen(false); item.action(); }} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '10px 14px',
                  background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', fontSize: '13px',
                  color: 'var(--text-primary)', cursor: 'pointer',
                }}>
                  <i className={'ti ' + item.icon} aria-hidden="true" style={{ fontSize: '15px', color: 'var(--text-muted)' }} />
                  {item.label}
                </button>
              );
            })}
            {/* Not built yet - no engagements list, interests list, or
                profile/admin screen exists anywhere in the app to route to.
                These used to silently call onHome() instead, which looked
                identical to the button doing nothing. Shown disabled with a
                "Soon" tag instead, so the gap is honest rather than hidden. */}
            {[
              { label: 'My Engagements', icon: 'ti-clipboard-list' },
              { label: 'My Interests', icon: 'ti-heart' },
              { label: 'Profile & Settings', icon: 'ti-user-cog' },
            ].concat(isAdmin ? [{ label: 'Admin Portal', icon: 'ti-shield-lock' }] : []).map(function (item) {
              return (
                <div key={item.label} title="Coming soon" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', width: '100%',
                  padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: '13px', color: 'var(--text-muted)',
                  cursor: 'default', opacity: 0.65,
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <i className={'ti ' + item.icon} aria-hidden="true" style={{ fontSize: '15px', color: 'var(--text-muted)' }} />
                    {item.label}
                  </span>
                  <span style={{
                    fontSize: '9px', fontWeight: '700', color: 'var(--text-muted)', background: 'var(--surface-2)',
                    padding: '2px 6px', borderRadius: '999px', textTransform: 'uppercase', letterSpacing: '0.03em',
                  }}>Soon</span>
                </div>
              );
            })}
            <button onClick={function () { setMenuOpen(false); onSignOut(); }} style={{
              display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '10px 14px',
              background: 'transparent', border: 'none', fontSize: '13px', color: 'var(--text-danger)', cursor: 'pointer',
            }}>
              <i className="ti ti-logout" aria-hidden="true" style={{ fontSize: '15px' }} />
              Sign out
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function projectStatusLabel(status) {
  if (status === 'model_complete') return 'Model complete';
  if (status === 'listed') return 'Listed';
  if (status === 'archived') return 'Archived';
  return 'Draft';
}
function relativeTime(iso) {
  if (!iso) return '';
  var diffMs = Date.now() - new Date(iso).getTime();
  var mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}

var STATUS_COLORS = { draft: '#64748b', model_complete: '#16a34a', listed: '#2563eb', archived: '#94a3b8' };

function BusinessRow({ p, isActive, hasDraft, activePct, switchingProject, onOpen, onArchive, onDelete, isEditing, onStartEdit, onRename, onCancelEdit }) {
  var color = STATUS_COLORS[p.status] || STATUS_COLORS.draft;
  var nameInputSt = useState(p.name), nameInput = nameInputSt[0], setNameInput = nameInputSt[1];

  function commitRename() {
    var trimmed = nameInput.trim();
    onRename(trimmed || p.name); // empty input just cancels back to the existing name, never blanks it
  }

  if (isEditing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface-1)' }}>
        <input autoFocus value={nameInput} onChange={function (e) { setNameInput(e.target.value); }}
          onKeyDown={function (e) { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') onCancelEdit(); }}
          onBlur={commitRename}
          style={{ flex: 1, fontSize: '13px', padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border-accent)', background: 'var(--surface-0)', color: 'var(--text-primary)' }}
        />
        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Enter to save</span>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
      padding: '9px 12px', borderBottom: '1px solid var(--border)',
      background: isActive ? 'var(--bg-accent)' : 'transparent',
    }}>
      <button disabled={switchingProject} onClick={onOpen} style={{
        flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left',
        background: 'transparent', border: 'none', cursor: switchingProject ? 'default' : 'pointer', padding: 0,
      }}>
        <span style={{
          fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '999px', flexShrink: 0,
          background: color + '1a', color: color, whiteSpace: 'nowrap',
        }}>{projectStatusLabel(p.status)}</span>
        <span style={{
          fontSize: '13px', fontWeight: isActive ? '600' : '500', color: isActive ? 'var(--text-accent)' : 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{p.name}{isActive ? ' · Active' : ''}{isActive && hasDraft ? ' (' + activePct + '%)' : ''}</span>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{relativeTime(p.updated_at)}</span>
        <button title="Rename" onClick={function (e) { e.stopPropagation(); setNameInput(p.name); onStartEdit(); }} disabled={switchingProject} style={{
          background: 'transparent', border: 'none', cursor: switchingProject ? 'default' : 'pointer', color: 'var(--text-muted)', padding: '2px', display: 'flex',
        }}>
          <i className="ti ti-pencil" aria-hidden="true" style={{ fontSize: '14px' }} />
        </button>
        {onArchive && (
          <button title="Archive" onClick={onArchive} disabled={switchingProject} style={{
            background: 'transparent', border: 'none', cursor: switchingProject ? 'default' : 'pointer',
            color: 'var(--text-muted)', padding: '2px', display: 'flex',
          }}>
            <i className="ti ti-archive" aria-hidden="true" style={{ fontSize: '14px' }} />
          </button>
        )}
        {onDelete && (
          <button title="Delete permanently" onClick={onDelete} disabled={switchingProject} style={{
            background: 'transparent', border: 'none', cursor: switchingProject ? 'default' : 'pointer',
            color: '#dc2626', padding: '2px', display: 'flex',
          }}>
            <i className="ti ti-trash" aria-hidden="true" style={{ fontSize: '14px' }} />
          </button>
        )}
        <button disabled={switchingProject} onClick={onOpen} style={{ background: 'transparent', border: 'none', cursor: switchingProject ? 'default' : 'pointer', padding: '2px', display: 'flex' }}>
          <i className="ti ti-arrow-right" aria-hidden="true" style={{ fontSize: '14px', color: isActive ? 'var(--text-accent)' : 'var(--text-muted)' }} />
        </button>
      </div>
    </div>
  );
}

function HomeScreen({ onCard, loadingKey, report, convExtraction, convModel, projectId, projectsList, onSwitchProject, onNewProject, onArchiveProject, onUnarchiveProject, onRenameProject, onDeleteProject, autoEditProjectId, onAutoEditConsumed, switchingProject, forceBusinessPanel }) {
  var hour = new Date().getHours();
  var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  var showArchivedSt = useState(false), showArchived = showArchivedSt[0], setShowArchived = showArchivedSt[1];
  var editingIdSt = useState(null), editingId = editingIdSt[0], setEditingId = editingIdSt[1];
  // A newly-created business needs to actually be earmarked, not left as
  // "Untitled Business" indefinitely - this opens the rename field on it
  // automatically right after creation (skippable - clicking away just
  // keeps the default name, this isn't a hard-blocking prompt).
  useEffect(function () {
    if (autoEditProjectId) {
      setEditingId(autoEditProjectId);
      onAutoEditConsumed && onAutoEditConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEditProjectId]);
  // Resume affordance - without this, a returning user with a saved
  // interview/model/report in progress has no way to know it, and lands on
  // the same blank 3-card picker as a brand-new visitor every time.
  var hasExtraction = !!(convExtraction && Object.keys(convExtraction).length > 0);
  var hasDraft = !!(report || convModel || hasExtraction);
  var activePct = hasDraft ? computeCompletionPct(convModel || convExtraction) : 0;
  var allProjects = projectsList || [];
  var liveProjects = allProjects.filter(function (p) { return p.status !== 'archived'; });
  var archivedProjects = allProjects.filter(function (p) { return p.status === 'archived'; });
  // Stays a single quiet row for the common one-project case; upgrades to
  // the full list the moment there's more than one, or once there's a New
  // Business action worth surfacing (something exists on the current one to
  // branch off from). Capped height below, not unbounded growth - the
  // panel's footprint stays fixed no matter how many businesses accumulate.
  var showBusinessPanel = hasDraft || liveProjects.length > 1 || !!forceBusinessPanel;

  return (
    <div style={{ padding: '32px', maxWidth: '760px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 4px' }}>{greeting}.</h1>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 28px' }}>What would you like to do today?</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', marginBottom: showBusinessPanel ? '28px' : 0 }}>
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

      {showBusinessPanel && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <p style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Your businesses</p>
            {onNewProject && (
              <button onClick={onNewProject} disabled={switchingProject} style={{
                fontSize: '12px', fontWeight: '600', color: 'var(--text-accent)', background: 'transparent', border: 'none',
                cursor: switchingProject ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: 0,
              }}>
                <i className="ti ti-plus" aria-hidden="true" style={{ fontSize: '13px' }} /> New Business
              </button>
            )}
          </div>
          {/* Bounded height + scroll, not unbounded growth - this is the
              whole fix for "the more business I add, cards go further
              down": the panel's footprint stops growing past ~5 rows
              regardless of how many businesses the account has. */}
          <div style={{ border: '1px solid var(--border)', borderRadius: '12px', maxHeight: '260px', overflowY: 'auto' }}>
            {liveProjects.map(function (p) {
              var isActive = p.id === projectId;
              return (
                <BusinessRow key={p.id} p={p} isActive={isActive} hasDraft={hasDraft} activePct={activePct} switchingProject={switchingProject}
                  onOpen={function () { isActive ? onCard('analyst') : onSwitchProject(p.id); }}
                  onArchive={isActive ? null : function (e) { e.stopPropagation(); onArchiveProject(p.id); }}
                  onDelete={null}
                  isEditing={editingId === p.id}
                  onStartEdit={function () { setEditingId(p.id); }}
                  onCancelEdit={function () { setEditingId(null); }}
                  onRename={function (newName) { setEditingId(null); onRenameProject(p.id, newName); }} />
              );
            })}
          </div>
          {archivedProjects.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <button onClick={function () { setShowArchived(!showArchived); }} style={{
                fontSize: '11px', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
              }}>{showArchived ? 'Hide' : 'Show'} {archivedProjects.length} archived</button>
              {showArchived && (
                <div style={{ border: '1px solid var(--border)', borderRadius: '12px', marginTop: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                  {archivedProjects.map(function (p) {
                    return (
                      <BusinessRow key={p.id} p={p} isActive={false} hasDraft={false} activePct={0} switchingProject={switchingProject}
                        onOpen={function () { onUnarchiveProject(p.id); }}
                        onArchive={null}
                        onDelete={function (e) { e.stopPropagation(); onDeleteProject(p.id, p.name); }}
                        isEditing={editingId === p.id}
                        onStartEdit={function () { setEditingId(p.id); }}
                        onCancelEdit={function () { setEditingId(null); }}
                        onRename={function (newName) { setEditingId(null); onRenameProject(p.id, newName); }} />
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
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

function RightPanel({ convPhase, user, sessionId, projectId, sellerForm, selEngId, convExtraction, convModel, brief, report, onReportGenerated, onCard, cardLoading, onHomeFromValuation, onProceedToValuation, onBrowseMatched, onAskAiAboutListing, onSellerFormChange, projectsList, onSwitchProject, onNewProject, onArchiveProject, onUnarchiveProject, onRenameProject, onDeleteProject, autoEditProjectId, onAutoEditConsumed, switchingProject, forceBusinessPanel }) {
  return (
    <div style={{ width: '65%', flex: 1, height: '100%', overflowY: 'auto', background: 'var(--surface-0)' }}>
      {convPhase === 'discovery' && <HomeScreen onCard={onCard} loadingKey={cardLoading} report={report} convExtraction={convExtraction} convModel={convModel} projectId={projectId} projectsList={projectsList} onSwitchProject={onSwitchProject} onNewProject={onNewProject} onArchiveProject={onArchiveProject} onUnarchiveProject={onUnarchiveProject} onRenameProject={onRenameProject} onDeleteProject={onDeleteProject} autoEditProjectId={autoEditProjectId} onAutoEditConsumed={onAutoEditConsumed} switchingProject={switchingProject} forceBusinessPanel={forceBusinessPanel} />}

      {convPhase === 'valuation' && (
        <ValuationPlatform
          user={user}
          engagementId={selEngId}
          initialForm={sellerForm}
          onHome={onHomeFromValuation}
          onFormChange={onSellerFormChange}
          // Only shown when this project has a completed AI Financial Model
          // to go back to - a direct/blank valuation (no convModel) has
          // nowhere to "go back" to, so Home is the only exit in that case.
          // Reuses the plain onCard('analyst') phase flip (no re-fetch, no
          // reset of convModel/convExtraction), so the model already on
          // screen just reappears exactly as it was left.
          onBackToModel={convModel ? function () { onCard('analyst'); } : null}
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

// Deep, non-destructive merge used only when loading a project's saved
// state (see the useEffect below) - a value present in `next` only ever
// overwrites `prior` when it's actually non-empty, checked all the way
// down, not just at the top level. Mirrors the same principle as
// ai-search-v2's mergeExtraction (never let an emptier turn silently erase
// real data from an earlier one) but goes one level deeper - a shallow
// merge would still let a later row's sparsely-filled businessProfile
// object (e.g. only businessType known) wholesale-overwrite an earlier
// row's fully-filled one, which is exactly the "lost data" bug this fixes.
function isEmptyMergeValue(v) {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}
function deepMergeExtraction(prior, next) {
  if (isEmptyMergeValue(next)) return prior;
  if (isEmptyMergeValue(prior)) return next;
  if (Array.isArray(next) || Array.isArray(prior)) {
    // No stable identity across two sessions' segment/lineItem arrays to
    // merge element-by-element - the fuller array is the safer bet.
    return (Array.isArray(next) ? next.length : 0) >= (Array.isArray(prior) ? prior.length : 0) ? next : prior;
  }
  if (typeof next === 'object' && typeof prior === 'object') {
    var merged = Object.assign({}, prior);
    Object.keys(next).forEach(function (key) {
      merged[key] = deepMergeExtraction(prior[key], next[key]);
    });
    return merged;
  }
  return next;
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
  // Phase 2: the account's full project list (id/name/status/updated_at
  // only - deliberately lightweight, not each project's full extraction,
  // so the switcher doesn't fire an N-query fan-out just to render a list).
  // Empty for an anonymous user, same as projectId.
  var projectsListSt = useState([]), projectsList = projectsListSt[0], setProjectsList = projectsListSt[1];
  var switchingProjectSt = useState(false), switchingProject = switchingProjectSt[0], setSwitchingProject = switchingProjectSt[1];
  // One-shot signal: set right after createNewProject succeeds, consumed by
  // HomeScreen to auto-open that project's rename field, then cleared back
  // to null via onAutoEditConsumed - see HomeScreen's effect.
  var autoEditProjectIdSt = useState(null), autoEditProjectId = autoEditProjectIdSt[0], setAutoEditProjectId = autoEditProjectIdSt[1];
  // "My Businesses" nav entry - HomeScreen's businesses panel already has
  // real data and a real UI (list, rename, archive, switch), it just stays
  // collapsed to a single quiet row for the common one-project/no-draft
  // case (see HomeScreen's showBusinessPanel comment). This flag forces it
  // open once the user has explicitly asked to see it via the nav menu,
  // instead of that menu item silently doing nothing distinguishable from
  // plain Home for that common case.
  var forceBusinessPanelSt = useState(false), forceBusinessPanel = forceBusinessPanelSt[0], setForceBusinessPanel = forceBusinessPanelSt[1];

  function refreshProjectsList() {
    if (!user || !user.id) return Promise.resolve([]);
    return supabase.from('projects').select('id, name, status, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false })
      .then(function (res) {
        var list = res.data || [];
        setProjectsList(list);
        return list;
      })
      .catch(function () { return []; });
  }

  // Loads one project's saved state into the right panel and applies
  // whatever is found - does NOT clear first. On first mount that's
  // correct as-is (nothing to clear yet beyond the synchronous localStorage
  // seed, which should only ever be overwritten by a real result, never
  // blanked out from under it while the fetch is still in flight - blanking
  // eagerly would flash seed-data -> blank -> real-data on every load, and
  // would wipe a good seed if the fetch happened to fail). Callers that
  // switch AWAY from an already-loaded project (switchProject) are
  // responsible for clearing state themselves first - see there.
  function loadProjectData(pid) {
    if (!pid) return Promise.resolve();
    return Promise.all([
      // Every conversation row this project has, not just the most
      // recently touched one. backfill_projects.sql links ALL of an
      // account's pre-existing session rows to a single project, and
      // "most recently updated" is not the same as "most complete" - a
      // later throwaway test session (near-empty extraction) can outrank
      // the real finished interview purely on timestamp, which is exactly
      // the "lost data" bug reported after the first backfill run. Fetch
      // them all, oldest first, and deep-merge - see deepMergeExtraction
      // above. Going forward (post-Phase-1) persistConversation always
      // PATCHes the one project-linked row, so this multi-row case should
      // only ever matter for legacy, pre-backfill history.
      supabase.from('ai_conversations').select('extraction, model, brief').eq('project_id', pid).order('updated_at', { ascending: true }),
      supabase.from('financial_model_reports').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]).then(function (results) {
      var convRows = (results[0] && results[0].data) || [];
      var reportRow = results[1] && results[1].data;
      var mergedExtraction = convRows.reduce(function (acc, row) { return deepMergeExtraction(acc, row.extraction); }, null);
      var mergedModel = convRows.reduce(function (acc, row) { return deepMergeExtraction(acc, row.model); }, null);
      var mergedBrief = convRows.reduce(function (acc, row) { return deepMergeExtraction(acc, row.brief); }, null);
      if (mergedExtraction) setConvExtraction(mergedExtraction);
      if (mergedModel) setConvModel(mergedModel);
      if (mergedBrief) setBrief(mergedBrief);
      if (reportRow) setReport(reportRow);
    }).catch(function () {
      // Best-effort - worst case this project shows blank until the next
      // successful load; never block the app on this.
    });
  }

  // Switches the active project: points projectId/right-panel state at a
  // different one of the account's projects. Always lands back on Home
  // (rather than deep-linking into whatever phase the OTHER project last
  // left off in) - predictable, and matches the resume-banner pattern
  // already established for the single-project case.
  function switchProject(pid) {
    if (pid === projectId) return;
    setSwitchingProject(true);
    setProjectId(pid);
    setSellerForm(null);
    setSelEngId(null);
    setConvPhase('discovery');
    // Clear explicitly before fetching - unlike the initial-mount call to
    // loadProjectData, this one really does need to blank the PREVIOUS
    // project's data first, or it stays visible on screen until the new
    // project's fetch resolves.
    setConvExtraction({});
    setConvModel(null);
    setBrief(null);
    setReport(null);
    loadProjectData(pid).then(function () { setSwitchingProject(false); });
  }

  function createNewProject() {
    if (!user || !user.id) return;
    setSwitchingProject(true);
    supabase.from('projects').insert({ user_id: user.id, name: 'Untitled Business' }).select().single()
      .then(function (res) {
        if (!res.data) { setSwitchingProject(false); return; }
        setProjectId(res.data.id);
        setSellerForm(null);
        setSelEngId(null);
        setConvExtraction({});
        setConvModel(null);
        setBrief(null);
        setReport(null);
        setConvPhase('discovery');
        setSwitchingProject(false);
        setAutoEditProjectId(res.data.id);
        refreshProjectsList();
      })
      .catch(function () { setSwitchingProject(false); });
  }

  // Answers "how do I tell which is which" directly: available on every
  // project at any time (not just at creation), so a bad or duplicate
  // auto-derived name (e.g. two different businesses that both extracted
  // to the same generic businessType) can always be fixed by hand.
  function renameProject(pid, name) {
    if (!pid || !name) return;
    supabase.from('projects').update({ name: name }).eq('id', pid)
      .then(function () { refreshProjectsList(); }).catch(function () {});
  }

  // Only reachable from the archived list (see HomeScreen) - deliberately
  // not available on a live project, so a delete always passes through
  // archive first. Permanent and irreversible: cascades to that project's
  // ai_conversations/financial_model_reports rows via the FK in
  // add_projects.sql. Confirmed explicitly before it fires.
  function deleteProjectPermanently(pid, name) {
    if (!pid) return;
    var ok = typeof window !== 'undefined' && window.confirm(
      'Permanently delete "' + (name || 'this business') + '"? This removes its entire interview history and any generated report. This cannot be undone.'
    );
    if (!ok) return;
    supabase.from('projects').delete().eq('id', pid)
      .then(function () { refreshProjectsList(); }).catch(function () {});
  }

  // Best-effort project.updated_at bump so "most recently touched" sorting
  // (both the switcher list order and which project loads by default on
  // next login) actually tracks activity, not just row creation time - see
  // handleExtraction below. Never awaited, never blocks the UI.
  function touchProjectActivity(pid) {
    if (!pid) return;
    supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', pid).then(function () {}).catch(function () {});
  }

  // Soft-delete only - archiving sets status and hides the project from the
  // default switcher list, it never drops the row (or the conversation/
  // report rows hanging off it via project_id). Reversible via
  // unarchiveProject. A true permanent delete isn't offered here on
  // purpose - this is exactly the kind of data an earlier round of this
  // build already lost once by accident; nothing here should risk that
  // again for a feature whose whole point is decluttering a list.
  function archiveProject(pid) {
    if (!pid || pid === projectId) return; // never archive the one currently open
    supabase.from('projects').update({ status: 'archived' }).eq('id', pid)
      .then(function () { refreshProjectsList(); }).catch(function () {});
  }
  function unarchiveProject(pid) {
    if (!pid) return;
    // Recompute rather than blindly resetting to 'draft' - the column has
    // no "status before archiving" memory, so a project that was actually
    // model_complete before being archived needs that re-derived from
    // whether it still has a report/model, not just reset to draft.
    Promise.all([
      supabase.from('financial_model_reports').select('id').eq('project_id', pid).limit(1).maybeSingle(),
      supabase.from('ai_conversations').select('model').eq('project_id', pid).not('model', 'is', null).limit(1).maybeSingle(),
    ]).then(function (results) {
      var hasReport = !!(results[0] && results[0].data);
      var hasModel = !!(results[1] && results[1].data);
      var status = hasReport || hasModel ? 'model_complete' : 'draft';
      return supabase.from('projects').update({ status: status, updated_at: new Date().toISOString() }).eq('id', pid);
    }).then(function () { refreshProjectsList(); }).catch(function () {});
  }

  useEffect(function () {
    var cancelled = false;
    if (!user || !user.id) return undefined; // anonymous - untouched, localStorage-only as before

    refreshProjectsList()
      .then(function (list) {
        if (cancelled) return null;
        // Never auto-select an archived project as the default active one,
        // even if it happens to be the most recently updated row.
        var live = list.filter(function (p) { return p.status !== 'archived'; });
        if (live.length > 0) return live[0]; // already sorted by updated_at desc
        // First time this account has ever reached the platform - give them
        // a project to attach state to from the very first turn, rather
        // than creating one lazily mid-interview and risking an early turn
        // going unsaved.
        return supabase.from('projects').insert({ user_id: user.id, name: 'Untitled Business' }).select().single()
          .then(function (r) { return r.data; })
          .then(function (project) { return refreshProjectsList().then(function () { return project; }); });
      })
      .then(function (project) {
        if (cancelled || !project) return;
        setProjectId(project.id);
        return loadProjectData(project.id);
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

  function goBusinesses() {
    setForceBusinessPanel(true);
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
      // Reuse this project's completed AI Financial Model if one exists -
      // exactly what handleProceedFromModel does for the "Use this model
      // for valuation ->" button. This card used to ALWAYS seed a blank
      // valuation (model=null), regardless of whether a completed,
      // confirmed model already existed for the active project - which is
      // how real numbers, built moments earlier, could look like they
      // "vanished" the instant the user went Home and reopened valuation
      // from this card instead of that button. There's no reason those two
      // paths should behave differently when they land on the same
      // project: if a model exists, use it; only fall back to a blank form
      // (model=null) when there genuinely isn't one yet, so
      // ValuationPlatform still never mounts with a null initialForm (which
      // would show the legacy engagementType picker screen).
      setSelEngId(null);
      setCardLoading('valuation');
      loadSellerFormForProfile(convModel, convModel ? computeModel(convModel) : null, function (form) {
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
    touchProjectActivity(projectId);
    // Opportunistic rename off the AI's own extraction, once it knows one -
    // without this every project in the switcher would read "Untitled
    // Business" forever, which defeats the point of a list. Only fires
    // while the project is still on the default name, so it never
    // clobbers something the account holder set deliberately (renaming is
    // a later, explicit-UI concern, not built here).
    var bp = data && data.businessProfile;
    var derivedName = bp && (bp.name || bp.businessType);
    if (derivedName && projectId) {
      var current = projectsList.filter(function (p) { return p.id === projectId; })[0];
      if (!current || current.name === 'Untitled Business') {
        supabase.from('projects').update({ name: derivedName }).eq('id', projectId)
          .then(function () { refreshProjectsList(); }).catch(function () {});
      }
    }
  }

  function handleModelComplete(model) {
    setConvModel(model);
    var computed = computeModel(model);
    // Professional credentials (CA name, membership number, firm) shape the
    // report per spec section 10 - best-effort fetch, falls back to the
    // platform-indicative defaults baked into buildV3FormFromModel if this
    // fails or the user has no profile row yet.
    loadSellerFormForProfile(model, computed, setSellerForm);
    // Surfaces in the project switcher (see HomeScreen) without it having
    // to fetch every project's full extraction just to show a status badge.
    if (projectId) {
      supabase.from('projects').update({ status: 'model_complete', updated_at: new Date().toISOString() }).eq('id', projectId)
        .then(function () {}).catch(function () {});
    }
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
    // Checking sellerForm.engagementType, not just sellerForm's truthiness,
    // is deliberate: a sellerForm object can be truthy but still lack
    // engagementType (see the comment on ValuationPlatform's onFormChange
    // effect - that was, until just now, how a visit to the picker screen
    // silently poisoned this exact state, permanently, even in localStorage).
    // Treating that shape the same as "no sellerForm yet" makes this guard
    // self-healing against any such object already sitting in memory or
    // localStorage from before that source fix existed.
    if (nextPhase === 'valuation' && !(sellerForm && sellerForm.engagementType)) {
      setCardLoading('valuation');
      // NOTE: this "only rebuild if sellerForm looks empty" guard is
      // deliberately conservative here, for the ConversationEngine-driven
      // caller (a mid-chat "set_next_phase" nudge shouldn't blow away a
      // valuation the user is already mid-edit on). The "Use this model for
      // valuation" button in FinancialModelPanel does NOT go through this
      // function any more - see handleProceedFromModel below, which always
      // rebuilds. Splitting these apart is what fixed a real bug: a
      // sellerForm that already has engagementType set (so this guard would
      // leave it alone) can still have been built from stale/empty data -
      // e.g. handleCard('valuation')'s deliberate model=null seed, from an
      // earlier direct "Valuation Report" click before this project's AI
      // interview ever ran. Routing the button through this shared,
      // cache-trusting guard is exactly how a confirmed, non-zero completed
      // model (revenue.annualTotal for real, verified via the Financial
      // Model screen) still produced an all-zero valuation form: the guard
      // saw an already-"complete" stale sellerForm and never rebuilt it.
      loadSellerFormForProfile(convModel, convModel ? computeModel(convModel) : null, function (form) {
        setSellerForm(form);
        setConvPhase(nextPhase);
        setCardLoading(null);
      });
      return;
    }
    setConvPhase(nextPhase);
  }

  // The FinancialModelPanel "Use this model for valuation ->" button always
  // means exactly what it says: build the valuation form from the model
  // that's on screen right now. Unlike handlePhaseChange's other caller (a
  // mid-chat nudge, where reusing an in-progress sellerForm is the safer
  // default), there's no ambiguity to preserve here - so this never trusts
  // whatever sellerForm already happens to be in state, it always rebuilds
  // fresh from the current convModel.
  function handleProceedFromModel() {
    setCardLoading('valuation');
    loadSellerFormForProfile(convModel, convModel ? computeModel(convModel) : null, function (form) {
      setSellerForm(form);
      setConvPhase('valuation');
      setCardLoading(null);
    });
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
      <NavBar user={user} isAdmin={isAdmin} onHome={goHome} onGoBusinesses={goBusinesses} onGoListings={function () { setConvPhase('listings'); }} onSignOut={onSignOut} />
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
          // Forces a clean remount on project switch - the chat log, its
          // restore effect, exchangeCount, pending-action state etc. all
          // reset from scratch rather than needing every internal piece of
          // ConversationEngine's state hand-audited for cross-project
          // leakage. Falls back to sessionId for the anonymous (no
          // project) flow, unaffected by any of this.
          key={projectId || sessionId}
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
          // Goes through handleProceedFromModel, NOT handlePhaseChange - this
          // button always means "build the valuation from the model that's
          // on screen right now", so it must always rebuild sellerForm, not
          // defer to handlePhaseChange's cache-trusting guard. That guard
          // (correct for a mid-chat nudge, where preserving an in-progress
          // edit is the right default) was, until this fix, also the path
          // this button used - so a stale-but-"complete-shaped" sellerForm
          // already sitting in state (e.g. from a much earlier direct
          // "Valuation Report" click before this project's AI interview had
          // ever run) would satisfy the guard and never get rebuilt, even
          // though the just-completed model had real, confirmed numbers.
          // See handleProceedFromModel's own comment for the full story.
          onProceedToValuation={handleProceedFromModel}
          onBrowseMatched={function () { setConvPhase('listings'); }}
          onAskAiAboutListing={handleAskAiAboutListing}
          onSellerFormChange={setSellerForm}
          forceBusinessPanel={forceBusinessPanel}
          projectsList={projectsList}
          onSwitchProject={switchProject}
          onNewProject={createNewProject}
          onArchiveProject={archiveProject}
          onUnarchiveProject={unarchiveProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProjectPermanently}
          autoEditProjectId={autoEditProjectId}
          onAutoEditConsumed={function () { setAutoEditProjectId(null); }}
          switchingProject={switchingProject}
        />
      </div>
    </div>
  );
}
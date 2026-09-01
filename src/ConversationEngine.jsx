import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { callAiSearch, stripTags } from './lib/aiSearch';

// ============================================================================
// ConversationEngine — THE single chat component for the authenticated
// platform. Every persona (Router, Financial Analyst, Buyer Qualification,
// V3 Guide, Listings Advisor) renders through this one component; convPhase
// picks which persona is "live" server-side and which copy/behaviour shows
// here. Do not create BuyerInterview / AIFinancialAnalyst / any other chat
// component - critical rule #4.
// ============================================================================

var RESTORE_TIMEOUT_MS = 3000;
var MAX_DISCOVERY_DOTS = 6;

var GREETING = "Welcome to BuzinessDeals. I am your AI advisor — tell me whether you're looking to buy, sell, or value a business, and I'll point you in the right direction.";

var PERSONAS = {
  discovery: { label: 'AI Advisor', icon: 'ti-compass' },
  analyst: { label: 'Financial Analyst', icon: 'ti-user-check' },
  buyerQualification: { label: 'Buyer Qualification', icon: 'ti-briefcase' },
  valuation: { label: 'V3 Guide', icon: 'ti-chart-line' },
  listings: { label: 'Listings Advisor', icon: 'ti-list-search' },
};

// Shown once, automatically, whenever convPhase changes - whether the
// change came from a chat action button or a direct click elsewhere in the
// platform (e.g. a HomeScreen card). Exact wording for analyst /
// buyerQualification / valuation is per spec; discovery / listings are
// reasonable extensions in the same voice since the spec did not give
// literal text for those two.
var TRANSITION_MESSAGES = {
  analyst: 'Starting your financial interview now. I will ask questions about your business one at a time. Watch the right panel update as we go.',
  buyerQualification: 'Starting your buyer qualification. I will ask 7 questions to build your Acquisition Brief.',
  valuation: 'Opening the valuation tool on the right. Ask me anything about each section as you fill it in.',
  listings: "Here are listings that match your profile. Ask me about any of them — price, EBITDA multiple, or deal structure.",
  discovery: "Back in discovery — tell me what you'd like to do next.",
};

function normaliseMessage(m) {
  return { role: m.role === 'user' ? 'user' : 'assistant', text: m.text != null ? m.text : (m.content || '') };
}

// Defense-in-depth backstop, not a substitute for the "no markdown in chat"
// prompt instruction in ai-search-v2 - that instruction is not 100% reliable
// (confirmed: it was live in production and the model still emitted literal
// **bold** in a user's test). The chat panel has no markdown renderer, so a
// leaked marker shows up as a literal asterisk/hash cluttering the message
// no matter how well-worded the prompt is. Strip on the rendering side too,
// so a prompt-compliance slip can never reach the screen. Assistant replies
// only - never touches what the user actually typed.
function cleanAssistantText(text) {
  if (!text) return text;
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')   // **bold** -> bold (paired)
    .replace(/\*\*/g, '')              // any stray unpaired **
    .replace(/^#{1,6}\s+/gm, '')       // # / ## headers at line start
    .replace(/^\*\s+/gm, '- ');        // "* item" bullets -> "- item"
}

function briefToContext(brief) {
  if (!brief) return '';
  if (brief.summary) return brief.summary;
  var parts = [];
  if (brief.buyerType) parts.push('Buyer type: ' + brief.buyerType);
  if (brief.sector && brief.sector.length) parts.push('Sector: ' + brief.sector.join(', '));
  if (brief.geography && brief.geography.length) parts.push('Geography: ' + brief.geography.join(', '));
  if (brief.budgetLakhsMin || brief.budgetLakhsMax) parts.push('Budget: Rs. ' + (brief.budgetLakhsMin || 0) + '-' + (brief.budgetLakhsMax || 0) + ' Lakhs');
  return parts.join(' | ');
}

export default function ConversationEngine({
  user,
  sessionId,
  brief,
  // Cumulative analyst-phase state, echoed back to ai-search-v2 each turn so
  // it never has to re-derive "what's already known" from raw chat history -
  // see lib/aiSearch.js. Harmless no-ops against the current production
  // ai-search, which ignores fields it doesn't recognise.
  extraction: priorExtraction,
  model: priorModel,
  convPhase,
  exchangeCount: exchangeCountProp,
  onPhaseChange,
  onExtraction,
  onBriefComplete,
  onModelComplete,
  onAction,
  onReset,
  // Navigates straight to the Home screen without touching any recorded
  // data (same as the NavBar logo / profile-menu "Home" entry) - distinct
  // from Clear, which wipes the current section's data first. Lets the user
  // back out of a section they clicked into by mistake without losing
  // in-progress work if they come back.
  onGoHome,
  // { text, key } - set by Platform when something outside the chat (e.g. a
  // listing card's "Ask AI to analyse") wants to hand context back into the
  // conversation. `key` must change even if `text` repeats, so the same
  // question can be asked about the same listing twice in a row.
  injectMessage,
}) {
  var messagesSt = useState([]), messages = messagesSt[0], setMessages = messagesSt[1];
  var inputSt = useState(''), input = inputSt[0], setInput = inputSt[1];
  var loadingSt = useState(false), loading = loadingSt[0], setLoading = loadingSt[1];
  var restoringSt = useState(true), restoring = restoringSt[0], setRestoring = restoringSt[1];
  var exchangeCountSt = useState(exchangeCountProp || 0);
  var exchangeCount = exchangeCountSt[0], setExchangeCount = exchangeCountSt[1];
  var lastActionSt = useState(null), lastAction = lastActionSt[0], setLastAction = lastActionSt[1];
  var pendingPhaseSt = useState(null), pendingPhase = pendingPhaseSt[0], setPendingPhase = pendingPhaseSt[1];

  var scrollRef = useRef(null);
  var prevPhaseRef = useRef(convPhase);
  var mountedRef = useRef(true);
  // Synchronous re-entrancy lock for sendMessage. `loading` state is not
  // enough on its own: setLoading(true) doesn't take effect until the next
  // render, so two calls to sendMessage fired in the same tick (a known
  // browser quirk where Enter on some IME/virtual keyboards dispatches
  // keydown twice) both read loading as still false and both go through,
  // duplicating the user's message and firing two API calls. A ref updates
  // immediately, before any re-render, so the second call is blocked no
  // matter how close together the two triggers fire.
  var sendingRef = useRef(false);

  var persona = PERSONAS[convPhase] || PERSONAS.discovery;

  // --- Restore conversation from ai_conversations (3s timeout -> greeting) ---
  useEffect(function () {
    mountedRef.current = true;
    if (!sessionId) {
      setMessages([{ role: 'assistant', text: GREETING }]);
      setRestoring(false);
      return;
    }

    var settled = false;
    var timeoutId = setTimeout(function () {
      if (settled || !mountedRef.current) return;
      settled = true;
      setMessages([{ role: 'assistant', text: GREETING }]);
      setRestoring(false);
    }, RESTORE_TIMEOUT_MS);

    supabase
      .from('ai_conversations')
      .select('messages')
      .eq('session_id', sessionId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(function (res) {
        if (settled || !mountedRef.current) return;
        settled = true;
        clearTimeout(timeoutId);
        var loaded = res.data && res.data.messages;
        if (loaded && loaded.length > 0) {
          var normalised = loaded.map(normaliseMessage);
          setMessages(normalised);
          var assistantTurns = normalised.filter(function (m) { return m.role === 'assistant'; }).length;
          setExchangeCount(Math.min(assistantTurns, MAX_DISCOVERY_DOTS));
        } else {
          setMessages([{ role: 'assistant', text: GREETING }]);
        }
        setRestoring(false);
      }).catch(function () {
        if (settled || !mountedRef.current) return;
        settled = true;
        clearTimeout(timeoutId);
        setMessages([{ role: 'assistant', text: GREETING }]);
        setRestoring(false);
      });

    return function () {
      mountedRef.current = false;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // --- Shared network dispatch. Every call to ai-search-v2 goes through here
  // - both user-typed messages (sendMessage) and the automatic "kickoff" turn
  // fired right after a phase transition, so the AI's first real question
  // shows up without the user having to guess what to type. `baseMessages`
  // lets a caller supply the visible-message array to build on top of
  // synchronously (React state updates aren't visible until the next render,
  // so the phase-transition effect can't just call setMessages then read
  // `messages` back in the same tick). `hideUserMessage` sends the kickoff
  // text to the backend as context without rendering a fake user chat bubble.
  function dispatchToBackend(userText, opts) {
    var options = opts || {};
    var val = (userText != null ? userText : input).trim();
    if (!val || loading || sendingRef.current) return;
    sendingRef.current = true;
    setInput('');
    setLastAction(null);
    setPendingPhase(null);

    var base = options.baseMessages != null ? options.baseMessages : messages;
    var newMessages = options.hideUserMessage ? base : base.concat([{ role: 'user', text: val }]);
    setMessages(newMessages);
    setLoading(true);

    var historyBase = options.hideUserMessage ? base.concat([{ role: 'user', text: val }]) : newMessages;
    var history = historyBase.map(function (m) { return { role: m.role, content: m.text }; });

    var phase = options.phase != null ? options.phase : convPhase;
    var exCount = options.exchangeCount != null ? options.exchangeCount : exchangeCount;

    callAiSearch({
      message: val,
      history: history,
      userContext: briefToContext(brief),
      sessionId: sessionId,
      userId: user ? user.id : null,
      conversationPhase: phase,
      exchangeCount: exCount,
      priorExtraction: priorExtraction && Object.keys(priorExtraction).length ? priorExtraction : null,
      priorModel: priorModel || null,
      priorBrief: brief || null,
    }).then(function (data) {
      sendingRef.current = false;
      if (!mountedRef.current) return;
      setLoading(false);

      var reply = stripTags(data.reply || "Sorry, I didn't quite catch that — could you rephrase?");
      setMessages(newMessages.concat([{ role: 'assistant', text: reply }]));
      setExchangeCount(function (c) { return c + 1; });

      if (data.extraction) onExtraction && onExtraction(data.extraction);
      if (data.model) onModelComplete && onModelComplete(data.model);
      if (data.brief) onBriefComplete && onBriefComplete(data.brief);

      if (data.action && data.action.type) setLastAction(data.action);
      if (data.nextPhase && data.nextPhase !== convPhase) setPendingPhase(data.nextPhase);
    }).catch(function () {
      sendingRef.current = false;
      if (!mountedRef.current) return;
      setLoading(false);
      setMessages(newMessages.concat([{ role: 'assistant', text: 'Something went wrong reaching the AI advisor. Please try again in a moment.' }]));
    });
  }

  function sendMessage(text) {
    dispatchToBackend(text != null ? text : input, {});
  }

  // Synthetic first turn sent right after landing on a phase that runs a
  // real one-question-at-a-time interview, so the AI's actual first question
  // appears automatically instead of the user staring at a static transition
  // line with nothing to do. Never shown as a chat bubble (hideUserMessage) -
  // only the transition text and the AI's reply are visible. valuation and
  // listings are deliberately excluded: their transition copy is "ask me
  // anything about the panel", not an interview, so there is no first
  // question to force - an unsolicited AI message there would contradict
  // what the transition text just told the user to do. discovery is covered
  // by GREETING/restore already.
  var KICKOFF_MESSAGES = {
    analyst: 'Please begin the financial interview.',
    buyerQualification: 'Please begin the buyer qualification questions.',
  };

  // --- Explicit-transition-only phase changes: announce, never auto-navigate ---
  useEffect(function () {
    if (prevPhaseRef.current === convPhase) return;
    prevPhaseRef.current = convPhase;
    if (restoring) return; // don't announce a phase that arrived before restore finished

    var base = messages;
    var text = TRANSITION_MESSAGES[convPhase];
    if (text) {
      base = base.concat([{ role: 'assistant', text: text }]);
      setMessages(base);
    }
    setExchangeCount(0);
    setLastAction(null);
    setPendingPhase(null);

    var kickoff = KICKOFF_MESSAGES[convPhase];
    if (kickoff) {
      dispatchToBackend(kickoff, { hideUserMessage: true, baseMessages: base, phase: convPhase, exchangeCount: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convPhase, restoring]);

  // --- Auto-scroll, 50ms after every new message (per spec) ---
  useEffect(function () {
    var t = setTimeout(function () {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 50);
    return function () { clearTimeout(t); };
  }, [messages, loading]);

  // --- External context injection (listing click -> chat) -----------------
  var lastInjectKeyRef = useRef(null);
  useEffect(function () {
    if (!injectMessage || !injectMessage.text) return;
    if (lastInjectKeyRef.current === injectMessage.key) return;
    lastInjectKeyRef.current = injectMessage.key;
    if (restoring) return;
    sendMessage(injectMessage.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectMessage, restoring]);

  function handleTransitionClick() {
    if (lastAction && lastAction.type) onAction && onAction(lastAction.type);
    if (pendingPhase) onPhaseChange && onPhaseChange(pendingPhase);
    setLastAction(null);
    setPendingPhase(null);
  }

  function handleClear() {
    setMessages([{ role: 'assistant', text: GREETING }]);
    setInput('');
    setExchangeCount(0);
    setLastAction(null);
    setPendingPhase(null);
    onReset && onReset();
  }

  return (
    <div style={{
      width: '35%', flexShrink: 0, minWidth: '300px', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'linear-gradient(180deg, #0f172a, #1e293b)',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: convPhase === 'discovery' ? '10px' : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '9px', background: 'rgba(37,99,235,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className={'ti ' + persona.icon} aria-hidden="true" style={{ fontSize: '16px', color: '#93c5fd' }} />
            </div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: '600', color: '#fff', margin: 0 }}>{persona.label}</p>
              <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', margin: 0 }}>buzinessdeals.com</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {convPhase !== 'discovery' && (
              <button onClick={function () { onGoHome && onGoHome(); }} title="Back to Home" style={{
                display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'rgba(255,255,255,0.5)', background: 'transparent',
                border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
              }}><i className="ti ti-home" aria-hidden="true" style={{ fontSize: '11px' }} />Home</button>
            )}
            {messages.length > 1 && (
              <button onClick={handleClear} title="Clear conversation and start over" style={{
                fontSize: '11px', color: 'rgba(255,255,255,0.5)', background: 'transparent',
                border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
              }}>Clear</button>
            )}
          </div>
        </div>
        {convPhase === 'discovery' && (
          <div style={{ display: 'flex', gap: '4px' }}>
            {Array.from({ length: MAX_DISCOVERY_DOTS }).map(function (_, i) {
              return <span key={i} style={{
                width: '5px', height: '5px', borderRadius: '50%',
                background: i < exchangeCount ? '#60a5fa' : 'rgba(255,255,255,0.18)',
              }} />;
            })}
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
        {restoring ? (
          <div style={{ display: 'flex', gap: '4px', padding: '4px 0' }}>
            {[0, 1, 2].map(function (i) {
              return <span key={i} style={{
                width: '5px', height: '5px', borderRadius: '50%', background: 'rgba(255,255,255,0.4)',
                animation: 'pulse 1.2s infinite', animationDelay: (i * 0.2) + 's',
              }} />;
            })}
          </div>
        ) : (
          messages.map(function (m, i) {
            var isUser = m.role === 'user';
            return (
              <div key={i} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: '10px' }}>
                <div style={{
                  maxWidth: '88%', padding: '10px 14px', borderRadius: isUser ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                  fontSize: '13px', lineHeight: '1.55', whiteSpace: 'pre-wrap',
                  background: isUser ? '#2563eb' : 'rgba(255,255,255,0.08)', color: '#fff',
                }}>{isUser ? m.text : cleanAssistantText(m.text)}</div>
              </div>
            );
          })
        )}

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

        {(lastAction || pendingPhase) && !loading && (
          <div style={{ marginTop: '4px' }}>
            <button onClick={handleTransitionClick} style={{
              background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px',
              padding: '10px 16px', fontSize: '13px', fontWeight: '500', cursor: 'pointer',
            }}>{(lastAction && lastAction.label) || 'Continue →'}</button>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '14px 18px 18px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.15)', borderRadius: '999px', padding: '4px 4px 4px 16px',
        }}>
          <input
            type="text"
            value={input}
            disabled={restoring}
            onChange={function (e) { setInput(e.target.value); }}
            onKeyDown={function (e) { if (e.key === 'Enter') sendMessage(); }}
            placeholder="Type your message..."
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent', color: '#fff',
              fontSize: '13px', padding: '9px 0',
            }}
          />
          <button
            onClick={function () { sendMessage(); }}
            disabled={restoring || loading || !input.trim()}
            style={{
              width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0, border: 'none',
              background: restoring || loading || !input.trim() ? 'rgba(255,255,255,0.15)' : '#2563eb', color: '#fff',
              cursor: restoring || loading || !input.trim() ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px',
            }}
          >→</button>
        </div>
      </div>
    </div>
  );
}
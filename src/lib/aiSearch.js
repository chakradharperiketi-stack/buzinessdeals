// Thin client for the deployed ai-search Edge Function.
//
// This function already contains all five AI personas (Router, Financial
// Analyst, Buyer Qualification, V3 Guide, Listings Advisor) and the routing
// logic between them - the frontend only ever sends the current phase and
// exchange count and renders whatever comes back. Never re-implement persona
// logic client-side.
//
// Endpoint is overridable via VITE_AI_SEARCH_URL so a test build can point
// at ai-search-v2 (the agent-loop rewrite, see supabase/functions/ai-search-v2)
// without any code change - set the env var in Bolt/Vite, rebuild, compare
// against production. Falls back to the live ai-search function.
const AI_SEARCH_URL = import.meta.env.VITE_AI_SEARCH_URL || 'https://mpjxulzllmmoiqaqwart.supabase.co/functions/v1/ai-search';
const ANON_KEY = 'sb_publishable_0Xkatb8dUNbdP44AWek6Hg_Br4SNyf2';

// Plain fetch has no default timeout - a degraded connection (flaky wifi,
// a network handoff, a captive portal) that doesn't cleanly refuse the
// connection can leave this Promise pending far longer than anyone would
// wait, sometimes indefinitely. Meanwhile ConversationEngine's sendingRef
// stays true the whole time (only its .then/.catch clears it), silently
// blocking every retry attempt with no visible reason why - reported as
// "an interview stalls mid-way after a connection blip and never recovers,
// retyping the same message does nothing" (see chat, 5 Sept 2026). An
// explicit abort turns an indefinite hang into a real rejection, which
// ConversationEngine's existing .catch already resets state and shows a
// message for - so a stalled request becomes a normal, retryable failure
// instead of a silent dead end.
//
// Widened from 45s to 90s (8 Sept 2026) - the 45s figure was sized for
// dead-connection detection, not for how long a legitimate, still-working
// call can take. Root-caused live against the deployed function: a
// finalize_financial_model-style turn measured ~40s end to end on a plain
// fetch with no network issue at all, because ai-search-v2's agent loop
// (runAgentLoop) makes a SECOND sequential Anthropic call whenever a tool
// call round ends with no narration text (the "backstop" that fetches a
// closing reply - see that function's comment) - a heavy data-tool turn
// commonly hits exactly this case, so it pays for two full model calls, not
// one. 45s left almost no margin below that ~40s measurement; ordinary
// variance (a slightly longer response, a slower network hop) was enough to
// abort a request that was actually still working and about to succeed -
// the user sees "Something went wrong reaching the AI advisor" for a
// perfectly healthy, just-slow turn, and depending on timing the server can
// still finish and persist the real reply after the client already gave up
// and showed the error. 90s keeps real margin above the measured worst case
// while still bounding a truly dead connection to a reasonable wait.
const REQUEST_TIMEOUT_MS = 90000;

export async function callAiSearch({
  message,
  history = [],
  userContext = '',
  sessionId,
  userId = null,
  projectId = null,
  conversationPhase = 'discovery',
  exchangeCount = 0,
  // Cumulative state already held client-side, echoed back so the server
  // doesn't have to reconstruct it from raw chat history every turn - ai-search-v2
  // reads these; the current production ai-search simply ignores unknown fields.
  priorExtraction = null,
  priorModel = null,
  priorBrief = null,
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(AI_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: 'Bearer ' + ANON_KEY,
      },
      body: JSON.stringify({
        message,
        history,
        userContext,
        sessionId,
        userId,
        projectId,
        conversationPhase,
        exchangeCount,
        priorExtraction,
        priorModel,
        priorBrief,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('ai-search request timed out after ' + (REQUEST_TIMEOUT_MS / 1000) + 's - likely a network interruption');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error('ai-search request failed: ' + res.status);
  }

  return res.json();
}

// Strips every internal routing/extraction tag out of an AI reply before it
// is shown to the user. Applied everywhere an ai-search reply is rendered.
const TAG_PATTERN = /\[(EXTRACTION|BRIEF|MODEL|ROUTE|ACTION|PHASE)(:[^\]]*)?\]/g;
const BRIEF_BLOCK_PATTERN = /\[BRIEF_START\][\s\S]*?\[BRIEF_END\]/g;

export function stripTags(text) {
  if (!text) return '';
  return text
    .replace(BRIEF_BLOCK_PATTERN, '')
    .replace(TAG_PATTERN, '')
    .trim();
}
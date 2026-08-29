# BuzinessDeals.com rebuild — status

## Done and build-verified (this delivery)
- `supabase.js` — exact, frozen, matches spec. Never modify.
- `index.css` — full design system from spec, plus a `--color-*` alias block
  (documented inline) so `ValuationPlatform.jsx` resolves correctly without
  touching its 151 existing `--color-*` references.
- `App.jsx` — session check, sessionId (`bd_session_id` in localStorage,
  generated once), SIGNED_IN → `ai_conversations` transfer, frozen sign-out
  pattern (`.then().catch()`, no async/await), 5s max loading screen.
- `LandingPage.jsx` — nav, AI chat hero (5-exchange anonymous gate, calls
  the deployed `ai-search` function directly, discovery phase only), listings
  grid (live Supabase + 8 sample fallback listings), how it works, for
  investors, professional tools, pricing (live Supabase + fallback), lead
  gen form → `leads` table + `send-notification`, footer.
- `AuthModal.jsx` — sign in / create account, shared by the nav and the
  chat login gate.
- `Platform.jsx` — split-screen shell (NavBar with admin pill + dropdown,
  35/65 layout, `convPhase` state). Discovery phase renders a working
  HomeScreen (4 action cards). **Valuation phase renders the real
  `ValuationPlatform` component directly** — not a stub.
- `ValuationPlatform.jsx` — your uploaded V3 engine, integrated as-is with
  three bug fixes (see below). All 9 sections, Damodaran betas, DCF/VC/
  comparable/NAV/earnings-cap methods, report generation, and
  `CreateListingModal` are unchanged.
- `lib/aiSearch.js` — thin client for the deployed `ai-search` function +
  `stripTags()` for stripping `[EXTRACTION:]`/`[BRIEF:]`/`[MODEL:]`/
  `[ROUTE:]`/`[ACTION:]`/`[PHASE:]` tags before display.
- `lib/notifications.js` — thin client for the deployed `send-notification`
  function. This is the `sendNotification()` that `ValuationPlatform.jsx`'s
  `CreateListingModal` calls.
- `lib/financialModel.js` — `computeModel(extraction)`, adapted from the old
  codebase's analyst model computation. Pure function, no chat/persona logic.
- `lib/v3FormMapper.js` — `buildV3FormFromModel(extraction, computed, profile)`,
  adapted from `proceedToV3_function.js`. Builds the `initialForm` V3 expects
  from analyst-phase data, with the Lakhs→raw-INR (×100,000) rule intact.

## Bugs found and fixed in the uploaded ValuationPlatform.jsx
1. `useMemo` was used (10 call sites) but not imported from `react` — would
   have crashed on mount. Fixed: added to the import line.
2. `CreateListingModal` calls `sendNotification('new_listing', ...)` but that
   function was never defined or imported anywhere in the file — would have
   thrown a `ReferenceError` the first time a user submitted a listing from
   the report screen. Fixed: now imported from `lib/notifications.js`.
3. `S8_Report` (the report/UDIN section) referenced `setForm`, which is only
   in scope inside the top-level `ValuationPlatform` component, not in this
   child function — typing into the UDIN field would have thrown. Fixed:
   `S8_Report` now receives `setF` (consistent with every other section) and
   the call site passes `setF={setForm}`.

All three were verified by a headless Chromium smoke test (build → mount →
click through to Section 1) with zero console/page errors.

## Done and build-verified (this delivery, part 2)
- **`ConversationEngine.jsx`** — the real one, replacing the visual-only
  placeholder. Handles all five personas by `convPhase` (Router/discovery,
  Financial Analyst/analyst, Buyer Qualification/buyerQualification, V3
  Guide/valuation, Listings Advisor/listings), restores prior conversation
  from `ai_conversations` by `sessionId` with a 3s timeout → hardcoded
  greeting fallback, shows the 6-dot exchange counter during discovery,
  strips `[EXTRACTION]`/`[BRIEF]`/`[MODEL]`/`[ROUTE]`/`[ACTION]`/`[PHASE]`
  tags via the shared `stripTags()` (same one `LandingPage.jsx` uses — no
  duplicate implementation), auto-scrolls 50ms after every new message, and
  fires `onExtraction`/`onModelComplete`/`onBriefComplete` on every relevant
  response. Phase transitions are **explicit-click-only**: an AI-suggested
  action renders as a button: clicking it calls `onAction(type)` then
  `onPhaseChange(nextPhase)` — nothing navigates on its own. The canned
  transition message (exact wording from spec for analyst/buyerQualification/
  valuation) fires from a `convPhase`-watching effect, so it appears
  identically whether the transition came from a chat button *or* a
  HomeScreen card click in the right panel — one code path, no risk of the
  two ever drifting apart.
- `Platform.jsx` now wires `ConversationEngine` for real: `onModelComplete`
  fetches the user's `profiles` row (best-effort, 3s timeout — see bug fix
  below) and builds `sellerForm` via `v3FormMapper`; `onBriefComplete` /
  `onExtraction` populate `brief` / `convExtraction`. The analyst and
  buyerQualification placeholders in RightPanel now show a green
  "model built" / "brief ready" card with a button to proceed once that
  data exists, so a completed interview isn't a dead end while the full
  live-building panels (below) are still pending.

## Bug found and fixed in this delivery (Platform.jsx, not the uploaded file)
`handleModelComplete`'s fetch of the `profiles` table had no timeout guard,
unlike every other network call in this app (`App.jsx`'s session check,
`ConversationEngine`'s conversation restore). A headless smoke test with
network calls blocked exposed it directly: the fetch hung, its `.then()`
never fired, and `sellerForm` never got built — so "Proceed to valuation"
opened `ValuationPlatform` with a blank form instead of the interview data.
Fixed with the same `Promise`-race-against-`setTimeout` pattern used
elsewhere (3s, falls back to the platform-indicative defaults already built
into `buildV3FormFromModel`). Re-tested after the fix: company name,
sector, and P&L data flow through end-to-end from a mocked interview into
`ValuationPlatform`'s Company Information section with zero console errors.

## Done and build-verified (this delivery, part 3)
- **`FinancialModelPanel.jsx`** — the real live financial model builder for
  RightPanel's analyst phase. Renders from `convExtraction` (updates after
  every AI response) and `convModel` (once complete) into the 5 sections
  from spec: Business overview, Revenue build-up, Cost structure, Working
  capital, Assets and funding. Confirmed values render in blue with a green
  checkmark; unconfirmed fields show grey italic "waiting...". A section
  header turns green with "✓ Complete" once every row in it is confirmed.
  Revenue segments and cost line items expand into their own rows
  dynamically as the interview surfaces them — verified with a scripted
  two-turn mock interview: progress bar moved 38% → 89% live, section
  headers turned green in real time, currency formatting correct throughout,
  zero console errors.
- **`AcquisitionBriefPanel.jsx`** — the real live Acquisition Brief builder
  for RightPanel's buyerQualification phase. The 7 fields from spec (Intent,
  Sectors, Budget, Geography, Deal structure, Timeline, Experience), same
  confirmed/waiting pattern, plus a tier note once the brief is scored.
  Verified the same way: partial answers after turn 1, 100% + tier note +
  "Browse matched listings →" button after the brief completes.
- Both replace the earlier placeholder + green-card combination in
  `Platform.jsx`'s `RightPanel` — `onProceed` wires straight through to the
  same phase-transition callbacks already in place.

## Done and build-verified (this delivery, part 4 — response to product feedback doc)
Addresses the frontend-buildable parts of the "Product Feedback and Required
Changes" document. Items that require the `ai-search` Edge Function's
server-side persona prompts (which I cannot see or deploy) are drafted, not
built — see `ai-search-persona-redesign.md` at the project root and the
"Not yet built" section below.

- **Landing hero copy** (`LandingPage.jsx`) — updated to the exact headline
  and supporting line from the feedback doc: "Buy, Sell or Invest in Indian
  Businesses" / "Talk to our AI Business Advisor — get intelligent guidance
  on buying, selling, investing in, or valuing a business."
- **Bidirectional blur between chat and discovery** (`LandingPage.jsx`) —
  replaced the old one-directional opacity fade with mutually-exclusive
  visual priority: chatting blurs+dims the listings section (`filter:
  blur()`, not just opacity), and browsing (a category chip or an open
  listing) blurs+dims the chat hero. Sending a message always hands focus
  back to chat. Verified via headless screenshots at each state - zero
  console errors.
- **Pathway 1 direct discovery** (`LandingPage.jsx`) — category chips
  (Manufacturing / Restaurants / Technology / Healthcare / Available for
  Acquisition) filter the grid client-side.
- **Listing → chat context handoff** (`LandingPage.jsx`, `Platform.jsx`,
  `ConversationEngine.jsx`) — clicking a listing opens a detail card with
  "Ask the AI advisor about this business," which seeds a context message
  into the conversation and returns focus to chat. On the authenticated
  side, `ConversationEngine` now accepts an `injectMessage={{text,key}}`
  prop for this - `Platform.jsx`'s `handleAskAiAboutListing` is the source.
  Verified end-to-end with a mocked `ai-search` reply - message appears in
  chat, gets a response, no errors.
- **BuyerListingsPanel.jsx** (new) — replaces the `listings`-phase
  placeholder. Live Supabase query (`status = 'live'`, same 8-sample
  fallback as the landing page, now shared via `lib/sampleListings.js`
  instead of duplicated). Filters derive automatically from the completed
  Acquisition Brief or in-progress `convExtraction` (sector, geography,
  budget) and re-derive live if either updates while the panel is open;
  manual sector/state/budget controls sit alongside so refinement works
  even where the active persona isn't emitting extraction data (a
  server-side concern this panel doesn't depend on). Each card has "Ask AI
  to analyse" (→ `injectMessage`) and "Express interest" (→
  `listing_interests` insert, best-effort, confirms in-place). This also
  closes out the "BuyerListings" item from the original next-steps list.
- **`ai-search-persona-redesign.md`** (new, project root) — full draft
  system prompts for all five personas addressing feedback sections 1
  (advisory scope, not a generic chatbot), 3 (dimension-based, non-
  superficial financial interview: revenue drivers, cost structure,
  operating drivers, growth-assumption challenge, sensitivity), 4
  (industry-adaptive question branching by business type), and the
  conversational half of 8 (assumption transparency/defence/challenge for
  V3, plus a new `[V3_UPDATE]` tag for AI-driven field population with a
  `basis` label so no assumption is an unexplained black box). Includes an
  extended EXTRACTION schema, three new tags (`[V3_UPDATE]`,
  `[MATCH_CRITERIA]`, `[CHALLENGE]`), and an integration-notes section
  explaining exactly what's needed to deploy it (source access or a manual
  merge) and what I'll build on the frontend once it's live.

## Done and build-verified (this delivery, part 5 — agent-loop ai-search-v2)
Response to the "AI Business & Deal Advisory Agent" direction document. That
document reframes the Edge Function work from "better prompts" to "an actual
agent loop with tools" - the AI should call real, deterministic financial
calculations rather than reasoning numbers into being in prose. Per your
decision, this is a **new, separate function** (`ai-search-v2`), not a
replacement for the live `ai-search` - see `supabase/functions/ai-search-v2/`.

- **`supabase/functions/ai-search-v2/index.ts`** (new) — full Deno Edge
  Function implementing a tool-use agent loop against the Anthropic Messages
  API. Same request/response contract as `ai-search` (`reply, extraction,
  model, brief, action, nextPhase`), plus additive fields the current
  frontend safely ignores until wired up (`matchCriteria, v3Updates,
  valuationResult, challenges, benchmarksUsed`). Contains:
  - **Ported compute engines** — `computeWACC`/`computeDCF`/`computeSensitivity`/
    `computeAutoYear` (from `ValuationPlatform.jsx`, math unchanged) and
    `computeModel` (from `lib/financialModel.js`, math unchanged). The AI
    calls these via tools instead of computing numbers itself - if you ever
    change the valuation math in `ValuationPlatform.jsx`, mirror the change
    here or the two engines will silently disagree.
  - **A curated benchmark table** (`BENCHMARKS`) covering 6 sector buckets ×
    5 metrics, looked up via a `lookup_industry_benchmark` tool and always
    disclosed to the user as a typical-range estimate, not a fact.
  - **Five persona system prompts**, rewritten for tool-calling rather than
    inline `[TAG]` text (dimension-based industry-adaptive analyst
    interview, assumption-transparent/defending/challenging V3 Guide,
    conversational-discovery-aware Router, etc.) - condensed from
    `ai-search-persona-redesign.md`'s fuller drafts.
  - **8 tools**: `record_business_understanding`, `finalize_financial_model`,
    `set_match_criteria`, `complete_buyer_brief`, `lookup_industry_benchmark`,
    `propose_valuation_input`, `compute_valuation`, `flag_assumption_challenge`,
    `set_next_phase` - gated per persona, capped at 5 tool-use rounds per
    request as a cost/latency guardrail.
  - Best-effort persistence to `ai_conversations` matching the schema the
    frontend already reads (`session_id, user_id, messages, updated_at`).
  - A defense-in-depth anonymous 5-exchange gate (frontend already enforces
    this; this is a server-side backstop for direct API calls).
  - **`DEPLOY.md`** alongside it — exact deploy steps, required env var
    (`ANTHROPIC_API_KEY` only - `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
    are auto-provided), what to compare against production `ai-search`, and
    known limitations (static benchmark data, no Excel handling yet, the
    round cap).
- **Verified without Deno** (unavailable in this sandbox): type-checked
  clean with `tsc --noEmit` against a `Deno` global stub, then transpiled to
  CommonJS and run under Node with the Anthropic API and Supabase REST calls
  mocked - confirmed multi-tool-use-in-one-turn handling (analyst persona
  recording understanding + finalizing the model together), the
  tool-result-feedback loop terminating cleanly on the next turn, the
  valuation persona's `propose_valuation_input` + `compute_valuation` pair
  producing a real computed EV/equity-value/sensitivity table, CORS
  preflight, and the anonymous-limit gate short-circuiting before any
  Anthropic call. One real bug caught this way and fixed: a forward-reference
  from `finalize_financial_model`'s tool schema to
  `record_business_understanding`'s (meant to avoid duplicating the schema)
  was evaluated during the same object-literal construction it referenced,
  which would have thrown "Cannot access before initialization" on cold
  start - fixed by deferring the assignment to after the object exists.
- **Frontend wiring for the new contract** — `lib/aiSearch.js`'s
  `AI_SEARCH_URL` is now overridable via `VITE_AI_SEARCH_URL` so a test
  build can point at `ai-search-v2` with zero code changes (unset = today's
  behavior, unchanged). `callAiSearch` now also sends `priorExtraction`/
  `priorModel`/`priorBrief` each turn (current `ai-search` ignores unknown
  fields, harmless); `ConversationEngine` accepts `extraction`/`model`
  props for this, and `Platform.jsx` passes its existing `convExtraction`/
  `convModel` state through. This is what lets `ai-search-v2`'s analyst
  persona see the full previously-recorded picture without re-deriving it
  from raw chat history every turn - a real reliability improvement given
  how much the feedback documents emphasise not losing already-gathered
  information. Re-verified `FinancialModelPanel` still live-updates
  correctly with this wiring in place (headless screenshot, zero errors).

## Not yet built (next steps, in order)
- **Frontend side of ai-search-v2's new response fields** — `v3Updates`
  handling inside `ValuationPlatform` (live field population + recalculation,
  with basis labels next to each field), `matchCriteria` handling inside
  `BuyerListingsPanel` (reading it directly instead of only `brief`/
  `convExtraction`), `challenges` turn styling in `ConversationEngine`.
  Deliberately held until you've deployed and tested `ai-search-v2` per
  `DEPLOY.md` - no point wiring frontend plumbing for fields a function you
  haven't deployed yet will never emit.
- **Excel upload** (feedback section 5) — client-side parse (SheetJS) +
  condensed summary sent as `userContext` to the analyst persona.
- **Dynamic what-if financial model workspace** (feedback section 6) — a
  richer `FinancialModelPanel` that accepts conversational instructions and
  live-recalculates P&L/cash flow/working capital, independent of V3.
- **Excel export with live formulas** (feedback section 7) — full model
  (assumptions, P&L, balance sheet, cash flow, WC, capex, debt schedule,
  valuation, sensitivity, scenario analysis) as an actual formula-driven
  workbook, not static numbers.
- **Professional credentials + UDIN in the direct-entry valuation path**
  (feedback section 8) — `handleModelComplete` already fetches `profiles`
  for the AI-conversation path; needs extending so a user who enters
  valuation directly (no prior interview) gets the same auto-population,
  plus confirming/wiring the "Paste UDIN" field already in `S8_Report`.
- **SellerDashboard** — engagement cards (multiple businesses per user).
  Right now "Sell or Raise Capital" routes straight into `ValuationPlatform`
  as a placeholder.
- **AdminPortal** — 7 tabs per spec section 9.
- **ProfilePage**.
- **Razorpay** — payment gates at model-built and report-generated. No
  payment gating exists yet anywhere; all flows are currently free to
  reach completion.

## Critical rules status
All "never violate" rules from your spec are respected: sign-out pattern
frozen, `supabase.js` untouched, `sessionId` generated once in `App.jsx` and
passed down, `convPhase` is the single source of truth for both panels
(`Platform.jsx`), `ConversationEngine` is the only chat component that
exists anywhere in the app, and tag stripping runs on every AI reply before
it's ever rendered (verified by a scripted test with deliberately
tag-polluted mock responses — zero leaked tags).

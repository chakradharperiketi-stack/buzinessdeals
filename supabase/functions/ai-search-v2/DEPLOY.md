# Deploying and testing `ai-search-v2`

This deploys **alongside** your existing `ai-search` function — it does not
touch it. Nothing points at this new function until you explicitly configure
a test build to.

## 1. Deploy the function

**Option A — Supabase CLI** (if you have it set up):
```
supabase functions deploy ai-search-v2
```

**Option B — Dashboard editor** (matches the workflow you described —
pasting generated code into the editor):
1. Supabase Dashboard → Edge Functions → Create a new function named `ai-search-v2`.
2. Paste the full contents of `index.ts` from this folder.
3. Deploy.

## 2. Set the required environment variable

In the function's settings (or via `supabase secrets set`):
- `ANTHROPIC_API_KEY` — your Anthropic API key. This is the only one you must set.

Two more are read but auto-provided by Supabase in every Edge Function, you
don't need to set them: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

Optional: `ANTHROPIC_MODEL` — only set this if you want to override the
default model ID baked into the file. **Before deploying, check
https://docs.claude.com/en/docs/about-claude/models and confirm the default
in `index.ts` (search for `ANTHROPIC_MODEL`) is still a current, available
model ID for your account** — model IDs are retired periodically and I can't
verify from here which are live on your account today.

## 3. Point a test build at it

In your Bolt/Vite project's environment variables, set:
```
VITE_AI_SEARCH_URL=https://mpjxulzllmmoiqaqwart.supabase.co/functions/v1/ai-search-v2
```
Rebuild. `lib/aiSearch.js` reads this env var and falls back to the current
production `ai-search` URL if it's not set — so removing/unsetting it at any
time reverts to today's behavior with zero code changes.

## 4. What to compare against production `ai-search`

- **Discovery**: does routing still work within ~6 exchanges? Does it now
  give a real preliminary answer to out-of-scope questions instead of
  refusing?
- **Analyst interview**: does it feel like it's dissecting the business
  (revenue drivers / cost structure / operating drivers / growth challenge /
  sensitivity), not just asking for revenue-cost-profit? Does
  `FinancialModelPanel` still update live? (It should — `model`'s shape is
  unchanged, only *how* it gets populated changed.)
- **Buyer qualification**: does `AcquisitionBriefPanel` still populate
  correctly? Does the listings panel start reflecting criteria before the
  full brief completes (via the new `matchCriteria` field — inert until the
  frontend is updated to read it, see "What's next" below)?
- **Valuation**: ask "why this beta" or "why this growth rate" mid-flow and
  confirm it explains rather than restating a number. Try "what if growth
  drops to 15%" and confirm the reply reflects an actually recomputed value
  (check the `valuationResult` field in the network response), not prose
  estimation.
- **Cost/latency**: this version makes 2+ Anthropic API calls per user turn
  (the tool-use round trip) instead of 1. Expect higher latency and token
  cost per message than today's `ai-search`. Worth watching in your Anthropic
  usage dashboard during testing.
- **Persistence**: confirm rows still land in `ai_conversations` correctly
  (same session_id/user_id/messages/updated_at shape) and that signing in
  after an anonymous conversation still transfers it (this only depends on
  `session_id` matching, which is unchanged).

## 5. Cutting over

Once you're satisfied, there are two ways to make it permanent:
- **Simplest**: change the fallback URL in `lib/aiSearch.js` from `ai-search`
  to `ai-search-v2`, remove the env var, ship it as your new default. Keep
  the old `ai-search` deployed for a while as a rollback path.
- **Cleanest**: rename/redeploy this code as `ai-search` itself once you're
  confident, replacing the old function outright.

Either way, tell me once it's live and I'll build the frontend side of the
new fields this version introduces (`matchCriteria` driving
`BuyerListingsPanel` directly instead of only via the completed brief,
`v3Updates` live-populating `ValuationPlatform`'s form with basis labels next
to each field, `challenges` styling in `ConversationEngine`) — those are
currently inert extras the current frontend safely ignores.

## Known limitations of this version, by design

- **Benchmark data is a small curated table** (`BENCHMARKS` in `index.ts`),
  not live market research. It covers six sector buckets and five metrics.
  Extend it as you find gaps — the alternative (live web research per turn)
  adds cost, latency and a new failure mode, and I'd only recommend it once
  the static version is proven insufficient.
- **No Excel upload handling yet** — the analyst persona is instructed to
  use an `uploadedFile` summary if present in `userContext`, but nothing on
  the frontend produces that yet. That's a separate, frontend-only piece.
- **Max 5 tool-use rounds per request** (`MAX_TOOL_ROUNDS`), to bound cost
  and latency. If a persona hits this it's forced to a plain-text summary
  turn rather than left hanging - watch your logs for this happening often,
  it likely means a persona is trying to do too much in one user turn.

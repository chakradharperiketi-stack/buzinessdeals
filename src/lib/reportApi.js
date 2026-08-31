// Thin client for the generate-financial-report Edge Function (Phase 2 of
// the AI Financial Model Report feature - see supabase/functions/generate-financial-report).
// Separate from lib/aiSearch.js on purpose: this hits a different function,
// is called once (not per chat turn), and has its own env var so it can be
// pointed at a test deployment independently of ai-search-v2.
const GENERATE_REPORT_URL = import.meta.env.VITE_GENERATE_REPORT_URL || 'https://mpjxulzllmmoiqaqwart.supabase.co/functions/v1/generate-financial-report';
const ANON_KEY = 'sb_publishable_0Xkatb8dUNbdP44AWek6Hg_Br4SNyf2';

// extraction: the finalized analyst-phase extraction (Platform.jsx's convModel).
// Throws on failure - callers show their own error state; this never
// swallows an error the way persistConversation-style best-effort calls do,
// because report generation is the thing the user is actively waiting on.
export async function generateFinancialReport({ sessionId, userId = null, extraction }) {
  const res = await fetch(GENERATE_REPORT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: 'Bearer ' + ANON_KEY,
    },
    body: JSON.stringify({ sessionId, userId, extraction }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'generate-financial-report request failed: ' + res.status);
  }
  return data.report;
}

// Thin client for the generate-financial-report-pdf Edge Function (Phase 5).
// Takes the already-saved report's id (not the extraction again - the PDF
// function reads report_data/computed_model straight from the DB row) plus
// the live completion % from the panel, since that figure is only ever
// computed client-side and isn't persisted on the report row itself.
const GENERATE_REPORT_PDF_URL = import.meta.env.VITE_GENERATE_REPORT_PDF_URL || 'https://mpjxulzllmmoiqaqwart.supabase.co/functions/v1/generate-financial-report-pdf';

export async function generateReportPdf({ reportId, completionPct = 100 }) {
  const res = await fetch(GENERATE_REPORT_PDF_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: 'Bearer ' + ANON_KEY,
    },
    body: JSON.stringify({ reportId, completionPct }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'generate-financial-report-pdf request failed: ' + res.status);
  }
  return data; // { pdf_url, report }
}
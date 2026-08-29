// Thin client for the deployed send-notification Edge Function.
// https://mpjxulzllmmoiqaqwart.supabase.co/functions/v1/send-notification
// Sends admin email via Resend for: new_lead, new_listing, new_interest.
// This is the sendNotification() helper that ValuationPlatform.jsx's
// CreateListingModal calls but never defined - importing it here fixes that.

const SEND_NOTIFICATION_URL = 'https://mpjxulzllmmoiqaqwart.supabase.co/functions/v1/send-notification';
const ANON_KEY = 'sb_publishable_0Xkatb8dUNbdP44AWek6Hg_Br4SNyf2';

export async function sendNotification(type, data) {
  try {
    await fetch(SEND_NOTIFICATION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: 'Bearer ' + ANON_KEY,
      },
      body: JSON.stringify({ type, data }),
    });
  } catch (err) {
    // Notification failures should never block the user's action
    // (listing creation, lead submission, etc).
    console.error('sendNotification failed:', err);
  }
}

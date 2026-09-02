// Thin client for the Razorpay payment flow - create-razorpay-order and
// verify-razorpay-payment Edge Functions (see supabase/migrations/
// 003_razorpay_payments.sql for the schema, and both functions' own header
// comments for the security reasoning). Same shape as lib/reportApi.js on
// purpose - hardcoded project URL + publishable anon key, overridable via
// VITE_* env vars, throws on failure so callers show their own error state.
const ANON_KEY = 'sb_publishable_0Xkatb8dUNbdP44AWek6Hg_Br4SNyf2';
const CREATE_ORDER_URL = import.meta.env.VITE_CREATE_RAZORPAY_ORDER_URL || 'https://mpjxulzllmmoiqaqwart.supabase.co/functions/v1/create-razorpay-order';
const VERIFY_PAYMENT_URL = import.meta.env.VITE_VERIFY_RAZORPAY_PAYMENT_URL || 'https://mpjxulzllmmoiqaqwart.supabase.co/functions/v1/verify-razorpay-payment';

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || (url + ' request failed: ' + res.status));
  }
  return data;
}

// deliverableType: 'ai_model' | 'valuation'. deliverableId: the
// financial_model_reports row id (ai_model) or the project id (valuation).
// The amount actually charged is computed server-side, never trusted from
// here - this just returns what the server decided.
export function createRazorpayOrder({ userId, deliverableType, deliverableId }) {
  return postJson(CREATE_ORDER_URL, { userId, deliverableType, deliverableId });
}

export function verifyRazorpayPayment({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  return postJson(VERIFY_PAYMENT_URL, { razorpay_order_id, razorpay_payment_id, razorpay_signature });
}

// Loads Razorpay's Checkout script once and caches the promise, so a second
// unlock button on the same page doesn't inject it twice.
var checkoutScriptPromise = null;
export function loadRazorpayCheckout() {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve(window.Razorpay);
  if (checkoutScriptPromise) return checkoutScriptPromise;
  checkoutScriptPromise = new Promise(function (resolve, reject) {
    var existing = document.getElementById('razorpay-checkout-script');
    if (existing) {
      existing.addEventListener('load', function () { resolve(window.Razorpay); });
      existing.addEventListener('error', function () { reject(new Error('Failed to load Razorpay checkout script.')); });
      return;
    }
    var script = document.createElement('script');
    script.id = 'razorpay-checkout-script';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = function () { resolve(window.Razorpay); };
    script.onerror = function () { checkoutScriptPromise = null; reject(new Error('Failed to load Razorpay checkout script.')); };
    document.body.appendChild(script);
  });
  return checkoutScriptPromise;
}

// Full flow: create the order, open Razorpay Checkout, verify the payment
// signature server-side on success. Resolves with verify-razorpay-payment's
// response ({ success, deliverableType, deliverableId }); rejects on
// cancellation, a failed payment, or a failed verification - callers should
// only treat a resolved promise as "actually unlocked".
export function payAndUnlock({ userId, userEmail, userContact, deliverableType, deliverableId, title }) {
  return createRazorpayOrder({ userId, deliverableType, deliverableId }).then(function (order) {
    return loadRazorpayCheckout().then(function (RazorpayCtor) {
      return new Promise(function (resolve, reject) {
        var settled = false;
        var rzp = new RazorpayCtor({
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          order_id: order.orderId,
          name: 'BuzinessDeals.com',
          description: title || 'Unlock report',
          prefill: { email: userEmail || '', contact: userContact || '' },
          theme: { color: '#2563eb' },
          handler: function (response) {
            verifyRazorpayPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }).then(function (result) {
              settled = true;
              resolve(result);
            }).catch(function (err) {
              settled = true;
              reject(err);
            });
          },
          modal: {
            ondismiss: function () {
              if (!settled) reject(new Error('Payment window closed before completing.'));
            },
          },
        });
        rzp.on('payment.failed', function (resp) {
          settled = true;
          reject(new Error((resp && resp.error && resp.error.description) || 'Payment failed.'));
        });
        rzp.open();
      });
    });
  });
}
import { useState } from 'react';
import { supabase } from './supabase';

// Standalone sign-in / sign-up page, reachable at /login (see App.jsx). This
// is a direct-URL entry point for links from emails, etc. - the primary
// in-page flow on the landing page still uses the AuthModal. Both funnel
// into the same supabase.auth calls, so App.jsx's SIGNED_IN listener (which
// transfers the anonymous conversation by sessionId) works identically
// regardless of which one the user came through.
export default function LoginPage({ onNavigateHome }) {
  var emailSt = useState(''), email = emailSt[0], setEmail = emailSt[1];
  var passwordSt = useState(''), password = passwordSt[0], setPassword = passwordSt[1];
  var modeSt = useState('login'), mode = modeSt[0], setMode = modeSt[1];
  var loadingSt = useState(false), loading = loadingSt[0], setLoading = loadingSt[1];
  var messageSt = useState(''), message = messageSt[0], setMessage = messageSt[1];

  function handleSubmit() {
    if (!email.trim() || !password.trim()) { setMessage('Please enter your email and password.'); return; }
    setLoading(true);
    setMessage('');
    var call = mode === 'login'
      ? supabase.auth.signInWithPassword({ email: email, password: password })
      : supabase.auth.signUp({ email: email, password: password });

    call.then(function (res) {
      setLoading(false);
      if (res.error) { setMessage(res.error.message); return; }
      if (mode === 'signup') {
        if (res.data.session) setMessage('Account created! Redirecting...');
        else setMessage('Account created! You can now sign in.');
      }
      // On sign-in success (or an immediate signup session), App.jsx's auth
      // listener picks up the SIGNED_IN event and swaps the app into
      // Platform - nothing further to do here.
    }).catch(function () {
      setLoading(false);
      setMessage('Something went wrong. Please try again.');
    });
  }

  var inp = {
    width: '100%', padding: '10px 12px', borderRadius: '8px', border: '0.5px solid var(--border)',
    background: 'var(--surface-1)', color: 'var(--text-primary)', fontSize: '14px',
    fontFamily: 'var(--font-sans)', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #eff6ff 0%, #f0f4f8 50%, #f8fafc 100%)', padding: '20px',
    }}>
      <div style={{
        width: '100%', maxWidth: '380px', background: 'var(--surface-2)',
        borderRadius: '20px', padding: '32px', border: '0.5px solid var(--border)',
        boxShadow: '0 8px 40px rgba(15,23,42,0.10)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <button onClick={onNavigateHome} style={{
            width: '44px', height: '44px', borderRadius: '10px', background: '#1d4ed8', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px',
          }}>
            <span style={{ fontSize: '16px', fontWeight: '700', color: '#fff' }}>BD</span>
          </button>
          <h1 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 4px', letterSpacing: '-0.3px', color: 'var(--text-primary)' }}>BuzinessDeals</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>India's verified business marketplace</p>
        </div>

        <div style={{ display: 'flex', marginBottom: '20px', borderRadius: '8px', border: '0.5px solid var(--border)', overflow: 'hidden' }}>
          {['login', 'signup'].map(function (m) {
            return (
              <button key={m} onClick={function () { setMode(m); setMessage(''); }} style={{
                flex: 1, padding: '9px', fontSize: '13px', cursor: 'pointer', border: 'none',
                fontWeight: mode === m ? '500' : '400',
                background: mode === m ? 'var(--bg-accent)' : 'var(--surface-1)',
                color: mode === m ? 'var(--text-accent)' : 'var(--text-secondary)',
              }}>{m === 'login' ? 'Sign in' : 'Create account'}</button>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
          <input type="email" placeholder="Email address" value={email} onChange={function (e) { setEmail(e.target.value); }} style={inp} />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={function (e) { setPassword(e.target.value); }}
            onKeyDown={function (e) { if (e.key === 'Enter') handleSubmit(); }}
            style={inp}
          />
        </div>

        {message && <p style={{ fontSize: '12px', color: 'var(--text-danger)', marginBottom: '12px', textAlign: 'center' }}>{message}</p>}

        <button onClick={handleSubmit} disabled={loading} style={{
          width: '100%', padding: '11px', borderRadius: '8px', fontSize: '14px', fontWeight: '500', cursor: loading ? 'default' : 'pointer',
          background: 'linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%)', color: '#fff', border: 'none',
          opacity: loading ? 0.7 : 1,
        }}>{loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}</button>

        <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '18px' }}>
          <a onClick={onNavigateHome} style={{ color: 'var(--text-accent)', cursor: 'pointer', textDecoration: 'none' }}>← Back to buzinessdeals.com</a>
        </p>
      </div>
    </div>
  );
}
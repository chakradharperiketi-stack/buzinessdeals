import { useState } from 'react';
import { supabase } from './supabase';

// Shared sign in / create account modal. Used from the landing page nav and
// from the AI chat login gate. On success, supabase fires a SIGNED_IN event
// that App.jsx listens for - that is what transfers the anonymous
// conversation (matched by sessionId) to the new user and swaps the app
// into Platform. This modal does not need to do that itself.
export default function AuthModal({ mode: initialMode = 'signup', onClose }) {
  var modeSt = useState(initialMode), mode = modeSt[0], setMode = modeSt[1];
  var emailSt = useState(''), email = emailSt[0], setEmail = emailSt[1];
  var passwordSt = useState(''), password = passwordSt[0], setPassword = passwordSt[1];
  var nameSt = useState(''), fullName = nameSt[0], setFullName = nameSt[1];
  var loadingSt = useState(false), loading = loadingSt[0], setLoading = loadingSt[1];
  var errorSt = useState(''), error = errorSt[0], setError = errorSt[1];
  var infoSt = useState(''), info = infoSt[0], setInfo = infoSt[1];

  function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    setError('');
    setInfo('');

    if (mode === 'signup') {
      supabase.auth.signUp({
        email: email,
        password: password,
        options: { data: { full_name: fullName } },
      }).then(function (res) {
        setLoading(false);
        if (res.error) {
          setError(res.error.message);
          return;
        }
        if (res.data.session) {
          onClose();
        } else {
          setInfo('Check your email to confirm your account, then sign in.');
        }
      });
    } else {
      supabase.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
        setLoading(false);
        if (res.error) {
          setError(res.error.message);
          return;
        }
        onClose();
      });
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }} onClick={onClose}>
      <div
        style={{
          background: '#ffffff', borderRadius: '16px', padding: '32px', width: '100%',
          maxWidth: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
        onClick={function (e) { e.stopPropagation(); }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <h2 style={{ fontSize: '19px', fontWeight: '600', margin: 0, color: 'var(--text-primary)' }}>
            {mode === 'signup' ? 'Create your free account' : 'Sign in'}
          </h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer',
            color: 'var(--text-muted)', lineHeight: 1, padding: '4px',
          }}>×</button>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 20px' }}>
          {mode === 'signup'
            ? 'Your AI conversation so far will be saved exactly where you left off.'
            : 'Welcome back to buzinessdeals.com'}
        </p>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Full name</label>
              <input type="text" value={fullName} onChange={function (e) { setFullName(e.target.value); }} placeholder="Your name" />
            </div>
          )}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Email</label>
            <input type="email" value={email} onChange={function (e) { setEmail(e.target.value); }} placeholder="you@company.com" required />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Password</label>
            <input type="password" value={password} onChange={function (e) { setPassword(e.target.value); }} placeholder="At least 6 characters" required minLength={6} />
          </div>

          {error && <p style={{ fontSize: '12px', color: 'var(--text-danger)', marginBottom: '12px' }}>{error}</p>}
          {info && <p style={{ fontSize: '12px', color: 'var(--text-success)', marginBottom: '12px' }}>{info}</p>}

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '11px', borderRadius: '8px', fontSize: '14px', fontWeight: '500',
            background: '#2563eb', color: '#fff', border: 'none', cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Please wait...' : mode === 'signup' ? 'Create free account →' : 'Sign in →'}
          </button>
        </form>

        <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '16px' }}>
          {mode === 'signup' ? 'Already have an account? ' : "Don't have an account? "}
          <button
            onClick={function () { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); setInfo(''); }}
            style={{ background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '12px', fontWeight: '500', padding: 0 }}
          >
            {mode === 'signup' ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import LandingPage from './LandingPage';
import Platform from './Platform';

// sessionId is generated exactly once per browser and never regenerated.
// Every component that needs it receives it as a prop from here.
function getSessionId() {
  try {
    var existing = localStorage.getItem('bd_session_id');
    if (existing && existing.length > 0) return existing;
    var newId = 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    localStorage.setItem('bd_session_id', newId);
    return newId;
  } catch (err) {
    // localStorage unavailable (private mode, etc) - fall back to an
    // in-memory id for this page load rather than crashing.
    return 'sess_fallback_' + Date.now();
  }
}

export default function App() {
  var sessionSt = useState(null);
  var session = sessionSt[0], setSession = sessionSt[1];
  var loadingSt = useState(true);
  var loading = loadingSt[0], setLoading = loadingSt[1];
  var sessionId = getSessionId();

  useEffect(function () {
    var timeout = setTimeout(function () {
      setLoading(false);
    }, 5000);

    supabase.auth.getSession().then(function (result) {
      clearTimeout(timeout);
      setSession(result.data.session);
      setLoading(false);
    });

    var sub = supabase.auth.onAuthStateChange(function (event, newSession) {
      setSession(newSession);
      setLoading(false);

      if (event === 'SIGNED_IN' && newSession) {
        supabase
          .from('ai_conversations')
          .update({ user_id: newSession.user.id })
          .eq('session_id', sessionId)
          .is('user_id', null)
          .then(function (res) {
            if (res.error) console.error('Conversation transfer failed:', res.error);
          });
      }
    });

    return function () {
      clearTimeout(timeout);
      sub.data && sub.data.subscription && sub.data.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CRITICAL: sign-out pattern. Never change this. Never use async/await here.
  function handleSignOut() {
    supabase.auth.signOut().then(function () {
      window.location.reload();
    }).catch(function () {
      window.location.reload();
    });
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0f172a'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px',
            background: '#2563eb', display: 'flex', alignItems: 'center',
            justifyContent: 'center', margin: '0 auto 12px'
          }}>
            <span style={{ fontSize: '16px', fontWeight: '700', color: '#fff' }}>BD</span>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', margin: 0 }}>
            Loading...
          </p>
        </div>
      </div>
    );
  }

  if (session) {
    return <Platform user={session.user} sessionId={sessionId} onSignOut={handleSignOut} />;
  }

  return <LandingPage sessionId={sessionId} session={null} />;
}

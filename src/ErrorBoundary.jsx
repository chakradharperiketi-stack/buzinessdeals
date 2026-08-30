import { Component } from 'react';

// Root-level safety net. Before this existed, ANY uncaught render error
// anywhere in the tree (ValuationPlatform's 2000+ lines of form/DCF logic
// being the most likely source, given its size and the number of assumed
// data shapes it reads from) unmounted the *entire* React app, leaving a
// blank white screen with zero indication of what happened and, worse,
// wiping out whatever the user had just typed. This can never fully
// prevent that (React still throws away the state of the subtree that
// crashed), but it stops the blank-page dead end: it shows a recoverable
// screen instead of nothing, and "Try again" re-renders the children
// without a full page reload, so anything already saved to localStorage or
// Supabase (Platform's convPhase/convExtraction/convModel/brief/sellerForm,
// and now ValuationPlatform's live form via onFormChange) survives.
//
// Must be a class component - componentDidCatch/getDerivedStateFromError
// have no hook equivalent yet.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error: error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Unhandled render error caught by ErrorBoundary:', error, info && info.componentStack);
  }

  handleReset() {
    this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0f172a', padding: '24px',
        }}>
          <div style={{ maxWidth: '480px', textAlign: 'center' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(239,68,68,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
            }}>
              <i className="ti ti-alert-triangle" aria-hidden="true" style={{ fontSize: '22px', color: '#f87171' }} />
            </div>
            <h2 style={{ fontSize: '16px', fontWeight: '600', color: '#fff', margin: '0 0 8px' }}>
              Something went wrong on this screen
            </h2>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', margin: '0 0 20px', lineHeight: '1.6' }}>
              Your progress up to your last change should still be saved. Try again below - if it keeps happening on
              the same screen, a screenshot of the details below will help track down the cause.
            </p>
            <button onClick={this.handleReset} style={{
              padding: '10px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: '500',
              background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', marginRight: '8px',
            }}>Try again</button>
            <button onClick={function () { window.location.reload(); }} style={{
              padding: '10px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: '500',
              background: 'transparent', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer',
            }}>Reload page</button>
            <details style={{ marginTop: '20px', textAlign: 'left' }}>
              <summary style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>Technical details</summary>
              <pre style={{
                fontSize: '11px', color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.05)',
                padding: '10px', borderRadius: '6px', marginTop: '8px', overflowX: 'auto', whiteSpace: 'pre-wrap',
              }}>{String((this.state.error && this.state.error.stack) || this.state.error)}</pre>
            </details>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
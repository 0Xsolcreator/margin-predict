import { useEffect, useRef, useState } from 'react';
import { authStart, authFinish, getAddress, clearSession } from '../../api';
import { C, FONT, FONT_MONO } from '../trade/theme';

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

// Load Google Identity Services once. Resolves with window.google.
let gsiPromise;
function loadGsi() {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error('failed to load Google sign-in'));
    document.head.appendChild(s);
  });
  return gsiPromise;
}

function LogoTile({ size = 64 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: Math.round(size * 0.23), background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 16px 40px rgba(212,245,107,.24)' }}>
      <span style={{ fontFamily: FONT_MONO, fontWeight: 900, fontSize: Math.round(size * 0.6), color: C.bg, lineHeight: 1, letterSpacing: '-0.04em' }}>S</span>
    </div>
  );
}

const short = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';

// Login popup. Runs the backend's Google-nonce handshake: /auth/start gives a
// nonce, Google issues an id_token bound to it, /auth/finish trades it for the
// custodial session token. The backend signs + sponsors everything after that.
function AuthModal({ open, onClose, onAuthed, onGuest }) {
  const address = getAddress();
  const btnRef = useRef(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = e => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Wire the Google button once the modal is open and no session exists.
  useEffect(() => {
    if (!open || address || !GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    (async () => {
      setErr('');
      try {
        const { state, nonce } = await authStart();
        const google = await loadGsi();
        if (cancelled) return;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce,
          callback: async ({ credential }) => {
            try {
              await authFinish(state, credential);
              onAuthed && onAuthed(getAddress());
            } catch (e) { setErr(e.message); }
          },
        });
        if (btnRef.current) {
          btnRef.current.innerHTML = '';
          google.accounts.id.renderButton(btnRef.current, { theme: 'filled_black', size: 'large', width: 348, text: 'continue_with' });
        }
      } catch (e) { if (!cancelled) setErr(e.message); }
    })();
    return () => { cancelled = true; };
  }, [open, address, onAuthed]);

  if (!open) return null;

  const outlineBtn = {
    width: '100%', height: 52, borderRadius: 12, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    fontFamily: FONT, fontSize: 14, background: 'none', border: `1px solid ${C.line2}`, color: C.text, fontWeight: 600,
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(6,6,8,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', animation: 'authFade .18s ease both' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ position: 'relative', width: '100%', maxWidth: 420, border: `1px solid ${C.line2}`, borderRadius: 24, background: 'linear-gradient(180deg,#101106,#0b0b0c)', boxShadow: '0 40px 120px rgba(0,0,0,.7)', padding: '40px 36px 30px', fontFamily: FONT, color: C.text }}
      >
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 16, right: 18, background: 'none', border: 'none', color: C.fainter, cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 28 }}>
          <LogoTile size={64} />
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 20, letterSpacing: 5, marginTop: 18, paddingLeft: 5 }}>STRIKE</div>
          <h1 style={{ fontWeight: 700, fontSize: 24, letterSpacing: -0.5, marginTop: 16 }}>{address ? 'Welcome back' : 'Sign in to trade'}</h1>
          <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.55, marginTop: 8, maxWidth: 300 }}>
            {address ? 'Connected — your positions are signed for you.' : 'Sign in with Google. We hold the key and sponsor every transaction, so there is nothing to install.'}
          </p>
        </div>

        {address ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', border: '1px solid rgba(212,245,107,0.25)', borderRadius: 12, background: 'rgba(212,245,107,0.05)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.lime, boxShadow: `0 0 9px ${C.lime}` }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: C.lime, fontVariantNumeric: 'tabular-nums' }}>{short(address)}</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => { clearSession(); onAuthed && onAuthed(''); }} style={{ background: 'none', border: 'none', color: C.fainter, cursor: 'pointer', fontSize: 12 }}>Sign out</button>
            </div>
            <button onClick={onClose} style={{ ...outlineBtn, background: C.lime, color: C.bg, border: 'none', fontWeight: 700 }}>Continue →</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            {/* Google renders its own button here */}
            <div ref={btnRef} style={{ minHeight: 44, display: 'flex', justifyContent: 'center' }} />

            <button onClick={onGuest || onClose} style={{ ...outlineBtn, border: 'none', height: 40, color: C.fainter, fontWeight: 500, fontSize: 13 }}>
              Continue as guest
            </button>

            {!GOOGLE_CLIENT_ID && (
              <div style={{ fontSize: 10.5, color: C.fainter, textAlign: 'center', lineHeight: 1.5 }}>
                Google sign-in needs <code>REACT_APP_GOOGLE_CLIENT_ID</code> (and a matching backend).
              </div>
            )}
            {err && <div style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{err}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export default AuthModal;

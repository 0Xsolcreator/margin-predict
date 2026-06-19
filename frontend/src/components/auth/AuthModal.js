import { useEffect, useState } from 'react';
import { useWallets, useConnectWallet, useCurrentAccount, useDisconnectWallet, ConnectModal } from '@mysten/dapp-kit';
import { isEnokiWallet } from '@mysten/enoki';
import { C, FONT, FONT_PIXEL } from '../trade/theme';

const COPY = {
  login: { title: 'Welcome back', sub: 'Connect to pick up where you left off.', switchText: "Don't have an account?", switchLabel: 'Sign up' },
  signup: { title: 'Create your account', sub: 'Spin up a wallet or sign in with Google to start trading.', switchText: 'Already have an account?', switchLabel: 'Log in' },
};

function Reticle({ size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ filter: 'drop-shadow(0 0 16px rgba(212,245,107,.4))' }}>
      <circle cx="50" cy="50" r="37" stroke={C.lime} strokeWidth="2.4" opacity="0.6" />
      <circle cx="50" cy="50" r="14" stroke={C.lime} strokeWidth="2.4" opacity="0.5" />
      <line x1="50" y1="3" x2="50" y2="26" stroke={C.lime} strokeWidth="3" strokeLinecap="round" />
      <line x1="50" y1="74" x2="50" y2="97" stroke={C.lime} strokeWidth="3" strokeLinecap="round" />
      <line x1="3" y1="50" x2="26" y2="50" stroke={C.lime} strokeWidth="3" strokeLinecap="round" />
      <line x1="74" y1="50" x2="97" y2="50" stroke={C.lime} strokeWidth="3" strokeLinecap="round" />
      <circle cx="50" cy="50" r="6" fill={C.lime} />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A22 22 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  );
}

const short = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';

// Login/signup popup over a blurred backdrop. Wallet Connect opens the dapp-kit
// modal; Google connects the Enoki zkLogin wallet; guest just dismisses.
function AuthModal({ open, onClose, onGuest }) {
  const [mode, setMode] = useState('login');
  const wallets = useWallets();
  const googleWallet = wallets.find(w => isEnokiWallet(w) && w.provider === 'google');
  const { mutate: connect, isPending } = useConnectWallet();
  const { mutate: disconnect } = useDisconnectWallet();
  const account = useCurrentAccount();

  useEffect(() => {
    if (!open) return;
    const onKey = e => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const copy = COPY[mode];

  const primaryBtn = {
    width: '100%', height: 52, borderRadius: 12, border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    fontFamily: FONT, fontWeight: 700, fontSize: 14, letterSpacing: 0.5,
  };
  const outlineBtn = { ...primaryBtn, background: 'none', border: `1px solid ${C.line2}`, color: C.text, fontWeight: 600 };

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

        {/* brand */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 28 }}>
          <Reticle />
          <div style={{ fontFamily: FONT_PIXEL, fontWeight: 700, fontSize: 18, letterSpacing: 4, marginTop: 16 }}>STRIKE</div>
          <h1 style={{ fontWeight: 700, fontSize: 24, letterSpacing: -0.5, marginTop: 16 }}>{copy.title}</h1>
          <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.55, marginTop: 8, maxWidth: 300 }}>{copy.sub}</p>
        </div>

        {account ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', border: '1px solid rgba(212,245,107,0.25)', borderRadius: 12, background: 'rgba(212,245,107,0.05)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.lime, boxShadow: `0 0 9px ${C.lime}` }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: C.lime, fontVariantNumeric: 'tabular-nums' }}>{short(account.address)}</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => disconnect()} style={{ background: 'none', border: 'none', color: C.fainter, cursor: 'pointer', fontSize: 12 }}>Disconnect</button>
            </div>
            <button onClick={onClose} style={{ ...primaryBtn, background: C.lime, color: C.bg }}>Continue →</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              style={{ ...primaryBtn, background: C.lime, color: C.bg, opacity: googleWallet ? 1 : 0.5 }}
              disabled={!googleWallet || isPending}
              onClick={() => googleWallet && connect({ wallet: googleWallet })}
            >
              <GoogleGlyph /> Continue with Google
            </button>

            <ConnectModal trigger={<button style={outlineBtn} disabled={isPending}>⬡ Connect Wallet</button>} />

            <button onClick={onGuest || onClose} style={{ ...outlineBtn, border: 'none', height: 40, color: C.fainter, fontWeight: 500, fontSize: 13 }}>
              Continue as guest
            </button>

            {!googleWallet && (
              <div style={{ fontSize: 10.5, color: C.fainter, textAlign: 'center', lineHeight: 1.5, marginTop: 2 }}>
                Google sign-in needs <code>REACT_APP_ENOKI_API_KEY</code> &amp; <code>REACT_APP_GOOGLE_CLIENT_ID</code>.
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: 12, color: C.fainter, textAlign: 'center', marginTop: 24 }}>
          {copy.switchText}{' '}
          <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} style={{ background: 'none', border: 'none', color: C.lime, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, fontSize: 12 }}>
            {copy.switchLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AuthModal;

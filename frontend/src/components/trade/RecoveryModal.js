import { useEffect, useState } from 'react';
import { runRecover } from '../../api';
import { C, FONT, FONT_MONO } from './theme';

const short = a => a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '';

// Recover stuck escrow from PENDING_OPEN positions (keeper open never completed).
// `data` = { positions: [{ id, escrowSui }], totalSui } from GET /recover.
function RecoveryModal({ open, onClose, data, onDone }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setResult(null); setErr('');
    const onKey = e => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const positions = data?.positions ?? [];
  const total = data?.totalSui ?? 0;

  const recover = async () => {
    setBusy(true); setErr('');
    try {
      const r = await runRecover();
      r.results.filter(x => !x.ok).forEach(x => console.error(`Recovery failed for ${x.id}: ${x.error}`));
      setResult(r);
      onDone && onDone();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(6,6,8,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', animation: 'authFade .18s ease both' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ position: 'relative', width: '100%', maxWidth: 440, border: `1px solid ${C.line2}`, borderRadius: 24, background: 'linear-gradient(180deg,#101106,#0b0b0c)', boxShadow: '0 40px 120px rgba(0,0,0,.7)', padding: '36px 32px 28px', fontFamily: FONT, color: C.text }}
      >
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 16, right: 18, background: 'none', border: 'none', color: C.fainter, cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>

        <h1 style={{ fontWeight: 700, fontSize: 22, letterSpacing: -0.5, marginBottom: 6 }}>Recover stuck funds</h1>
        <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.55, marginBottom: 22, maxWidth: 360 }}>
          These positions escrowed SUI but never finished opening. Each is clawed back
          on-chain (cancel_intent). Positions younger than 120s are skipped — try again later.
        </p>

        {!result ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, maxHeight: 220, overflowY: 'auto' }}>
              {positions.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', border: `1px solid ${C.line2}`, borderRadius: 12 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.dim }}>{short(p.id)}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.lime, fontVariantNumeric: 'tabular-nums' }}>{p.escrowSui.toFixed(4)} SUI</span>
                </div>
              ))}
              {positions.length === 0 && <div style={{ fontSize: 13, color: C.fainter, textAlign: 'center', padding: 12 }}>Nothing to recover.</div>}
            </div>

            <button
              onClick={recover}
              disabled={busy || positions.length === 0}
              style={{ width: '100%', height: 50, borderRadius: 12, cursor: busy || !positions.length ? 'default' : 'pointer', border: 'none', background: C.lime, color: C.bg, fontFamily: FONT, fontWeight: 700, fontSize: 14, opacity: busy || !positions.length ? 0.5 : 1 }}>
              {busy ? 'Recovering…' : `Recover ${total.toFixed(4)} SUI`}
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.lime }}>Reclaimed {result.recoveredSui.toFixed(4)} SUI</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
              {result.results.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ color: r.ok ? C.lime : C.red }}>{r.ok ? '✓' : '✗'}</span>
                  <span style={{ fontFamily: FONT_MONO, color: C.dim }}>{short(r.id)}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: C.fainter }}>{r.ok ? 'recovered' : r.error}</span>
                </div>
              ))}
            </div>
            <button onClick={onClose} style={{ width: '100%', height: 46, borderRadius: 12, cursor: 'pointer', border: `1px solid ${C.line2}`, background: 'none', color: C.text, fontFamily: FONT, fontWeight: 600, fontSize: 14 }}>Done</button>
          </div>
        )}

        {err && <div style={{ fontSize: 12, color: C.red, textAlign: 'center', marginTop: 14 }}>{err}</div>}
      </div>
    </div>
  );
}

export default RecoveryModal;

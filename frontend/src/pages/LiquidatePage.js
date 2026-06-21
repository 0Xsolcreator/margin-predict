import { useCallback, useEffect, useState } from 'react';
import AuthModal from '../components/auth/AuthModal';
import * as api from '../api';
import { C, FONT, FONT_MONO } from '../components/trade/theme';

const SUI_DP = 1e9;
const DBUSDC_DP = 1e6;

const short = a => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

// Health zone → color + label. Drives every color prompt on a row.
const ZONE = {
  hard:    { clr: C.red,   tint: 'rgba(242,120,92,0.12)', bd: 'rgba(242,120,92,0.35)', label: 'LIQUIDATE NOW' },
  soft:    { clr: C.amber, tint: 'rgba(232,197,90,0.12)', bd: 'rgba(232,197,90,0.30)', label: 'AT RISK' },
  healthy: { clr: C.lime,  tint: 'rgba(212,245,107,0.10)', bd: 'rgba(255,255,255,0.08)', label: 'HEALTHY' },
  expired: { clr: C.fainter, tint: 'rgba(255,255,255,0.04)', bd: 'rgba(255,255,255,0.08)', label: 'EXPIRED' },
};

// hf in × (1.00 = liquidation floor). Bar fills as it pulls away from 1.00→1.50.
const healthPct = bps => (bps == null ? 0 : Math.max(0, Math.min(1, (Number(bps) / 10000 - 1) / 0.5)) * 100);
const hfX = bps => (bps == null ? '—' : (Number(bps) / 10000).toFixed(2) + '×');

function LiquidatePage() {
  const [address, setAddress] = useState(api.getAddress());
  const [authOpen, setAuthOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const refresh = useCallback(async () => {
    try {
      setRows(await api.getMonitor());
      setLoaded(true);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [refresh]);

  const onLiquidate = async (row) => {
    if (!api.getToken()) return setAuthOpen(true); // connect first
    setBusyId(row.positionId); setError(''); setFlash('');
    try {
      const r = await api.liquidate(row.positionId, row.oracleId);
      setFlash(`Liquidated ${short(row.positionId)} (${row.mode}) — ${r.digest ? short(r.digest) : 'done'}`);
      await refresh();
    } catch (e) { setError(e.message); }
    setBusyId(null);
  };

  const atRisk = rows.filter(r => r.liquidatable).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: C.bg, fontFamily: FONT, color: C.text, overflow: 'hidden' }}>
      {/* top bar — same chrome as the trade header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', height: 62, padding: '0 24px', borderBottom: `1px solid ${C.line}`, gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: FONT_MONO, fontWeight: 900, fontSize: 24, color: C.bg, lineHeight: 1, letterSpacing: '-0.04em' }}>S</span>
          </div>
          <span style={{ fontWeight: 600, fontSize: 18, letterSpacing: 5, paddingLeft: 2 }}>LIQUIDATE</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 10, color: C.fainter, border: `1px solid ${C.line2}`, padding: '7px 12px', borderRadius: 999, letterSpacing: 1 }}>SUI TESTNET</div>
        <button onClick={() => setAuthOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 16px', background: address ? 'transparent' : C.lime, border: address ? `1px solid ${C.line2}` : 'none', borderRadius: 999, cursor: 'pointer', fontFamily: FONT, fontWeight: 600, fontSize: 12, color: address ? C.text : C.bg, letterSpacing: 0.5, fontVariantNumeric: 'tabular-nums' }}>
          {address ? short(address) : <>Connect wallet <span style={{ fontSize: 13 }}>→</span></>}
        </button>
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onAuthed={(a) => { setAddress(a); setAuthOpen(false); }} />

      {flash && (
        <div onClick={() => setFlash('')} style={{ flexShrink: 0, padding: '8px 24px', background: 'rgba(212,245,107,0.1)', color: C.lime, fontSize: 12, cursor: 'pointer' }}>{flash} — dismiss</div>
      )}
      {error && (
        <div onClick={() => setError('')} style={{ flexShrink: 0, padding: '8px 24px', background: 'rgba(242,120,92,0.12)', color: C.red, fontSize: 12, cursor: 'pointer' }}>{error} — dismiss</div>
      )}

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
            <h1 style={{ fontWeight: 700, fontSize: 24, letterSpacing: -0.5 }}>Position monitor</h1>
            <span style={{ fontSize: 12, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>
              {rows.length} open{atRisk > 0 && <> · <span style={{ color: C.red }}>{atRisk} liquidatable</span></>}
            </span>
          </div>
          <p style={{ fontSize: 13, color: C.dim, marginBottom: 14, maxWidth: 520, lineHeight: 1.5 }}>
            All open positions, most at-risk first. Anything at or below 1.05× health can be liquidated by anyone — the keeper executes and collects the reporter fee.
          </p>

          {/* color legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 22 }}>
            {[['hard', '≤ 1.00×'], ['soft', '≤ 1.05×'], ['healthy', '> 1.05×']].map(([z, range]) => (
              <div key={z} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: ZONE[z].clr }} />
                <span style={{ fontSize: 10, color: C.faint, letterSpacing: 0.5 }}>{ZONE[z].label} {range}</span>
              </div>
            ))}
          </div>

          {!loaded ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: C.fainter, fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: C.faint }}>No open positions</div>
              <div style={{ fontSize: 11, color: C.ghost, marginTop: 8 }}>Auto-refreshing…</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rows.map(r => {
                const z = ZONE[r.mode] || ZONE.expired;
                const busy = busyId === r.positionId;
                const pct = healthPct(r.healthFactorBps);
                return (
                  <div key={r.positionId} style={{ border: `1px solid ${z.bd}`, borderRadius: 12, padding: 16, background: 'rgba(255,255,255,0.015)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <span style={{ background: z.tint, color: z.clr, fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 8, letterSpacing: 1 }}>{z.label}</span>
                      <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: C.dim }}>{short(r.positionId)}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 11, color: C.fainter }}>owner {short(r.owner)}</span>
                    </div>

                    {/* health bar */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 8, color: C.ghost, letterSpacing: 1 }}>HEALTH FACTOR</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: z.clr, fontVariantNumeric: 'tabular-nums' }}>{hfX(r.healthFactorBps)}</span>
                      </div>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct.toFixed(1)}%`, height: '100%', background: z.clr, borderRadius: 3, transition: 'width 0.3s,background 0.3s' }} />
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', gap: 28 }}>
                        {stat('DEBT', (Number(r.marginDebt) / DBUSDC_DP).toFixed(2), C.dim)}
                        {stat('COLLATERAL', (Number(r.collateralSui) / SUI_DP).toFixed(2) + ' SUI', C.dim)}
                      </div>
                      <button
                        onClick={() => onLiquidate(r)}
                        disabled={busy || !r.liquidatable}
                        title={r.liquidatable ? '' : 'Position is above the liquidation threshold'}
                        style={{ height: 38, padding: '0 20px', background: r.liquidatable ? z.clr : 'transparent', border: r.liquidatable ? 'none' : `1px solid ${C.line2}`, borderRadius: 999, cursor: busy || !r.liquidatable ? 'default' : 'pointer', fontFamily: FONT, fontWeight: 700, fontSize: 13, color: r.liquidatable ? C.bg : C.fainter, letterSpacing: 0.5, opacity: busy ? 0.5 : 1 }}>
                        {busy ? 'Liquidating…' : !r.liquidatable ? 'Healthy' : address ? 'Liquidate' : 'Connect & liquidate'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function stat(label, value, color) {
  return (
    <div>
      <div style={{ fontSize: 8, color: C.ghost, letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums', color }}>{value}</div>
    </div>
  );
}

export default LiquidatePage;

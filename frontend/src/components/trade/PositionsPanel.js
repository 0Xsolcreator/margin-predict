import { C, FONT, FONT_PIXEL } from './theme';

const SUI_DP = 1e9;
const DBUSDC_DP = 1e6;
const HF_NONE = '18446744073709551615'; // u64 max = no debt

const fmtUsd = v => v >= 1000 ? '$' + Math.round(v).toLocaleString() : '$' + v.toFixed(v >= 1 ? 3 : 4);
const fmtSui = v => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3));

// Unrealized PnL estimate. ponytail: linear leveraged-exposure proxy
// (notional × price-return), not the true binary-option mark — good enough to
// color the card. Upgrade path: have the keeper return the live position value.
function pnl(p, spot) {
  if (p.status !== 'OPEN' || !spot || p.entry == null || !p.entry) return null;
  const stake = Number(p.collateralSui || 0) / SUI_DP;
  const lev = p.lev || 1;
  const dirSign = p.dir === 'short' ? -1 : 1;
  const ret = (spot - p.entry) / p.entry;
  const profit = stake * lev * ret * dirSign;
  return { stake, profit, value: stake + profit, pct: stake ? (profit / stake) * 100 : 0, up: profit >= 0 };
}

const STATUS_CLR = {
  OPEN: C.lime, PENDING_OPEN: C.amber, CLOSED: C.fainter, LIQUIDATED: C.red, CANCELLED: C.fainter,
};

// Health from the keeper's healthFactorBps (10000 = 1.00x). Bar fills as the
// position pulls away from the 1.00x liquidation floor.
function health(bps) {
  if (bps == null) return null;
  if (String(bps) === HF_NONE) return { hf: Infinity, pct: 100, clr: C.lime };
  const hf = Number(bps) / 10000;
  const pct = Math.max(0, Math.min(1, (hf - 1) / 0.5)) * 100;
  const clr = bps <= 10000 ? C.red : bps <= 10500 ? C.amber : C.lime;
  return { hf, pct, clr };
}

// The caller's positions from GET /positions, merged with the dir/leverage/strike
// we stashed locally at bet time (the keeper record doesn't carry them).
function PositionsPanel({ positions = [], spot = 0, busy = false, onWithdraw, onClose }) {
  if (positions.length === 0) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontFamily: FONT_PIXEL, fontSize: 13, color: C.fainter, letterSpacing: 1 }}>No open positions</div>
          <div style={{ fontSize: 11, color: '#3a3a3c', marginTop: 8 }}>Place a bet to see it here</div>
        </div>
      </div>
    );
  }

  const stat = (label, value, color, align) => (
    <div style={{ textAlign: align }}>
      <div style={{ fontSize: 8, color: C.ghost, letterSpacing: 1, marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: FONT, fontWeight: 500, fontSize: 12, fontVariantNumeric: 'tabular-nums', color }}>{value}</div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {positions.map(p => {
        const isLong = p.dir !== 'short';
        const stake = Number(p.collateralSui || 0) / SUI_DP;
        const debt = Number(p.marginDebt || 0) / DBUSDC_DP;
        const h = health(p.healthFactorBps);
        const pending = p.status === 'PENDING_OPEN';
        const open = p.status === 'OPEN';
        const pl = pnl(p, spot);
        const plClr = pl ? (pl.up ? C.lime : C.red) : C.text;
        const bd = pl ? (pl.up ? 'rgba(212,245,107,0.3)' : 'rgba(242,120,92,0.3)')
          : h && h.pct <= 25 ? 'rgba(242,120,92,0.3)' : 'rgba(255,255,255,0.08)';
        return (
          <div key={p.positionId} style={{ border: `1px solid ${bd}`, borderRadius: 12, padding: 16, background: 'rgba(255,255,255,0.015)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ background: isLong ? 'rgba(212,245,107,0.12)' : 'rgba(242,120,92,0.12)', color: isLong ? C.lime : C.red, fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 8, letterSpacing: 1 }}>{isLong ? 'LONG' : 'SHORT'}</span>
                {p.lev && <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: C.faint }}>{p.lev}×</span>}
                {p.strikeUsd != null && <span style={{ fontSize: 10, color: C.ghost }}>→ {fmtUsd(p.strikeUsd)}</span>}
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: STATUS_CLR[p.status] || C.faint }}>{p.status}</span>
            </div>

            {pl && (
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14, padding: '12px 14px', borderRadius: 10, background: pl.up ? 'rgba(212,245,107,0.06)' : 'rgba(242,120,92,0.06)', border: `1px solid ${pl.up ? 'rgba(212,245,107,0.18)' : 'rgba(242,120,92,0.18)'}` }}>
                <div>
                  <div style={{ fontSize: 8, color: C.ghost, letterSpacing: 1, marginBottom: 4 }}>POSITION VALUE</div>
                  <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 22, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: plClr }}>
                    {fmtSui(pl.value)} <span style={{ fontSize: 11, fontWeight: 600, color: C.faint }}>SUI</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: plClr, color: C.bg }}>
                  <span style={{ fontSize: 12 }}>{pl.up ? '▲' : '▼'}</span>
                  <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {(pl.up ? '+' : '') + fmtSui(pl.profit)} ({(pl.up ? '+' : '') + pl.pct.toFixed(1)}%)
                  </span>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: h ? 12 : 0 }}>
              {stat('STAKE', stake.toFixed(2) + ' SUI', C.dim, 'left')}
              {p.entry != null && stat('ENTRY', fmtUsd(p.entry), C.dim, 'center')}
              {stat('DEBT', debt.toFixed(2), C.dim, 'right')}
            </div>

            {h && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 8, color: C.ghost, letterSpacing: 1 }}>HEALTH FACTOR</span>
                  <span style={{ fontSize: 9, color: h.clr }}>{h.hf === Infinity ? 'no debt' : h.hf.toFixed(2) + '×'}</span>
                </div>
                <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${h.pct.toFixed(1)}%`, height: '100%', background: h.clr, borderRadius: 3, transition: 'width 0.3s,background 0.3s' }} />
                </div>
              </div>
            )}

            {(open || pending) && (
              <div style={{ display: 'flex', gap: 8 }}>
                {pending && (
                  <button onClick={() => onWithdraw && onWithdraw(p.positionId)} disabled={busy} className="wbtn" style={{ flex: 1, height: 32, background: 'rgba(212,245,107,0.1)', border: '1px solid rgba(212,245,107,0.25)', borderRadius: 8, cursor: busy ? 'default' : 'pointer', fontFamily: FONT, fontSize: 10, fontWeight: 600, color: C.lime, letterSpacing: 1, opacity: busy ? 0.5 : 1 }}>Withdraw escrow</button>
                )}
                {open && (
                  <button onClick={() => onClose && onClose(p.positionId)} disabled={busy} className="ghost" style={{ flex: 1, height: 32, background: 'none', border: `1px solid ${C.line2}`, borderRadius: 8, cursor: busy ? 'default' : 'pointer', fontFamily: FONT, fontSize: 10, fontWeight: 600, color: C.fainter, letterSpacing: 1, opacity: busy ? 0.5 : 1 }}>Close position</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default PositionsPanel;

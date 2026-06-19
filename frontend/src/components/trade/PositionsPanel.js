import { C, FONT, FONT_PIXEL } from './theme';

// Open positions list. onWithdraw / onClose are stubs for now.
function PositionsPanel({ positions = [], onWithdraw, onClose }) {
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
        const isLong = p.d === 'long';
        const hpClr = p.hp > 50 ? C.lime : p.hp > 25 ? C.amber : C.red;
        const bd = p.hp > 25 ? 'rgba(255,255,255,0.08)' : 'rgba(242,120,92,0.3)';
        const wd = Math.max(0, p.i + p.pnl);
        return (
          <div key={p.id} style={{ border: `1px solid ${bd}`, borderRadius: 12, padding: 16, background: 'rgba(255,255,255,0.015)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ background: isLong ? 'rgba(212,245,107,0.12)' : 'rgba(242,120,92,0.12)', color: isLong ? C.lime : C.red, fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 8, letterSpacing: 1 }}>{p.d.toUpperCase()}</span>
                <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: C.faint }}>{p.l}×</span>
                <span style={{ fontSize: 10, color: C.ghost }}>→ ${Math.round(p.t).toLocaleString()}</span>
              </div>
              <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, fontVariantNumeric: 'tabular-nums', color: p.pnl >= 0 ? C.lime : C.red }}>{(p.pnl >= 0 ? '+' : '') + p.pnl.toFixed(2)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              {stat('ENTRY', '$' + Math.round(p.e).toLocaleString(), C.dim, 'left')}
              {stat('STAKE', p.i.toFixed(0), C.dim, 'center')}
              {stat('LIQ', '$' + Math.round(p.liq).toLocaleString(), C.red, 'right')}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 8, color: C.ghost, letterSpacing: 1 }}>MARGIN HEALTH</span>
                <span style={{ fontSize: 9, color: hpClr }}>{Math.round(p.hp)}%</span>
              </div>
              <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${p.hp.toFixed(1)}%`, height: '100%', background: hpClr, borderRadius: 3, transition: 'width 0.3s,background 0.3s' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onWithdraw && onWithdraw(p.id)} className="wbtn" style={{ flex: 1, height: 32, background: 'rgba(212,245,107,0.1)', border: '1px solid rgba(212,245,107,0.25)', borderRadius: 8, cursor: 'pointer', fontFamily: FONT, fontSize: 10, fontWeight: 600, color: C.lime, letterSpacing: 1 }}>Withdraw {wd.toFixed(0)}</button>
              <button onClick={() => onClose && onClose(p.id)} className="ghost" style={{ height: 32, padding: '0 16px', background: 'none', border: `1px solid ${C.line2}`, borderRadius: 8, cursor: 'pointer', fontFamily: FONT, fontSize: 10, fontWeight: 600, color: C.fainter, letterSpacing: 1 }}>Close</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default PositionsPanel;

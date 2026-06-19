import { C, FONT, FONT_PIXEL } from './theme';

// Bet ticket. Controlled by TradePage: shows empty prompt until a strike is
// picked, then direction / leverage / stake / summary. onPlaceBet is a stub.
function BetPanel({
  selectedStrike = null, currentPrice = 105432, balance = 2500,
  dir = 'long', lev = 10, amt = 50,
  onDir, onLev, onAmt, onAmtPct, onClear, onPlaceBet,
}) {
  if (selectedStrike == null) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, textAlign: 'center', minHeight: 340, padding: '0 24px' }}>
        <div style={{ width: 54, height: 54, border: '1px solid rgba(212,245,107,0.25)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 6, height: 6, background: C.lime, borderRadius: '50%' }} />
        </div>
        <div style={{ fontFamily: FONT_PIXEL, fontSize: 14, color: C.faint, letterSpacing: 1 }}>Pick your strike</div>
        <div style={{ fontSize: 11, color: C.ghost, lineHeight: 1.7 }}>Click anywhere on the chart, or tap a<br />level in the ladder, to set your target</div>
      </div>
    );
  }

  const isLong = dir === 'long';
  const dist = selectedStrike - Math.round(currentPrice);
  const notional = amt * lev;
  const liqPrice = isLong ? currentPrice * (1 - 1 / lev) : currentPrice * (1 + 1 / lev);
  const pd = Math.abs(selectedStrike - currentPrice);
  const est = pd ? (amt * lev * pd / currentPrice) : 0;
  const levPct = ((lev - 1) / 49 * 100).toFixed(1);
  const distLabel = dist > 0 ? `+$${dist} above spot` : dist < 0 ? `$${dist} below spot` : 'at spot';

  const ghostBtn = (label, onClick, accent) => (
    <button onClick={onClick} className="ghost" style={{ flex: 1, height: 28, background: 'none', border: `1px solid ${accent ? 'rgba(212,245,107,0.25)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 10, color: accent ? C.lime : C.faint, fontFamily: FONT }}>{label}</button>
  );

  const summaryRow = (label, value, color) => (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 11, color: C.faint }}>{label}</span>
      <span style={{ fontFamily: FONT, fontWeight: 500, fontSize: 13, fontVariantNumeric: 'tabular-nums', color }}>{value}</span>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* strike header */}
      <div style={{ paddingBottom: 16, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
          <span style={{ fontSize: 10, color: C.faint, letterSpacing: 2, whiteSpace: 'nowrap' }}>TARGET STRIKE</span>
          <button onClick={onClear} style={{ background: 'none', border: 'none', color: C.fainter, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 36, color: C.lime, lineHeight: 1, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>${selectedStrike.toLocaleString()}</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 11, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: C.dim }}>{distLabel}</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#3a3a3c', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: isLong ? C.lime : C.red }}>{isLong ? 'long' : 'short'} target</span>
        </div>
      </div>

      {/* direction */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'rgba(255,255,255,0.035)', border: `1px solid ${C.line2}`, borderRadius: 12 }}>
        <button onClick={() => onDir && onDir('long')} className="dir" style={{ flex: 1, height: 38, borderRadius: 8, border: 'none', background: isLong ? 'rgba(212,245,107,0.14)' : 'transparent', cursor: 'pointer', fontFamily: FONT, fontWeight: 600, fontSize: 12, color: isLong ? C.lime : C.fainter, letterSpacing: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>▲ Long</button>
        <button onClick={() => onDir && onDir('short')} className="dir" style={{ flex: 1, height: 38, borderRadius: 8, border: 'none', background: !isLong ? 'rgba(242,120,92,0.14)' : 'transparent', cursor: 'pointer', fontFamily: FONT, fontWeight: 600, fontSize: 12, color: !isLong ? C.red : C.fainter, letterSpacing: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>▼ Short</button>
      </div>

      {/* leverage */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: C.faint, letterSpacing: 2 }}>LEVERAGE</span>
          <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 22, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{lev}<span style={{ color: C.faint, fontSize: 15 }}>×</span></span>
        </div>
        <input type="range" min="1" max="50" value={lev} onChange={e => onLev && onLev(parseInt(e.target.value, 10))}
          style={{ width: '100%', height: 4, borderRadius: 2, outline: 'none', cursor: 'pointer', background: `linear-gradient(to right,${C.lime} ${levPct}%, rgba(255,255,255,0.08) ${levPct}%)` }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7 }}>
          <span style={{ fontSize: 9, color: C.ghost }}>1×</span>
          <span style={{ fontSize: 9, color: C.ghost }}>25×</span>
          <span style={{ fontSize: 9, color: C.ghost }}>50×</span>
        </div>
      </div>

      {/* stake */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
          <span style={{ fontSize: 10, color: C.faint, letterSpacing: 2 }}>STAKE</span>
          <span style={{ fontSize: 9, color: C.fainter }}>balance {Math.round(balance).toLocaleString()} SUI</span>
        </div>
        <div style={{ position: 'relative' }}>
          <input type="number" value={amt} onChange={e => onAmt && onAmt(parseFloat(e.target.value) || 0)}
            style={{ width: '100%', height: 50, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.line2}`, borderRadius: 12, color: C.text, fontFamily: FONT, fontWeight: 600, fontSize: 20, padding: '0 52px 0 16px', outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
          <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: C.fainter }}>SUI</span>
        </div>
        <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
          {ghostBtn('25%', () => onAmtPct && onAmtPct(0.25))}
          {ghostBtn('50%', () => onAmtPct && onAmtPct(0.5))}
          {ghostBtn('75%', () => onAmtPct && onAmtPct(0.75))}
          {ghostBtn('MAX', () => onAmtPct && onAmtPct(1), true)}
        </div>
      </div>

      {/* summary */}
      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {summaryRow('Notional', `${notional.toFixed(0)} SUI`, '#c8c8c2')}
        {summaryRow('Liquidation', `$${Math.round(liqPrice).toLocaleString()}`, C.red)}
        {summaryRow('Payout if hit', `+${est.toFixed(2)} SUI`, C.lime)}
      </div>

      <button onClick={onPlaceBet} className="cta" style={{ width: '100%', height: 54, background: C.lime, border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: FONT, fontWeight: 700, fontSize: 14, color: C.bg, letterSpacing: 1 }}>Place Bet</button>
    </div>
  );
}

export default BetPanel;

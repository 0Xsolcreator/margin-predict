import { C, FONT, FONT_MONO } from './theme';

const short = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';

// Top bar: logo, oracle countdown, network badge, balance, auth trigger.
function Header({ appName = 'STRIKE', oracleCountdown = '02:59:59', balance = 2500, address = '', recoverable = 0, onRecoverClick, onLoginClick }) {
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', height: 62, padding: '0 24px', borderBottom: `1px solid ${C.line}`, gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, flexShrink: 0 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontFamily: FONT_MONO, fontWeight: 900, fontSize: 24, color: C.bg, lineHeight: 1, letterSpacing: '-0.04em' }}>S</span>
        </div>
        <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 18, color: C.text, letterSpacing: 5, paddingLeft: 2 }}>{appName}</span>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', border: `1px solid ${C.line2}`, borderRadius: 999, flexShrink: 0 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.red, animation: 'liveBlink 1.6s infinite' }} />
        <span style={{ fontSize: 10, color: C.faint, letterSpacing: 1 }}>ORACLE</span>
        <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums', color: C.text, letterSpacing: 1 }}>{oracleCountdown}</span>
      </div>

      <div style={{ fontSize: 10, color: C.fainter, border: `1px solid ${C.line2}`, padding: '7px 12px', borderRadius: 999, letterSpacing: 1, flexShrink: 0 }}>SUI TESTNET</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px 6px 14px', border: `1px solid ${C.line2}`, borderRadius: 999, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 8, color: C.fainter, letterSpacing: 1 }}>BALANCE</div>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: C.text }}>
            {Math.round(balance).toLocaleString()} SUI
          </div>
          {recoverable > 0 && (
            <div onClick={onRecoverClick} title="Recover stuck funds" style={{ fontFamily: FONT, fontWeight: 600, fontSize: 10, color: C.red, cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>
              {recoverable.toFixed(2)} SUI stuck — recover →
            </div>
          )}
        </div>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ width: 9, height: 9, background: C.bg, borderRadius: 3 }} />
        </div>
      </div>

      <button onClick={onLoginClick} className="cta" style={{ display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 16px', background: address ? 'transparent' : C.lime, border: address ? `1px solid ${C.line2}` : 'none', borderRadius: 999, cursor: 'pointer', fontFamily: FONT, fontWeight: 600, fontSize: 12, color: address ? C.text : C.bg, letterSpacing: 0.5, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {address ? short(address) : <>Log in <span style={{ fontSize: 13 }}>→</span></>}
      </button>
    </div>
  );
}

export default Header;

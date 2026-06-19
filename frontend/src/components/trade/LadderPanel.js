import { useMemo, useRef, useEffect } from 'react';
import { C } from './theme';

// Price ladder: ±50 levels around spot, stepped by the market's tick size.
// ponytail: probabilities are a one-time random seed per level — static is fine
// for the design; replace with pool sizes from chain when wired.
function LadderPanel({ currentPrice = 105432, step = 1, selectedStrike = null, onSelectStrike }) {
  const ref = useRef(null);
  const base = Math.round(currentPrice / step) * step;
  const dec = step < 1 ? Math.min(6, Math.ceil(-Math.log10(step))) : 0;
  const fmt = p => p.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });

  const levels = useMemo(() => {
    const out = [];
    for (let i = 50; i >= -50; i--) {
      const p = +(base + i * step).toFixed(dec);
      const lr = Math.random() * 0.6 + 0.2; // long ratio 0.2–0.8
      out.push({ p, lr, isCurrent: i === 0 });
    }
    return out;
  }, [base, step, dec]);

  // center the ladder on the current price on mount
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = 50 * 31 - el.clientHeight / 2 + 15;
  }, []);

  return (
    <div style={{ width: 158, flexShrink: 0, borderLeft: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 10px', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: C.faint, letterSpacing: 2 }}>LEVELS</span>
        <span style={{ fontSize: 9, color: C.ghost }}>±50</span>
      </div>
      <div ref={ref} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {levels.map(({ p, lr, isCurrent }) => {
          const isSel = selectedStrike === p;
          const cls = 'lv-row' + (isCurrent ? ' lv-current' : '') + (isSel ? ' lv-selected' : '');
          const clr = isCurrent || isSel ? C.lime : C.dim;
          return (
            <div
              key={p}
              className={cls}
              onClick={() => onSelectStrike && onSelectStrike(p)}
              style={{ height: isCurrent ? 40 : 31, display: 'flex', alignItems: 'center', gap: 9, padding: '0 13px', position: 'relative' }}
            >
              {isCurrent && (
                <>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: C.lime }} />
                  <div style={{ position: 'absolute', left: 3, right: 0, top: 0, height: 1, background: 'rgba(212,245,107,0.4)' }} />
                  <div style={{ position: 'absolute', left: 3, right: 0, bottom: 0, height: 1, background: 'rgba(212,245,107,0.4)' }} />
                </>
              )}
              <span style={{ fontSize: isCurrent ? 13 : 11, fontWeight: isCurrent ? 700 : 400, color: clr, minWidth: 50, fontVariantNumeric: 'tabular-nums' }}>
                {fmt(p)}
              </span>
              {isCurrent ? (
                <>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: lr >= 0.5 ? C.lime : C.red, fontVariantNumeric: 'tabular-nums', letterSpacing: 0.5 }}>
                    {(lr >= 0.5 ? '▲ ' : '▼ ') + Math.round(lr * 100) + '%'}
                  </span>
                </>
              ) : (
                <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(lr * 100).toFixed(1)}%`, background: 'linear-gradient(to right,#f2785c,#d4f56b)', borderRadius: 3, transition: 'width 0.5s ease' }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default LadderPanel;

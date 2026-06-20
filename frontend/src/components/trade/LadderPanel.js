import { useMemo, useRef, useEffect } from 'react';
import { C } from './theme';

const ROWS = 15; // levels above and below current price

function LadderPanel({
  currentPrice = 105432,
  step = 1,
  selectedStrike = null,
  onSelectStrike,
  loading = false,
  probabilities = {},
  probsReady = false,
}) {
  const ref = useRef(null);
  // Track whether the first reveal has happened so we can skip the CSS
  // transition on initial load (all bars appear at once) and enable it after.
  const everReadyRef = useRef(false);
  const dec = step < 1 ? Math.min(6, Math.ceil(-Math.log10(step))) : 0;
  const fmt = p => p.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });

  const currentP = +(Math.round(currentPrice / step) * step).toFixed(dec);

  // Fixed 31 rows: ROWS above + current + ROWS below. Probability shown when
  // available, zero bar when not — list never changes length or position.
  const levels = useMemo(() => {
    const out = [];
    for (let i = ROWS; i >= -ROWS; i--) {
      const p = +(currentP + i * step).toFixed(dec);
      const prob = probabilities[p];
      out.push({
        p,
        lr: prob ? (prob.up ?? 0) : 0,
        hasData: !!prob,
        isCurrent: i === 0,
      });
    }
    return out;
  }, [currentP, step, dec, probabilities]);

  // First time probsReady flips true: mark reveal done so transition enables
  // after this render (bars appear instantly together, then animate on updates).
  const isFirstReveal = probsReady && !everReadyRef.current;
  if (isFirstReveal) everReadyRef.current = true;
  const barTransition = everReadyRef.current && !isFirstReveal ? 'width 0.5s ease' : 'none';

  // Keep current price row centered
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = ROWS * 31 - el.clientHeight / 2 + 15;
  }, []);

  return (
    <div style={{ width: 158, flexShrink: 0, borderLeft: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 10px', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: C.faint, letterSpacing: 2 }}>LEVELS</span>
        <span style={{ fontSize: 9, color: C.ghost }}>±{ROWS}</span>
      </div>
      <div ref={ref} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {loading ? (
          Array.from({ length: ROWS * 2 + 1 }, (_, i) => (
            <div key={i} style={{ height: 31, display: 'flex', alignItems: 'center', gap: 9, padding: '0 13px' }}>
              <div className="sk" style={{ width: 44, height: 10, borderRadius: 4 }} />
              <div className="sk" style={{ flex: 1, height: 6, borderRadius: 3, opacity: 0.5 + 0.5 * Math.sin((i / (ROWS * 2)) * Math.PI) }} />
            </div>
          ))
        ) : levels.map(({ p, lr, hasData, isCurrent }) => {
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
                    {hasData
                      ? (lr >= 0.5 ? '▲ ' : '▼ ') + Math.round(lr * 100) + '%'
                      : '--'}
                  </span>
                </>
              ) : (
                <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: hasData ? `${(lr * 100).toFixed(1)}%` : '0%',
                    background: 'linear-gradient(to right,#f2785c,#d4f56b)',
                    borderRadius: 3,
                    transition: barTransition,
                  }} />
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

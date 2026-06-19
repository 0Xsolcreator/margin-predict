import { useEffect, useRef, useState } from 'react';
import { C, FONT } from './theme';

const RANGES = ['1H', '4H', '1D', '1W', '1M', 'MAX'];
const RANGE_COUNTS = { '1H': 48, '4H': 96, '1D': 180, '1W': 300, '1M': 420, MAX: 560 };

// Binance klines: public, no auth, CORS-open. Maps each range to a candle size
// that gives roughly the right time window and point density.
const RANGE_FETCH = {
  '1H':  { interval: '1m',  limit: 60 },   // 60 × 1m  = 1 h
  '4H':  { interval: '5m',  limit: 48 },   // 48 × 5m  = 4 h
  '1D':  { interval: '15m', limit: 96 },   // 96 × 15m = 24 h
  '1W':  { interval: '1h',  limit: 168 },  // 168 × 1h = 7 d
  '1M':  { interval: '6h',  limit: 120 },  // 120 × 6h = 30 d
  'MAX': { interval: '1d',  limit: 365 },  // 365 × 1d = 1 y
};

async function fetchHistory(range) {
  const { interval, limit } = RANGE_FETCH[range] ?? RANGE_FETCH['1D'];
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`,
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows.map(r => parseFloat(r[4])); // r[4] = candle close price
  } catch {
    return null;
  }
}

// Live SUI/USD chart panel: price header, animated canvas, range tabs.
// Consumes real-time Pyth prices via the livePrice prop; falls back to a tiny
// random walk around the seed price until the feed connects.
function PriceChart({ selectedStrike = null, onSelectStrike, positions = [], oracleExp, oracleHours = 3, livePrice = null }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const heroRef = useRef(null);
  const changeRef = useRef(null);
  const [range, setRange] = useState('1D');

  // mutable sim state kept in a ref so the rAF loop sees fresh values
  const sim = useRef({ history: [], price: 100000, display: 100000, viewFirst: 100000, hover: null, ymap: null });
  const rangeRef = useRef(range);
  const selRef = useRef(selectedStrike);
  const posRef = useRef(positions);
  const livePriceRef = useRef(livePrice);
  const seededRef = useRef(false); // true once first real price arrives
  rangeRef.current = range;
  selRef.current = selectedStrike;
  posRef.current = positions;
  livePriceRef.current = livePrice;

  // Drive sim.price from the live feed. On first arrival, seed display and kick
  // off the real history fetch for the current range.
  useEffect(() => {
    if (livePrice == null) return;
    const s = sim.current;
    s.price = livePrice;
    if (!seededRef.current) {
      seededRef.current = true;
      s.display = livePrice;
      fetchHistory(range).then(prices => {
        if (prices && prices.length >= 2) s.history = prices;
      });
    }
  }, [livePrice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload history whenever the user switches the range tab (needs real price first).
  useEffect(() => {
    if (!seededRef.current) return;
    fetchHistory(range).then(prices => {
      if (prices && prices.length >= 2) sim.current.history = prices;
    });
  }, [range]);

  useEffect(() => {
    const cont = containerRef.current, cv = chartRef.current;
    if (!cont || !cv) return;
    const s = sim.current;

    const resize = () => { cv.width = cont.clientWidth; cv.height = cont.clientHeight; };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cont);

    const exp = oracleExp ?? Date.now() + oracleHours * 3600000;

    const draw = () => {
      if (!cv.width || !cv.height) return;
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);

      const n = RANGE_COUNTS[rangeRef.current] || 180;
      const view = s.history.slice(-n);
      if (view.length < 2) return;
      const pts = view.slice();
      pts[pts.length - 1] = s.display;

      const min = Math.min(...pts), max = Math.max(...pts);
      const rng = (max - min) || 1;
      const padT = 40, padB = 30, axisR = 64;
      const plotW = W - axisR, plotH = H - padT - padB;
      const nowX = plotW * 0.76;
      s.viewFirst = pts[0];

      const X = i => i / (pts.length - 1) * nowX;
      const Y = v => padT + (1 - (v - min) / rng) * plotH;
      s.ymap = { padT, plotH, min, rng, plotW };
      const lime = C.lime;

      // area fill
      const g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      g.addColorStop(0, 'rgba(244,244,239,0.07)');
      g.addColorStop(1, 'rgba(244,244,239,0)');
      ctx.beginPath();
      ctx.moveTo(0, Y(pts[0]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(i), Y(pts[i]));
      ctx.lineTo(X(pts.length - 1), padT + plotH);
      ctx.lineTo(0, padT + plotH);
      ctx.closePath();
      ctx.fillStyle = g; ctx.fill();

      // line
      ctx.beginPath();
      ctx.moveTo(0, Y(pts[0]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(i), Y(pts[i]));
      ctx.lineJoin = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = C.text;
      ctx.shadowColor = 'rgba(244,244,239,0.25)'; ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // hi/lo markers
      const hiIdx = pts.indexOf(max), loIdx = pts.indexOf(min);
      const marker = (val, idx, above) => {
        const y = Y(val);
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = C.text;
        ctx.beginPath(); ctx.arc(X(idx), y, 3, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `11px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const label = val >= 100 ? '$' + Math.round(val).toLocaleString() : '$' + val.toFixed(4);
        ctx.fillText(label, 2, above ? y - 7 : y + 15);
      };
      marker(max, hiIdx, true);
      marker(min, loIdx, false);

      // selected target
      const sel = selRef.current;
      if (sel != null && sel >= min && sel <= max) {
        const y = Y(sel);
        ctx.strokeStyle = lime; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = lime; ctx.fillRect(plotW, y - 9, axisR, 18);
        ctx.fillStyle = C.bg; ctx.font = `600 10px ${FONT}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(sel >= 100 ? '$' + Math.round(sel).toLocaleString() : '$' + sel.toFixed(4), plotW + 5, y);
      }

      // hover guide
      if (s.hover != null && s.hover >= min && s.hover <= max && sel !== s.hover) {
        const y = Y(s.hover);
        ctx.strokeStyle = 'rgba(212,245,107,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(212,245,107,0.5)'; ctx.font = `10px ${FONT}`;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(s.hover >= 100 ? '$' + Math.round(s.hover).toLocaleString() : '$' + s.hover.toFixed(4), plotW - 4, y - 9);
      }

      // position entry lines
      posRef.current.forEach(pos => {
        if (pos.e < min || pos.e > max) return;
        const y = Y(pos.e);
        ctx.strokeStyle = pos.d === 'long' ? 'rgba(212,245,107,0.4)' : 'rgba(242,120,92,0.4)';
        ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW * 0.5, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = pos.d === 'long' ? lime : C.red;
        ctx.font = `10px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(pos.d === 'long' ? '▲' : '▼', 4, y - 4);
      });

      // live → expiry window
      const msLeft = Math.max(0, exp - Date.now());
      const totalWin = (oracleHours * 3600000) || 1;
      const frac = Math.max(0, Math.min(1, msLeft / totalWin));
      const expiryX = nowX + (plotW - nowX) * frac;

      ctx.fillStyle = 'rgba(255,140,90,0.05)';
      ctx.fillRect(nowX, padT - 6, expiryX - nowX, plotH + 6);

      ctx.strokeStyle = 'rgba(244,244,239,0.12)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(nowX, padT - 6); ctx.lineTo(nowX, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = 'rgba(255,140,90,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(expiryX, padT - 6); ctx.lineTo(expiryX, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
      const z = x => String(x).padStart(2, '0');
      const cd = msLeft <= 0 ? 'SETTLED'
        : z(Math.floor(msLeft / 3600000)) + ':' + z(Math.floor((msLeft % 3600000) / 60000)) + ':' + z(Math.floor((msLeft % 60000) / 1000));
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(255,140,90,0.75)'; ctx.font = `9px ${FONT}`;
      ctx.fillText('EXPIRY', expiryX - 5, padT + 2);
      ctx.fillStyle = 'rgba(255,140,90,0.45)'; ctx.font = `10px ${FONT}`;
      ctx.fillText(cd, expiryX - 5, padT + 16);

      // live dot
      const lx = X(pts.length - 1), ly = Y(s.display);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 380);
      ctx.beginPath(); ctx.arc(lx, ly, 4 + pulse * 6, 0, 7);
      ctx.fillStyle = 'rgba(212,245,107,' + (0.16 * (1 - pulse)) + ')'; ctx.fill();
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, 7);
      ctx.fillStyle = lime; ctx.fill();
    };

    // Keep the last history bar in sync with the live price so the right-hand
    // tip of the chart always reflects the current Pyth value.
    const tick = setInterval(() => {
      if (s.history.length > 0) s.history[s.history.length - 1] = s.price;
    }, 500);

    let raf;
    const loop = () => {
      s.display += (s.price - s.display) * 0.12;
      // Hero shows the exact live price (not the smoothed display value) so it
      // matches what Pyth reports without any animation lag.
      if (heroRef.current) {
        const d = s.price;
        heroRef.current.textContent = '$' + (d >= 100 ? Math.round(d).toLocaleString() : d.toFixed(4));
      }
      if (changeRef.current) {
        const chg = ((s.display - s.viewFirst) / s.viewFirst) * 100;
        const up = chg >= 0;
        changeRef.current.textContent = (up ? '▲ ' : '▼ ') + Math.abs(chg).toFixed(2) + '%';
        changeRef.current.style.color = up ? C.lime : C.red;
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => { clearInterval(tick); cancelAnimationFrame(raf); ro.disconnect(); };
  }, [oracleExp, oracleHours]);

  const priceFromY = clientY => {
    const cont = containerRef.current, s = sim.current;
    if (!cont || !s.ymap) return null;
    const y = clientY - cont.getBoundingClientRect().top;
    const { padT, plotH, min, rng } = s.ymap;
    return Math.round(min + (1 - (y - padT) / plotH) * rng);
  };

  const loading = livePrice == null;

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '24px 28px 18px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, marginBottom: 6, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 10, color: C.faint, letterSpacing: 2, marginBottom: loading ? 10 : 6 }}>BTC / USD — ORACLE FEED</div>
          {loading
            ? <div className="sk" style={{ width: 220, height: 52, marginBottom: 4 }} />
            : <div ref={heroRef} style={{ fontFamily: "'Doto',monospace", fontWeight: 600, fontSize: 58, lineHeight: 0.9, color: C.text, letterSpacing: 1 }}>—</div>
          }
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 8 }}>
          {loading
            ? <div className="sk" style={{ width: 72, height: 18 }} />
            : <span ref={changeRef} style={{ fontSize: 15, fontWeight: 500, color: C.red }}>—</span>
          }
        </div>
      </div>

      {/* Chart area — canvas is always in the DOM so the RAF effect can mount on it.
          The skeleton sits on top as an absolute overlay while loading. */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {loading && (
          <div className="sk" style={{ position: 'absolute', inset: 0, borderRadius: 10, zIndex: 1 }} />
        )}
        <div
          ref={containerRef}
          className="chart-wrap"
          style={{ position: 'absolute', inset: 0, visibility: loading ? 'hidden' : 'visible' }}
          onMouseMove={e => { sim.current.hover = priceFromY(e.clientY); }}
          onMouseLeave={() => { sim.current.hover = null; }}
          onClick={() => { const h = sim.current.hover; if (h != null && onSelectStrike) onSelectStrike(h); }}
        >
          <canvas ref={chartRef} style={{ display: 'block', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, flexShrink: 0 }}>
        {loading
          ? RANGES.map(r => <div key={r} className="sk" style={{ width: 48, height: 30 }} />)
          : RANGES.map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`pill${range === r ? ' pill-on' : ''}`}
                style={{ height: 30, padding: '0 16px', background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: FONT, fontSize: 11, fontWeight: 500, color: C.fainter, letterSpacing: 1 }}
              >
                {r}
              </button>
            ))
        }
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: loading ? C.fainter : C.lime, animation: loading ? 'skPulse 1.4s ease-in-out infinite' : 'liveBlink 1.6s infinite' }} />
          <span style={{ fontSize: 10, color: C.fainter, letterSpacing: 1 }}>{loading ? 'CONNECTING' : 'LIVE'}</span>
        </div>
      </div>
    </div>
  );
}

export default PriceChart;

import { useEffect, useRef, useState } from 'react';
import { C, FONT } from './theme';

const RANGES = ['1H', '4H', '1D', '1W', '1M', 'MAX'];
const RANGE_COUNTS = { '1H': 48, '4H': 96, '1D': 180, '1W': 300, '1M': 420, MAX: 560 };

// Live BTC chart panel: price header, animated canvas, range tabs.
// Self-contained price simulation; emits a clicked strike via onSelectStrike.
// ponytail: mock price walk + canvas, no data feed yet — swap _startSim for the
// oracle websocket when it exists.
function PriceChart({ selectedStrike = null, onSelectStrike, positions = [], oracleExp, oracleHours = 3 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const heroRef = useRef(null);
  const changeRef = useRef(null);
  const [range, setRange] = useState('1D');

  // mutable sim state kept in a ref so the rAF loop sees fresh values
  const sim = useRef({ history: [], price: 105432, display: 105432, viewFirst: 105432, hover: null, ymap: null });
  const rangeRef = useRef(range);
  const selRef = useRef(selectedStrike);
  const posRef = useRef(positions);
  rangeRef.current = range;
  selRef.current = selectedStrike;
  posRef.current = positions;

  useEffect(() => {
    const cont = containerRef.current, cv = chartRef.current;
    if (!cont || !cv) return;
    const s = sim.current;

    // seed history
    let p = 104900;
    const h = [];
    for (let i = 0; i < 560; i++) { p += (Math.random() - 0.49) * 95; h.push(p); }
    s.history = h; s.price = p; s.display = p;

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
        ctx.fillText('$' + Math.round(val).toLocaleString(), 2, above ? y - 7 : y + 15);
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
        ctx.fillText('$' + Math.round(sel).toLocaleString(), plotW + 5, y);
      }

      // hover guide
      if (s.hover != null && s.hover >= min && s.hover <= max && sel !== s.hover) {
        const y = Y(s.hover);
        ctx.strokeStyle = 'rgba(212,245,107,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(212,245,107,0.5)'; ctx.font = `10px ${FONT}`;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText('$' + s.hover.toLocaleString(), plotW - 4, y - 9);
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

    const tick = setInterval(() => {
      s.price += (Math.random() - 0.487) * 42;
      s.history.push(s.price);
      if (s.history.length > 560) s.history.shift();
    }, 600);

    let raf;
    const loop = () => {
      s.display += (s.price - s.display) * 0.12;
      if (heroRef.current) heroRef.current.textContent = '$' + Math.round(s.display).toLocaleString();
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

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '24px 28px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, marginBottom: 6, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 10, color: C.faint, letterSpacing: 2, marginBottom: 6 }}>BTC / USD — ORACLE FEED</div>
          <div ref={heroRef} style={{ fontFamily: "'Doto',monospace", fontWeight: 600, fontSize: 58, lineHeight: 0.9, color: C.text, letterSpacing: 1 }}>$105,432</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 8 }}>
          <span ref={changeRef} style={{ fontSize: 15, fontWeight: 500, color: C.red }}>▼ 2.04%</span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="chart-wrap"
        style={{ flex: 1, minHeight: 0, position: 'relative' }}
        onMouseMove={e => { sim.current.hover = priceFromY(e.clientY); }}
        onMouseLeave={() => { sim.current.hover = null; }}
        onClick={() => { const h = sim.current.hover; if (h != null && onSelectStrike) onSelectStrike(h); }}
      >
        <canvas ref={chartRef} style={{ display: 'block', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, flexShrink: 0 }}>
        {RANGES.map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`pill${range === r ? ' pill-on' : ''}`}
            style={{ height: 30, padding: '0 16px', background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: FONT, fontSize: 11, fontWeight: 500, color: C.fainter, letterSpacing: 1 }}
          >
            {r}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.lime, animation: 'liveBlink 1.6s infinite' }} />
          <span style={{ fontSize: 10, color: C.fainter, letterSpacing: 1 }}>LIVE</span>
        </div>
      </div>
    </div>
  );
}

export default PriceChart;

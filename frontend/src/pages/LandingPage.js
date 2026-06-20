import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollToPlugin);

// ponytail: faithful port of "STRIKE Landing.dc.html" — markup kept as a static
// HTML string (our own content, no user input) so inline styles survive verbatim;
// the 3 design effects are ported into one effect below.

const YEAR = new Date().getFullYear();

const MARKUP = `
  <!-- NAV -->
  <div style="position:sticky;top:0;z-index:50;backdrop-filter:blur(14px);background:rgba(10,10,11,0.72);border-bottom:1px solid rgba(255,255,255,0.06)">
    <div style="max-width:1180px;margin:0 auto;height:70px;padding:0 32px;display:flex;align-items:center;gap:14px">
      <a href="#top" style="display:flex;align-items:center;gap:13px">
        <div style="width:36px;height:36px;border-radius:10px;background:#d4f56b;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <span style="font-family:'Doto',monospace;font-weight:900;font-size:22px;color:#0a0a0b;line-height:1;letter-spacing:-.04em">S</span>
        </div>
        <span style="font-weight:600;font-size:19px;letter-spacing:5px;color:#f4f4ef;padding-left:2px">STRIKE</span>
      </a>
      <div style="flex:1"></div>
      <div style="display:flex;align-items:center;gap:34px;margin-right:8px">
        <a href="#how" class="nlink" style="font-size:13px;font-weight:500;color:#9a9a96;letter-spacing:.3px">How it works</a>
        <a href="#features" class="nlink" style="font-size:13px;font-weight:500;color:#9a9a96;letter-spacing:.3px">Features</a>
        <a href="#arena" class="nlink" style="font-size:13px;font-weight:500;color:#9a9a96;letter-spacing:.3px">Arena</a>
        <a href="#" class="nlink" style="font-size:13px;font-weight:500;color:#9a9a96;letter-spacing:.3px">Docs</a>
      </div>
      <a href="/app" class="lpill" style="display:flex;align-items:center;gap:8px;height:42px;padding:0 22px;background:#d4f56b;border-radius:999px;font-weight:600;font-size:13px;color:#0a0a0b;letter-spacing:.5px">Launch app <span style="font-size:14px">&rarr;</span></a>
    </div>
  </div>

  <!-- HERO -->
  <div id="top" style="position:relative;background:radial-gradient(120% 75% at 50% -10%,#13160b 0%,#0a0a0b 58%);overflow:hidden">
    <svg width="120" height="120" viewBox="0 0 100 100" fill="none" style="position:absolute;top:120px;left:5%;opacity:.06;animation:drift 13s ease-in-out infinite">
      <circle cx="50" cy="50" r="37" stroke="#d4f56b" stroke-width="2"/><line x1="50" y1="6" x2="50" y2="94" stroke="#d4f56b" stroke-width="2"/><line x1="6" y1="50" x2="94" y2="50" stroke="#d4f56b" stroke-width="2"/>
    </svg>
    <svg width="80" height="80" viewBox="0 0 100 100" fill="none" style="position:absolute;top:340px;right:7%;opacity:.07;animation:drift 17s ease-in-out infinite">
      <circle cx="50" cy="50" r="37" stroke="#d4f56b" stroke-width="2.5"/><circle cx="50" cy="50" r="7" fill="#d4f56b"/>
    </svg>

    <div style="position:relative;max-width:1000px;margin:0 auto;padding:84px 32px 40px;text-align:center;display:flex;flex-direction:column;align-items:center">
      <div class="rv" style="display:inline-flex;align-items:center;gap:9px;padding:8px 16px;border:1px solid rgba(212,245,107,.22);border-radius:999px;background:rgba(212,245,107,.05);margin-bottom:30px">
        <span style="width:6px;height:6px;border-radius:50%;background:#d4f56b;animation:blink 1.6s infinite"></span>
        <span style="font-family:'Pixelify Sans',sans-serif;font-size:12px;letter-spacing:2px;color:#cde08a">LEVERAGED BTC MARKETS &middot; SUI TESTNET</span>
      </div>

      <h1 class="rv" data-d="60" style="font-weight:700;font-size:92px;line-height:0.95;letter-spacing:-2.5px;margin-bottom:26px;text-wrap:balance">Pick a price.<br><span style="color:#d4f56b;text-shadow:0 0 44px rgba(212,245,107,.35)">Strike it.</span></h1>

      <p class="rv" data-d="120" style="max-width:560px;font-size:18px;line-height:1.6;color:#9a9a96;font-weight:400;margin-bottom:38px;text-wrap:pretty">Click anywhere on the live BTC chart, dial leverage up to 50&times;, and let the oracle settle the round. No order books. No spreads. Just your call.</p>

      <div class="rv" data-d="180" style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
        <a href="/app" class="lpill" style="display:flex;align-items:center;gap:9px;height:54px;padding:0 30px;background:#d4f56b;border-radius:999px;font-weight:700;font-size:15px;color:#0a0a0b;letter-spacing:.5px;box-shadow:0 6px 28px rgba(212,245,107,.24)">Launch app <span style="font-size:16px">&rarr;</span></a>
        <a href="#how" class="gpill" style="display:flex;align-items:center;height:54px;padding:0 26px;border:1px solid rgba(255,255,255,.14);border-radius:999px;font-weight:600;font-size:15px;color:#c8c8c2">How it works &darr;</a>
      </div>
      <div class="rv" data-d="220" style="font-size:12px;color:#5a5a58">Free testnet faucet &middot; No real funds &middot; Non-custodial</div>

      <!-- product frame -->
      <div class="rv" data-d="120" style="width:100%;margin-top:60px;border:1px solid rgba(255,255,255,.08);border-radius:18px;background:linear-gradient(180deg,#101106,#0b0b0c);box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 0 1px rgba(212,245,107,.04);overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;height:42px;padding:0 16px;border-bottom:1px solid rgba(255,255,255,.06)">
          <span style="width:10px;height:10px;border-radius:50%;background:#3a3a3c"></span>
          <span style="width:10px;height:10px;border-radius:50%;background:#3a3a3c"></span>
          <span style="width:10px;height:10px;border-radius:50%;background:#3a3a3c"></span>
          <div style="flex:1;display:flex;justify-content:center"><span style="font-size:11px;color:#5a5a58;letter-spacing:1px">app.strike.markets</span></div>
        </div>
        <div style="display:flex;height:368px">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;padding:18px 20px 12px">
            <div style="display:flex;align-items:flex-end;gap:14px;margin-bottom:4px">
              <div style="text-align:left">
                <div style="font-size:9px;color:#7d7d7a;letter-spacing:2px;margin-bottom:5px">BTC / USD &mdash; ORACLE FEED</div>
                <div id="btcPrice" style="font-family:'Doto',monospace;font-weight:600;font-size:42px;line-height:.9;color:#f4f4ef;letter-spacing:1px">$105,432</div>
              </div>
              <span style="font-size:13px;font-weight:500;color:#d4f56b;padding-bottom:4px">&#9650; 1.92%</span>
            </div>
            <div id="heroWrap" style="flex:1;min-height:0;position:relative">
              <canvas id="heroChart" style="display:block;position:absolute;inset:0;width:100%;height:100%"></canvas>
            </div>
          </div>
          <div style="width:228px;flex-shrink:0;border-left:1px solid rgba(255,255,255,.06);padding:18px;display:flex;flex-direction:column;gap:14px;text-align:left">
            <div>
              <div style="font-size:9px;color:#7d7d7a;letter-spacing:2px;margin-bottom:7px">TARGET STRIKE</div>
              <div style="font-family:'Doto',monospace;font-weight:600;font-size:30px;color:#d4f56b;line-height:1">$106,800</div>
              <div style="font-size:10px;color:#9a9a96;margin-top:6px">+$1,368 above spot &middot; 63% long</div>
            </div>
            <div style="display:flex;gap:4px;padding:4px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);border-radius:12px">
              <div style="flex:1;height:34px;border-radius:8px;background:rgba(212,245,107,.14);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;color:#d4f56b;letter-spacing:1px">&#9650; Long</div>
              <div style="flex:1;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;color:#5a5a58;letter-spacing:1px">&#9660; Short</div>
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px"><span style="font-size:9px;color:#7d7d7a;letter-spacing:2px">LEVERAGE</span><span style="font-family:'Doto',monospace;font-weight:600;font-size:18px;color:#f4f4ef">20<span style="color:#7d7d7a;font-size:13px">&times;</span></span></div>
              <div style="height:4px;border-radius:2px;background:linear-gradient(to right,#d4f56b 39%,rgba(255,255,255,.08) 39%)"></div>
            </div>
            <div style="border-top:1px solid rgba(255,255,255,.06);padding-top:12px;display:flex;flex-direction:column;gap:8px">
              <div style="display:flex;justify-content:space-between"><span style="font-size:11px;color:#7d7d7a">Notional</span><span style="font-size:12px;color:#c8c8c2;font-variant-numeric:tabular-nums">5,000 SUI</span></div>
              <div style="display:flex;justify-content:space-between"><span style="font-size:11px;color:#7d7d7a">Payout if hit</span><span style="font-size:12px;color:#d4f56b;font-variant-numeric:tabular-nums">+1,240 SUI</span></div>
            </div>
            <div style="flex:1"></div>
            <div style="height:44px;border-radius:12px;background:#d4f56b;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#0a0a0b;letter-spacing:1px">Place Bet</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- STAT BAND -->
  <div style="background:#d4f56b;color:#0a0a0b">
    <div style="max-width:1180px;margin:0 auto;padding:54px 32px;display:grid;grid-template-columns:repeat(4,1fr);gap:24px">
      <div class="rv" style="text-align:center;border-left:1px solid rgba(10,10,11,.14);padding-left:24px"><div style="font-family:'Doto',monospace;font-weight:700;font-size:58px;line-height:.9;letter-spacing:1px">50&times;</div><div style="font-family:'Pixelify Sans',sans-serif;font-size:12px;letter-spacing:2px;margin-top:10px;color:#2a2c14">MAX LEVERAGE</div></div>
      <div class="rv" style="text-align:center;border-left:1px solid rgba(10,10,11,.14);padding-left:24px"><div style="font-family:'Doto',monospace;font-weight:700;font-size:58px;line-height:.9;letter-spacing:1px">3H</div><div style="font-family:'Pixelify Sans',sans-serif;font-size:12px;letter-spacing:2px;margin-top:10px;color:#2a2c14">ORACLE ROUNDS</div></div>
      <div class="rv" style="text-align:center;border-left:1px solid rgba(10,10,11,.14);padding-left:24px"><div style="font-family:'Doto',monospace;font-weight:700;font-size:58px;line-height:.9;letter-spacing:1px">100%</div><div style="font-family:'Pixelify Sans',sans-serif;font-size:12px;letter-spacing:2px;margin-top:10px;color:#2a2c14">ON-CHAIN SETTLED</div></div>
      <div class="rv" style="text-align:center;border-left:1px solid rgba(10,10,11,.14);padding-left:24px"><div style="font-family:'Doto',monospace;font-weight:700;font-size:58px;line-height:.9;letter-spacing:1px">0</div><div style="font-family:'Pixelify Sans',sans-serif;font-size:12px;letter-spacing:2px;margin-top:10px;color:#2a2c14">ORDER BOOKS</div></div>
    </div>
  </div>

  <!-- HOW IT WORKS -->
  <div id="how" style="background:#0a0a0b">
    <div style="max-width:1180px;margin:0 auto;padding:108px 32px">
      <div class="rv" style="text-align:center;margin-bottom:64px">
        <div style="font-family:'Pixelify Sans',sans-serif;font-size:13px;letter-spacing:3px;color:#7d8a52;margin-bottom:16px">HOW IT WORKS</div>
        <h2 style="font-weight:700;font-size:52px;line-height:1.02;letter-spacing:-1.5px">Three taps to a position.</h2>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px">
        <div class="rv wcard" data-d="0" style="display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:34px 30px 0;background:linear-gradient(180deg,#0e0f08,#0b0b0c);overflow:hidden">
          <div style="font-family:'Doto',monospace;font-weight:700;font-size:46px;color:#d4f56b;line-height:1;margin-bottom:22px">01</div>
          <div style="font-size:21px;font-weight:600;margin-bottom:12px;letter-spacing:-.3px">Pick your strike</div>
          <div style="font-size:14px;line-height:1.65;color:#9a9a96">Click anywhere on the live chart to set a target price. Long if you think it gets there, short if you don't.</div>
          <div class="cviz">
            <svg viewBox="0 0 300 130" preserveAspectRatio="none" width="100%" height="130" style="display:block">
              <defs>
                <linearGradient id="vScan" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d4f56b" stop-opacity="0"/><stop offset=".5" stop-color="#d4f56b" stop-opacity=".22"/><stop offset="1" stop-color="#d4f56b" stop-opacity="0"/></linearGradient>
                <linearGradient id="vArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4f56b" stop-opacity=".22"/><stop offset="1" stop-color="#d4f56b" stop-opacity="0"/></linearGradient>
              </defs>
              <line x1="0" y1="34" x2="300" y2="34" stroke="rgba(255,255,255,.06)"/><line x1="0" y1="74" x2="300" y2="74" stroke="rgba(255,255,255,.06)"/>
              <path d="M0,98 L26,88 52,94 78,72 104,80 130,54 156,64 182,40 208,50 234,32 260,42 300,32 L300,130 L0,130 Z" fill="url(#vArea)"/>
              <polyline points="0,98 26,88 52,94 78,72 104,80 130,54 156,64 182,40 208,50 234,32 260,42 300,32" fill="none" stroke="#d4f56b" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
              <line x1="0" y1="46" x2="300" y2="46" stroke="#d4f56b" stroke-width="1.3" stroke-dasharray="5 6" opacity=".5"/>
              <rect class="pa" x="0" y="0" width="50" height="130" fill="url(#vScan)" style="animation:scanX 2.6s linear infinite"/>
              <g class="pa" style="animation:retBob 3.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center">
                <circle cx="208" cy="50" r="12" fill="none" stroke="#d4f56b" stroke-width="1.7"/>
                <line x1="208" y1="33" x2="208" y2="43" stroke="#d4f56b" stroke-width="1.7" stroke-linecap="round"/>
                <line x1="208" y1="57" x2="208" y2="67" stroke="#d4f56b" stroke-width="1.7" stroke-linecap="round"/>
                <line x1="191" y1="50" x2="201" y2="50" stroke="#d4f56b" stroke-width="1.7" stroke-linecap="round"/>
                <line x1="215" y1="50" x2="225" y2="50" stroke="#d4f56b" stroke-width="1.7" stroke-linecap="round"/>
                <circle class="pa" cx="208" cy="50" r="3" fill="#d4f56b" style="animation:dotPulse 1.6s ease-in-out infinite;transform-box:fill-box;transform-origin:center"/>
              </g>
            </svg>
          </div>
        </div>
        <div class="rv wcard" data-d="100" style="display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:34px 30px 0;background:linear-gradient(180deg,#0e0f08,#0b0b0c);overflow:hidden">
          <div style="font-family:'Doto',monospace;font-weight:700;font-size:46px;color:#d4f56b;line-height:1;margin-bottom:22px">02</div>
          <div style="font-size:21px;font-weight:600;margin-bottom:12px;letter-spacing:-.3px">Dial the leverage</div>
          <div style="font-size:14px;line-height:1.65;color:#9a9a96">Slide from 1&times; to 50&times;. Bigger conviction means a bigger payout &mdash; and a tighter liquidation.</div>
          <div class="cviz">
            <div style="width:100%;max-width:240px;display:flex;flex-direction:column;gap:16px">
              <div style="display:flex;justify-content:space-between;align-items:flex-end">
                <span style="font-family:'Pixelify Sans',sans-serif;font-size:11px;letter-spacing:1.5px;color:#7d8a52">LEVERAGE</span>
                <span class="pa" style="font-family:'Doto',monospace;font-weight:700;font-size:26px;color:#d4f56b;line-height:1;display:inline-block;animation:badgePulse 1.4s ease-in-out infinite">50&times;</span>
              </div>
              <div style="position:relative;height:8px;border-radius:999px;background:rgba(255,255,255,.08)">
                <div class="pa" style="position:absolute;left:0;top:0;height:8px;border-radius:999px;background:#d4f56b;width:16%;box-shadow:0 0 12px rgba(212,245,107,.5);animation:fillW 3.4s ease-in-out infinite"></div>
                <div class="pa" style="position:absolute;top:50%;left:16%;width:18px;height:18px;border-radius:50%;background:#d4f56b;border:3px solid #0b0b0c;transform:translate(-50%,-50%);box-shadow:0 0 14px rgba(212,245,107,.6);animation:thumbL 3.4s ease-in-out infinite"></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-family:'Doto',monospace;font-size:11px;color:#5a5a58"><span>1&times;</span><span>10&times;</span><span>25&times;</span><span>50&times;</span></div>
            </div>
          </div>
        </div>
        <div class="rv wcard" data-d="200" style="display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:34px 30px 0;background:linear-gradient(180deg,#0e0f08,#0b0b0c);overflow:hidden">
          <div style="font-family:'Doto',monospace;font-weight:700;font-size:46px;color:#d4f56b;line-height:1;margin-bottom:22px">03</div>
          <div style="font-size:21px;font-weight:600;margin-bottom:12px;letter-spacing:-.3px">Oracle settles</div>
          <div style="font-size:14px;line-height:1.65;color:#9a9a96">When the round expires the oracle reads the price on-chain. Hit your strike, take the payout instantly.</div>
          <div class="cviz">
            <div style="width:100%;display:flex;flex-direction:column;align-items:center;gap:12px">
              <div style="font-family:'Pixelify Sans',sans-serif;font-size:10px;letter-spacing:2px;color:#7d8a52">ORACLE PRICE &middot; SETTLED</div>
              <div style="display:flex;align-items:baseline;gap:1px;font-family:'Doto',monospace;font-weight:700">
                <span style="font-size:17px;color:#9a9a96">$</span><span class="pa" style="font-size:34px;color:#f4f4ef;display:inline-block;animation:flash 2.4s ease-in-out infinite">67,431</span>
              </div>
              <div style="display:flex;align-items:center;gap:9px">
                <span class="pa" style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#d4f56b;animation:checkPulse 1.6s ease-in-out infinite">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L19 7" stroke="#0b0b0c" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </span>
                <span style="font-family:'Doto',monospace;font-weight:700;font-size:14px;color:#d4f56b">+128 SUI PAID</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- FEATURES -->
  <div id="features" style="background:radial-gradient(110% 70% at 50% 0%,#0e1007 0%,#0a0a0b 60%)">
    <div style="max-width:1180px;margin:0 auto;padding:30px 32px 108px">
      <div class="rv" style="text-align:center;margin-bottom:60px">
        <div style="font-family:'Pixelify Sans',sans-serif;font-size:13px;letter-spacing:3px;color:#7d8a52;margin-bottom:16px">BUILT FOR THE DEGEN IN YOU</div>
        <h2 style="font-weight:700;font-size:52px;line-height:1.02;letter-spacing:-1.5px;text-wrap:balance">Fast feed. Fair settlement.<br>Pure conviction.</h2>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px">
        <div class="rv wcard" data-d="0" style="display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:36px 30px 0;background:rgba(255,255,255,.015);overflow:hidden">
          <div style="font-size:21px;font-weight:600;margin-bottom:12px;letter-spacing:-.3px">Oracle-settled</div>
          <div style="font-size:14px;line-height:1.65;color:#9a9a96">Every round closes on a tamper-proof on-chain price feed. No trading desk, no spread games, no last-look.</div>
          <div class="cviz">
            <div style="width:100%;display:flex;align-items:center;justify-content:center;gap:18px">
              <svg width="74" height="74" viewBox="0 0 100 100" fill="none" style="flex:none;filter:drop-shadow(0 0 12px rgba(212,245,107,.3))">
                <circle cx="50" cy="50" r="37" stroke="#d4f56b" stroke-width="2.6" opacity=".5"/>
                <circle class="pa" cx="50" cy="50" r="14" stroke="#d4f56b" stroke-width="2.6" fill="none" style="animation:badgePulse 1.9s ease-in-out infinite;transform-box:fill-box;transform-origin:center"/>
                <line x1="50" y1="4" x2="50" y2="24" stroke="#d4f56b" stroke-width="3" stroke-linecap="round"/>
                <line x1="50" y1="76" x2="50" y2="96" stroke="#d4f56b" stroke-width="3" stroke-linecap="round"/>
                <line x1="4" y1="50" x2="24" y2="50" stroke="#d4f56b" stroke-width="3" stroke-linecap="round"/>
                <line x1="76" y1="50" x2="96" y2="50" stroke="#d4f56b" stroke-width="3" stroke-linecap="round"/>
                <circle class="pa" cx="50" cy="50" r="5" fill="#d4f56b" style="animation:dotPulse 1.6s ease-in-out infinite;transform-box:fill-box;transform-origin:center"/>
              </svg>
              <div style="display:flex;flex-direction:column;gap:9px">
                <div class="pa" style="display:flex;align-items:center;gap:7px;animation:flash 1.8s ease-in-out infinite"><span style="width:8px;height:8px;border-radius:2px;background:#d4f56b"></span><span style="width:66px;height:7px;border-radius:3px;background:rgba(212,245,107,.45)"></span></div>
                <div class="pa" style="display:flex;align-items:center;gap:7px;animation:flash 1.8s ease-in-out .3s infinite"><span style="width:8px;height:8px;border-radius:2px;background:#d4f56b"></span><span style="width:48px;height:7px;border-radius:3px;background:rgba(212,245,107,.45)"></span></div>
                <div class="pa" style="display:flex;align-items:center;gap:7px;animation:flash 1.8s ease-in-out .6s infinite"><span style="width:8px;height:8px;border-radius:2px;background:#d4f56b"></span><span style="width:58px;height:7px;border-radius:3px;background:rgba(212,245,107,.45)"></span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="rv wcard" data-d="100" style="display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:36px 30px 0;background:rgba(255,255,255,.015);overflow:hidden">
          <div style="font-size:21px;font-weight:600;margin-bottom:12px;letter-spacing:-.3px">Up to 50&times; leverage</div>
          <div style="font-size:14px;line-height:1.65;color:#9a9a96">Push your edge as far as your nerve allows. Notional scales with conviction &mdash; so does the upside.</div>
          <div class="cviz">
            <div style="width:100%;display:flex;flex-direction:column;align-items:center;gap:14px">
              <div style="display:flex;align-items:flex-end;gap:7px;height:66px">
                <div class="pa" style="width:13px;height:24px;border-radius:4px;background:linear-gradient(180deg,#d4f56b,#8fb53a);transform-origin:bottom;transform:scaleY(.28);animation:eqBar 1.5s ease-in-out infinite"></div>
                <div class="pa" style="width:13px;height:32px;border-radius:4px;background:linear-gradient(180deg,#d4f56b,#8fb53a);transform-origin:bottom;transform:scaleY(.28);animation:eqBar 1.5s ease-in-out .11s infinite"></div>
                <div class="pa" style="width:13px;height:40px;border-radius:4px;background:linear-gradient(180deg,#d4f56b,#8fb53a);transform-origin:bottom;transform:scaleY(.28);animation:eqBar 1.5s ease-in-out .22s infinite"></div>
                <div class="pa" style="width:13px;height:48px;border-radius:4px;background:linear-gradient(180deg,#d4f56b,#8fb53a);transform-origin:bottom;transform:scaleY(.28);animation:eqBar 1.5s ease-in-out .33s infinite"></div>
                <div class="pa" style="width:13px;height:55px;border-radius:4px;background:linear-gradient(180deg,#d4f56b,#8fb53a);transform-origin:bottom;transform:scaleY(.28);animation:eqBar 1.5s ease-in-out .44s infinite"></div>
                <div class="pa" style="width:13px;height:61px;border-radius:4px;background:linear-gradient(180deg,#d4f56b,#8fb53a);transform-origin:bottom;transform:scaleY(.28);animation:eqBar 1.5s ease-in-out .55s infinite"></div>
                <div class="pa" style="width:13px;height:66px;border-radius:4px;background:linear-gradient(180deg,#d4f56b,#8fb53a);transform-origin:bottom;transform:scaleY(.28);animation:eqBar 1.5s ease-in-out .66s infinite"></div>
              </div>
              <div style="font-family:'Doto',monospace;font-weight:700;font-size:13px;letter-spacing:1px;color:#7d8a52">1&times;<span style="color:#5a5a58;margin:0 9px">&rarr;</span><span style="color:#d4f56b">50&times;</span></div>
            </div>
          </div>
        </div>
        <div class="rv wcard" data-d="200" style="display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:36px 30px 0;background:rgba(255,255,255,.015);overflow:hidden">
          <div style="font-size:21px;font-weight:600;margin-bottom:12px;letter-spacing:-.3px">Climb the Arena</div>
          <div style="font-size:14px;line-height:1.65;color:#9a9a96">Live leaderboard ranks every trader by realized PnL. Real wins, real bragging rights, zero anonymity.</div>
          <div class="cviz">
            <div style="width:100%;max-width:240px;display:flex;flex-direction:column;gap:8px">
              <div class="pa" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid rgba(212,245,107,.18);border-radius:9px;animation:rowGlow 2s ease-in-out infinite">
                <span style="font-family:'Doto',monospace;font-weight:700;font-size:13px;color:#d4f56b;width:18px">03</span>
                <span class="pa" style="color:#d4f56b;font-size:11px;display:inline-block;animation:bobY 1.4s ease-in-out infinite">&#9650;</span>
                <span style="flex:1;font-size:12px;font-weight:600;color:#d4f56b">You</span>
                <span style="font-family:'Doto',monospace;font-weight:700;font-size:12px;color:#d4f56b">+412</span>
              </div>
              <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:9px;background:rgba(255,255,255,.02)">
                <span style="font-family:'Doto',monospace;font-size:13px;color:#5a5a58;width:18px">04</span>
                <span style="flex:1;font-size:12px;color:#9a9a96">0xF2&hellip;9c</span>
                <span style="font-family:'Doto',monospace;font-size:12px;color:#7a7a78">+388</span>
              </div>
              <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:9px;background:rgba(255,255,255,.02)">
                <span style="font-family:'Doto',monospace;font-size:13px;color:#5a5a58;width:18px">05</span>
                <span style="flex:1;font-size:12px;color:#9a9a96">degen_sol</span>
                <span style="font-family:'Doto',monospace;font-size:12px;color:#7a7a78">+341</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ARENA TEASER -->
  <div id="arena" style="background:#0a0a0b">
    <div style="max-width:1180px;margin:0 auto;padding:0 32px 108px;display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center">
      <div class="rv">
        <div style="font-family:'Pixelify Sans',sans-serif;font-size:13px;letter-spacing:3px;color:#7d8a52;margin-bottom:16px">THE ARENA</div>
        <h2 style="font-weight:700;font-size:48px;line-height:1.04;letter-spacing:-1.5px;margin-bottom:22px">Top of the board, or nothing.</h2>
        <p style="font-size:16px;line-height:1.65;color:#9a9a96;margin-bottom:30px;max-width:440px">Every position you settle moves you up the live rankings. Stack wins, run your streak, and put your name where the whole arena can see it.</p>
        <a href="/app" class="lpill" style="display:inline-flex;align-items:center;gap:9px;height:50px;padding:0 26px;background:#d4f56b;border-radius:999px;font-weight:700;font-size:14px;color:#0a0a0b;letter-spacing:.5px">Enter the Arena <span style="font-size:15px">&rarr;</span></a>
      </div>
      <div class="rv" data-d="120" style="border:1px solid rgba(255,255,255,.08);border-radius:18px;background:linear-gradient(180deg,#0e0f08,#0b0b0c);padding:14px 8px 10px">
        <div style="font-family:'Pixelify Sans',sans-serif;font-size:12px;color:#7d7d7a;letter-spacing:2px;padding:10px 18px 14px">TOP TRADERS &middot; LIVE</div>
        ${[
          { rank: '01', medal: '\u{1F947}', name: 'APEX_BULL', trades: 234, win: '76%', pnl: '48,234', rankClr: '#d4f56b' },
          { rank: '02', medal: '\u{1F948}', name: 'PRICEWHALE', trades: 187, win: '71%', pnl: '31,820', rankClr: '#9a9a96' },
          { rank: '03', medal: '\u{1F949}', name: 'SUI_BEAST', trades: 156, win: '68%', pnl: '24,150', rankClr: '#cd7f4a' },
          { rank: '04', medal: '', name: 'NEON_SHORT', trades: 203, win: '64%', pnl: '18,900', rankClr: '#5a5a58' },
          { rank: '05', medal: '', name: 'CRYPTONAUT', trades: 98, win: '61%', pnl: '15,420', rankClr: '#5a5a58' },
        ].map(t => `
        <div class="lrow" style="display:flex;align-items:center;gap:13px;padding:11px 18px;border-radius:10px">
          <div style="width:20px;font-family:'Doto',monospace;font-weight:600;font-size:15px;color:${t.rankClr}">${t.rank}</div>
          <div style="width:20px;text-align:center;font-size:15px">${t.medal}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:500;color:#e4e4df">${t.name}</div>
            <div style="font-size:10px;color:#4a4a4c;margin-top:2px">${t.trades} trades &middot; ${t.win} win</div>
          </div>
          <div style="text-align:right"><div style="font-family:'Doto',monospace;font-weight:600;font-size:14px;color:#d4f56b">+${t.pnl}</div><div style="font-size:8px;color:#3a3a3c;margin-top:1px">SUI</div></div>
        </div>`).join('')}
        <div style="display:flex;align-items:center;gap:13px;padding:13px 18px;margin:8px 8px 4px;border:1px solid rgba(212,245,107,.2);border-radius:12px;background:rgba(212,245,107,.05)">
          <div style="width:20px;font-family:'Doto',monospace;font-weight:600;font-size:15px;color:#d4f56b">47</div>
          <div style="width:20px;text-align:center;font-size:15px">&#9733;</div>
          <div style="flex:1"><div style="font-size:13px;font-weight:600;color:#d4f56b">You</div><div style="font-size:10px;color:#5a5a58;margin-top:2px">climbing fast</div></div>
          <div style="text-align:right"><div style="font-family:'Doto',monospace;font-weight:600;font-size:14px;color:#d4f56b">+412</div><div style="font-size:8px;color:#3a3a3c;margin-top:1px">SUI</div></div>
        </div>
      </div>
    </div>
  </div>

  <!-- FINAL CTA -->
  <div style="position:relative;background:radial-gradient(90% 130% at 50% 120%,#1a1f0a 0%,#0a0a0b 60%);overflow:hidden">
    <svg width="100" height="100" viewBox="0 0 100 100" fill="none" style="position:absolute;bottom:40px;left:8%;opacity:.08;animation:drift 15s ease-in-out infinite"><circle cx="50" cy="50" r="37" stroke="#d4f56b" stroke-width="2.5"/><circle cx="50" cy="50" r="7" fill="#d4f56b"/></svg>
    <div class="rv" style="max-width:840px;margin:0 auto;padding:120px 32px;text-align:center;display:flex;flex-direction:column;align-items:center">
      <svg width="56" height="56" viewBox="0 0 100 100" fill="none" style="margin-bottom:30px;filter:drop-shadow(0 0 26px rgba(212,245,107,.5))">
        <circle cx="50" cy="50" r="37" stroke="#d4f56b" stroke-width="2.4" opacity="0.6"/><circle cx="50" cy="50" r="14" stroke="#d4f56b" stroke-width="2.4" opacity="0.5"/>
        <line x1="50" y1="3" x2="50" y2="26" stroke="#d4f56b" stroke-width="3" stroke-linecap="round"/><line x1="50" y1="74" x2="50" y2="97" stroke="#d4f56b" stroke-width="3" stroke-linecap="round"/><line x1="3" y1="50" x2="26" y2="50" stroke="#d4f56b" stroke-width="3" stroke-linecap="round"/><line x1="74" y1="50" x2="97" y2="50" stroke="#d4f56b" stroke-width="3" stroke-linecap="round"/>
        <circle cx="50" cy="50" r="6" fill="#d4f56b"/>
      </svg>
      <h2 style="font-weight:700;font-size:72px;line-height:1;letter-spacing:-2px;margin-bottom:22px">Ready to strike?</h2>
      <p style="font-size:18px;color:#9a9a96;margin-bottom:36px;max-width:480px;line-height:1.6">Spin up a free testnet wallet, grab faucet SUI, and place your first bet in under a minute.</p>
      <a href="/app" class="lpill" style="display:inline-flex;align-items:center;gap:10px;height:58px;padding:0 36px;background:#d4f56b;border-radius:999px;font-weight:700;font-size:16px;color:#0a0a0b;letter-spacing:.5px;box-shadow:0 8px 34px rgba(212,245,107,.3)">Launch app <span style="font-size:18px">&rarr;</span></a>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="background:#08080a;padding:0 14px 14px">
    <div style="position:relative;max-width:1280px;margin:0 auto;background:linear-gradient(180deg,#101106,#0c0d07);border:1px solid rgba(255,255,255,.07);border-radius:30px;padding:60px 52px 34px;overflow:hidden">
      <svg width="320" height="320" viewBox="0 0 100 100" fill="none" style="position:absolute;top:-90px;right:-70px;opacity:.045;pointer-events:none;animation:drift 20s ease-in-out infinite"><circle cx="50" cy="50" r="37" stroke="#d4f56b" stroke-width="1.6"/><line x1="50" y1="6" x2="50" y2="94" stroke="#d4f56b" stroke-width="1.6"/><line x1="6" y1="50" x2="94" y2="50" stroke="#d4f56b" stroke-width="1.6"/></svg>

      <div style="position:relative;display:grid;grid-template-columns:280px 1fr;gap:56px;align-items:stretch">
        <div style="display:flex;flex-direction:column;justify-content:space-between;gap:40px;min-width:0">
          <div>
            <div style="width:58px;height:58px;border-radius:14px;background:#d4f56b;display:flex;align-items:center;justify-content:center;box-shadow:0 14px 34px rgba(212,245,107,.22);margin-bottom:20px">
              <span style="font-family:'Doto',monospace;font-weight:900;font-size:36px;color:#0a0a0b;line-height:1;letter-spacing:-.04em">S</span>
            </div>
            <div style="font-weight:600;font-size:19px;letter-spacing:5px;margin-bottom:14px">STRIKE</div>
            <div style="font-size:13px;line-height:1.65;color:#5a5a58;max-width:230px">Oracle-settled, leveraged BTC price markets. Running on SUI testnet.</div>
          </div>
          <div style="display:inline-flex;align-self:flex-start;align-items:center;gap:9px;padding:9px 15px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);border-radius:999px;font-size:12px;color:#9a9a96;font-weight:500">
            <span style="width:7px;height:7px;border-radius:50%;background:#d4f56b;box-shadow:0 0 9px #d4f56b;animation:blink 1.8s infinite"></span>All systems operational
          </div>
        </div>

        <div style="min-width:0">
          <div style="background:rgba(212,245,107,.035);border:1px solid rgba(255,255,255,.06);border-radius:22px;padding:34px 36px 28px;margin-bottom:56px">
            <div class="fnl" style="padding-bottom:16px">
              <input class="email-in" type="email" placeholder="Enter your email" style="width:100%;background:transparent;border:none;outline:none;color:#f4f4ef;font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:clamp(32px,3.9vw,54px);letter-spacing:-1.6px;line-height:1.05;padding:0">
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between;margin-top:22px">
              <div style="font-size:15px;color:#9a9a96;max-width:430px;line-height:1.55">Oracle drops, new markets, and arena results &mdash; straight to your inbox. No spam, just signal.</div>
              <button class="lpill" style="display:inline-flex;align-items:center;gap:8px;height:50px;padding:0 30px;background:#d4f56b;border:none;border-radius:999px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px;color:#0a0a0b;letter-spacing:.5px;cursor:pointer;white-space:nowrap">Sign up <span style="font-size:15px">&rarr;</span></button>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:32px">
            <div>
              <div style="font-family:'Pixelify Sans',sans-serif;font-size:11px;letter-spacing:2px;color:#5a5a58;margin-bottom:18px">PRODUCT</div>
              <div style="display:flex;flex-direction:column;gap:13px;font-size:13px;color:#9a9a96">
                <a href="#how" class="nlink">How it works</a><a href="#features" class="nlink">Features</a><a href="#arena" class="nlink">Arena</a><a href="/app" class="nlink">Launch app</a>
              </div>
            </div>
            <div>
              <div style="font-family:'Pixelify Sans',sans-serif;font-size:11px;letter-spacing:2px;color:#5a5a58;margin-bottom:18px">RESOURCES</div>
              <div style="display:flex;flex-direction:column;gap:13px;font-size:13px;color:#9a9a96">
                <a href="#" class="nlink">Docs</a><a href="#" class="nlink">Oracle feed</a><a href="#" class="nlink">Faucet</a><a href="#" class="nlink">Status</a>
              </div>
            </div>
            <div>
              <div style="font-family:'Pixelify Sans',sans-serif;font-size:11px;letter-spacing:2px;color:#5a5a58;margin-bottom:18px">COMPANY</div>
              <div style="display:flex;flex-direction:column;gap:13px;font-size:13px;color:#9a9a96">
                <a href="#" class="nlink">About</a><a href="#" class="nlink">Roadmap</a><a href="#" class="nlink">Brand kit</a><a href="#" class="nlink">Careers</a>
              </div>
            </div>
            <div>
              <div style="font-family:'Pixelify Sans',sans-serif;font-size:11px;letter-spacing:2px;color:#5a5a58;margin-bottom:18px">SOCIALS</div>
              <div style="display:flex;flex-direction:column;gap:13px;font-size:13px;color:#9a9a96">
                <a href="#" class="soc nlink" style="display:flex;align-items:center;gap:9px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7d8a52" stroke-width="2.4" stroke-linecap="round"><path d="M3 3l18 18M21 3L3 21"/></svg>X / Twitter</a>
                <a href="#" class="soc nlink" style="display:flex;align-items:center;gap:9px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7d8a52" stroke-width="2.2" stroke-linejoin="round"><path d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5V20l-4-3H6.5A2.5 2.5 0 014 14.5z"/><circle cx="9.5" cy="10.5" r="1.1" fill="#7d8a52" stroke="none"/><circle cx="14.5" cy="10.5" r="1.1" fill="#7d8a52" stroke="none"/></svg>Discord</a>
                <a href="#" class="soc nlink" style="display:flex;align-items:center;gap:9px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7d8a52" stroke-width="2.2" stroke-linejoin="round"><path d="M21 4L3 11l5 2 2 6 3-4 5 4z"/></svg>Telegram</a>
                <a href="#" class="soc nlink" style="display:flex;align-items:center;gap:9px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7d8a52" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l-6-6 6-6M15 6l6 6-6 6"/></svg>GitHub</a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style="position:relative;display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:center;margin-top:48px;padding-top:26px;border-top:1px solid rgba(255,255,255,.06)">
        <div style="font-size:12px;color:#4a4a4c">&copy; ${YEAR} STRIKE &middot; Testnet only &mdash; tokens carry no monetary value. Not financial advice.</div>
        <div style="display:flex;gap:24px;font-size:12px;color:#7a7a78"><a href="#" class="nlink">Terms</a><a href="#" class="nlink">Privacy</a><a href="#" class="nlink">Cookies</a></div>
      </div>
    </div>
  </div>
`;

function LandingPage() {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cleanups = [];

    // ── buttery smooth scroll (Lenis + GSAP ticker) ──
    const lenis = new Lenis({
      duration: 1.4,
      easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 0.9,
      touchMultiplier: 1.8,
    });
    const onTick = time => lenis.raf(time * 1000);
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);
    cleanups.push(() => { gsap.ticker.remove(onTick); lenis.destroy(); });

    // ── smooth scroll for anchor links ──
    const handleAnchorClick = e => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href').slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -70, duration: 1.2, easing: t => 1 - Math.pow(1 - t, 4) });
    };
    root.addEventListener('click', handleAnchorClick);
    cleanups.push(() => root.removeEventListener('click', handleAnchorClick));

    // ── reveal on scroll ──
    const els = [...root.querySelectorAll('.rv')];
    const check = () => {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      els.forEach(e => {
        if (e.classList.contains('on')) return;
        const r = e.getBoundingClientRect();
        if (r.top < vh * 0.9 && r.bottom > 0) {
          const d = e.getAttribute('data-d');
          if (d) e.style.animationDelay = d + 'ms';
          e.classList.add('on');
        }
      });
    };
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    check();
    requestAnimationFrame(check);
    const t1 = setTimeout(check, 80);
    const t2 = setTimeout(check, 240);
    cleanups.push(() => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      clearTimeout(t1); clearTimeout(t2);
    });

    // ── card wobble ──
    const P = 'perspective(950px) ';
    const edgeOf = (card, e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'bottom' : 'top');
    };
    const ORIGIN = { top: '50% 0%', bottom: '50% 100%', left: '0% 50%', right: '100% 50%' };
    const LEAN = {
      top: 'rotateX(9deg) rotateZ(-2.2deg)',
      bottom: 'rotateX(-9deg) rotateZ(2.2deg)',
      left: 'rotateY(-9deg) rotateZ(2.2deg)',
      right: 'rotateY(9deg) rotateZ(-2.2deg)',
    };
    const REST = 'rotateX(0deg) rotateY(0deg) rotateZ(0deg) translateY(-8px) scale(1.025)';
    root.querySelectorAll('.wcard').forEach(card => {
      card.style.willChange = 'transform';
      let resetT = null;
      const enter = e => {
        clearTimeout(resetT);
        const d = edgeOf(card, e);
        card.style.transformOrigin = ORIGIN[d];
        card.style.boxShadow = '0 26px 64px rgba(0,0,0,.5), 0 0 0 1px rgba(212,245,107,.18)';
        card.style.zIndex = '5';
        card.style.transition = 'none';
        card.style.transform = P + LEAN[d] + ' translateY(-8px) scale(1.04)';
        void card.offsetWidth;
        requestAnimationFrame(() => {
          card.style.transition = 'transform .62s cubic-bezier(.34,1.5,.4,1)';
          card.style.transform = P + REST;
        });
      };
      const leave = e => {
        const d = edgeOf(card, e);
        card.style.transformOrigin = ORIGIN[d];
        card.style.transition = 'transform .5s cubic-bezier(.4,0,.45,1), box-shadow .5s ease';
        card.style.transform = P + LEAN[d] + ' translateY(0) scale(1)';
        card.style.boxShadow = '';
        resetT = setTimeout(() => {
          card.style.transition = 'transform .25s ease';
          card.style.transform = '';
          card.style.transformOrigin = '';
          card.style.zIndex = '';
        }, 470);
      };
      card.addEventListener('mouseenter', enter);
      card.addEventListener('mouseleave', leave);
      cleanups.push(() => {
        card.removeEventListener('mouseenter', enter);
        card.removeEventListener('mouseleave', leave);
        clearTimeout(resetT);
      });
    });

    // ── hero chart ──
    const cv = root.querySelector('#heroChart');
    const cont = root.querySelector('#heroWrap');
    const btc = root.querySelector('#btcPrice');
    if (cv && cont) {
      let price = 104600;
      const h = [];
      for (let i = 0; i < 200; i++) { price += (Math.random() - 0.485) * 62; h.push(price); }
      let disp = price;
      let strike = price + (Math.random() * 900 + 700);
      let last = 0, raf = null;

      const dpr = () => window.devicePixelRatio || 1;
      const resize = () => { const r = dpr(); cv.width = cont.clientWidth * r; cv.height = cont.clientHeight * r; };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(cont);

      const draw = () => {
        if (!cv.width || !cv.height) return;
        const ctx = cv.getContext('2d');
        const r = dpr();
        const W = cv.width / r, H = cv.height / r;
        ctx.setTransform(r, 0, 0, r, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const pts = h.slice();
        if (pts.length < 2) return;
        pts[pts.length - 1] = disp;
        let min = Math.min(...pts, strike), max = Math.max(...pts, strike);
        const pd = (max - min) * 0.14 || 50;
        min -= pd; max += pd;
        const rng = max - min || 1;
        const padT = 18, padB = 16, axisR = 6;
        const plotW = W - axisR, plotH = H - padT - padB;
        const nowX = plotW * 0.7;
        const X = i => i / (pts.length - 1) * nowX;
        const Y = v => padT + (1 - (v - min) / rng) * plotH;
        const lime = '#d4f56b';

        const g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        g.addColorStop(0, 'rgba(212,245,107,0.16)');
        g.addColorStop(1, 'rgba(212,245,107,0)');
        ctx.beginPath();
        ctx.moveTo(0, Y(pts[0]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(X(i), Y(pts[i]));
        ctx.lineTo(X(pts.length - 1), padT + plotH);
        ctx.lineTo(0, padT + plotH);
        ctx.closePath();
        ctx.fillStyle = g; ctx.fill();

        ctx.beginPath();
        ctx.moveTo(0, Y(pts[0]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(X(i), Y(pts[i]));
        ctx.lineJoin = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = lime;
        ctx.shadowColor = 'rgba(212,245,107,0.4)'; ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        const expiryX = nowX + (plotW - nowX) * 0.62;
        ctx.fillStyle = 'rgba(255,140,90,0.05)';
        ctx.fillRect(nowX, padT - 4, expiryX - nowX, plotH + 4);
        ctx.strokeStyle = 'rgba(255,140,90,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(expiryX, padT - 4); ctx.lineTo(expiryX, padT + plotH); ctx.stroke();
        ctx.setLineDash([]);

        const sy = Y(strike);
        ctx.strokeStyle = lime; ctx.lineWidth = 1.3; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(plotW, sy); ctx.stroke();
        ctx.setLineDash([]);
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 520);
        ctx.strokeStyle = lime; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(expiryX, sy, 11, 0, 7); ctx.stroke();
        ctx.globalAlpha = 0.4 + pulse * 0.4;
        ctx.beginPath(); ctx.arc(expiryX, sy, 11 + pulse * 7, 0, 7); ctx.strokeStyle = 'rgba(212,245,107,0.5)'; ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(expiryX, sy, 3, 0, 7); ctx.fillStyle = lime; ctx.fill();
        ctx.beginPath(); ctx.moveTo(expiryX - 18, sy); ctx.lineTo(expiryX - 13, sy); ctx.moveTo(expiryX + 13, sy); ctx.lineTo(expiryX + 18, sy); ctx.strokeStyle = lime; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = lime;
        ctx.font = "600 10px 'Space Grotesk', sans-serif";
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('STRIKE $' + Math.round(strike).toLocaleString(), 4, sy - 7);

        const lx = X(pts.length - 1), ly = Y(disp);
        ctx.beginPath(); ctx.arc(lx, ly, 4 + pulse * 6, 0, 7);
        ctx.fillStyle = 'rgba(212,245,107,' + (0.18 * (1 - pulse)) + ')'; ctx.fill();
        ctx.beginPath(); ctx.arc(lx, ly, 4, 0, 7);
        ctx.fillStyle = lime; ctx.fill();
      };

      const loop = t => {
        if (t - last > 540) {
          last = t;
          price += (Math.random() - 0.484) * 34;
          h.push(price);
          if (h.length > 200) h.shift();
        }
        disp += (price - disp) * 0.1;
        if (btc) btc.textContent = '$' + Math.round(disp).toLocaleString();
        draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      cleanups.push(() => { cancelAnimationFrame(raf); ro.disconnect(); });
    }

    return () => cleanups.forEach(fn => fn());
  }, []);

  return (
    <div
      ref={rootRef}
      style={{ width: '100%', background: '#0a0a0b', color: '#f4f4ef' }}
      dangerouslySetInnerHTML={{ __html: MARKUP }}
    />
  );
}

export default LandingPage;

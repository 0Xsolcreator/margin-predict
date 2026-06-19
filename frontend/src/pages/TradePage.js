import { useCallback, useEffect, useState } from 'react';
import Header from '../components/trade/Header';
import PriceChart from '../components/trade/PriceChart';
import LadderPanel from '../components/trade/LadderPanel';
import RightPanel from '../components/trade/RightPanel';
import BetPanel from '../components/trade/BetPanel';
import PositionsPanel from '../components/trade/PositionsPanel';
import ArenaPanel from '../components/trade/ArenaPanel';
import AuthModal from '../components/auth/AuthModal';
import * as api from '../api';
import { usePythPrice } from '../hooks/usePythPrice';

const FP = 1e9;   // oracle prices / strikes are 1e9 fixed-point USD
const STRIKE_DP = 1e6; // POST /positions strike is 6dp Predict units
const SUI_DP = 1e9;

// Pyth BTC/USD feed — canonical across testnet and mainnet Hermes
const BTC_PYTH_FEED = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';

// Backend supports a narrow leverage band (11000–14000 bps = 1.10x–1.40x).
// Map the 1–50 UI slider onto it and always send a valid value.
// ponytail: linear map, the slider's notional/liq math stays cosmetic; tighten
// the slider range if the band ever changes.
const levToBps = lev => Math.round(11000 + ((Math.min(50, Math.max(1, lev)) - 1) / 49) * 3000);

const fmtCountdown = ms => {
  if (ms == null) return '—';
  if (ms <= 0) return 'SETTLED';
  const z = n => String(n).padStart(2, '0');
  return `${z(Math.floor(ms / 3600000))}:${z(Math.floor((ms % 3600000) / 60000))}:${z(Math.floor((ms % 60000) / 1000))}`;
};

const posMeta = id => { try { return JSON.parse(localStorage.getItem('mp_pos_' + id) || '{}'); } catch { return {}; } };
const setPosMeta = (id, m) => localStorage.setItem('mp_pos_' + id, JSON.stringify(m));

function TradePage() {
  const [address, setAddress] = useState(api.getAddress());
  const [authOpen, setAuthOpen] = useState(false);

  const [oracle, setOracle] = useState(null);       // { oracle, latest_price }
  const [balance, setBalance] = useState(0);
  const [positions, setPositions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const [selectedStrike, setSelectedStrike] = useState(null);
  const [dir, setDir] = useState('long');
  const [lev, setLev] = useState(10);
  const [amt, setAmt] = useState(50);
  const [tab, setTab] = useState('bet');

  const pythPrice = usePythPrice(BTC_PYTH_FEED);

  const oracleId = oracle?.oracle?.oracle_id;
  const oracleSpot = oracle ? Number(oracle.latest_price?.spot ?? oracle.oracle?.min_strike ?? 0) / FP : 0;
  // Prefer the live Pyth price; fall back to the last on-chain oracle value
  const spotUsd = pythPrice ?? oracleSpot;
  const tickUsd = oracle ? Number(oracle.oracle?.tick_size ?? FP) / FP : 1;
  const expiry = oracle ? Number(oracle.oracle?.expiry) : null;

  // public: pick the soonest active market, then load its price + params
  useEffect(() => {
    (async () => {
      try {
        const markets = await api.listOracles();
        if (markets[0]) setOracle(await api.getOracle(markets[0].oracle_id));
      } catch (e) { setError(e.message); }
    })();
  }, []);

  // authed: balance + positions, polled while signed in
  const refresh = useCallback(async () => {
    if (!api.getToken()) { setBalance(0); setPositions([]); return; }
    try {
      const [stats, list] = await Promise.all([api.getStats(), api.listPositions()]);
      setBalance(Number(stats.sui) / SUI_DP);
      setPositions(list.map(p => ({ ...p, ...posMeta(p.positionId) })));
    } catch (e) {
      setError(e.message);
      if (!api.getToken()) setAddress(''); // session expired -> cleared by api
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh, address]);
  useEffect(() => {
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [refresh]);

  // 1s tick drives the expiry countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const selectStrike = p => { setSelectedStrike(p); setTab('bet'); };

  const placeBet = async () => {
    if (!api.getToken()) return setAuthOpen(true);
    if (selectedStrike == null || !oracleId) return;
    setBusy(true); setError('');
    try {
      const res = await api.placeBet({
        oracleId,
        expiry,
        strike: Math.round(selectedStrike * STRIKE_DP),
        isUp: dir === 'long',
        collateralSui: amt,
        leverageBps: levToBps(lev),
      });
      if (res.positionId) setPosMeta(res.positionId, { dir, lev, strikeUsd: selectedStrike, entry: spotUsd });
      setSelectedStrike(null);
      await refresh();
      setTab('positions');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const closePosition = async id => {
    if (!oracleId) return;
    setBusy(true); setError('');
    try { await api.closePosition(id, oracleId); await refresh(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };

  const withdraw = async id => {
    setBusy(true); setError('');
    try { await api.withdrawPosition(id); await refresh(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };

  const onAuthed = useCallback(addr => { setAddress(addr); setAuthOpen(false); }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: '#0a0a0b', fontFamily: "'Space Grotesk',sans-serif", color: '#f4f4ef', overflow: 'hidden', userSelect: 'none' }}>
      <Header
        balance={balance}
        address={address}
        oracleCountdown={fmtCountdown(expiry ? expiry - now : null)}
        onLoginClick={() => setAuthOpen(true)}
      />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onAuthed={onAuthed} />

      {error && (
        <div onClick={() => setError('')} style={{ flexShrink: 0, padding: '8px 24px', background: 'rgba(242,120,92,0.12)', color: '#f2785c', fontSize: 12, cursor: 'pointer' }}>
          {error} — dismiss
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <PriceChart
          selectedStrike={selectedStrike}
          onSelectStrike={selectStrike}
          positions={positions}
          oracleExp={expiry}
          livePrice={pythPrice}
        />

        <LadderPanel
          currentPrice={spotUsd || 1}
          step={tickUsd || 1}
          selectedStrike={selectedStrike}
          onSelectStrike={selectStrike}
          loading={pythPrice == null}
        />

        <RightPanel tab={tab} onTab={setTab} posCount={positions.length}>
          {tab === 'bet' && (
            <BetPanel
              selectedStrike={selectedStrike}
              currentPrice={spotUsd || 1}
              balance={balance}
              dir={dir} lev={lev} amt={amt}
              busy={busy}
              onDir={setDir} onLev={setLev} onAmt={setAmt}
              onAmtPct={f => setAmt(+(balance * f).toFixed(2))}
              onClear={() => setSelectedStrike(null)}
              onPlaceBet={placeBet}
            />
          )}
          {tab === 'positions' && (
            <PositionsPanel positions={positions} busy={busy} onWithdraw={withdraw} onClose={closePosition} />
          )}
          {tab === 'arena' && (
            <ArenaPanel posCount={positions.length} userPnl={0} />
          )}
        </RightPanel>
      </div>
    </div>
  );
}

export default TradePage;

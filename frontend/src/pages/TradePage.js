import { useCallback, useEffect, useState } from 'react';
import { useOracleCycle } from '../hooks/useOracleCycle';
import { useOracleProbabilities } from '../hooks/useOracleProbabilities';
import Header from '../components/trade/Header';
import PriceChart from '../components/trade/PriceChart';
import LadderPanel from '../components/trade/LadderPanel';
import RightPanel from '../components/trade/RightPanel';
import BetPanel from '../components/trade/BetPanel';
import PositionsPanel from '../components/trade/PositionsPanel';
import ArenaPanel from '../components/trade/ArenaPanel';
import AuthModal from '../components/auth/AuthModal';
import RecoveryModal from '../components/trade/RecoveryModal';
import * as api from '../api';
import { usePythPrice } from '../hooks/usePythPrice';

const FP = 1e9;   // oracle prices / strikes are 1e9 fixed-point USD
const SUI_DP = 1e9;

// Snap a USD price to the oracle's strike grid and return the raw 1e9 fixed-point
// strike the contract expects. Off-grid strikes abort with FAILED_ASSERT_STRIKE_PRICE.
const snapStrikeFixed = (usd, minFixed, tickFixed) => {
  const idx = Math.round((Math.round(usd * FP) - minFixed) / tickFixed);
  return Math.round(minFixed + idx * tickFixed);
};

// Pyth BTC/USD feed — canonical across testnet and mainnet Hermes
const BTC_PYTH_FEED = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';

// SUI leverage runs 1.0x–1.4x on the slider; bps = lev × 10000, clamped to the
// backend's supported band (11000–14000) so we never send an invalid value.
const levToBps = lev => Math.round(Math.min(14000, Math.max(11000, lev * 10000)));

const fmtCountdown = ms => {
  if (ms == null || ms <= 0) return '--:--:--';
  const z = n => String(n).padStart(2, '0');
  return `${z(Math.floor(ms / 3600000))}:${z(Math.floor((ms % 3600000) / 60000))}:${z(Math.floor((ms % 60000) / 1000))}`;
};

const posMeta = id => { try { return JSON.parse(localStorage.getItem('mp_pos_' + id) || '{}'); } catch { return {}; } };
const setPosMeta = (id, m) => localStorage.setItem('mp_pos_' + id, JSON.stringify(m));

function TradePage() {
  const [address, setAddress] = useState(api.getAddress());
  const [authOpen, setAuthOpen] = useState(false);
  const [recoverable, setRecoverable] = useState({ positions: [], totalSui: 0 });
  const [recoverOpen, setRecoverOpen] = useState(false);

  const oracle = useOracleCycle();                   // { oracle, latest_price }
  const [balance, setBalance] = useState(0);
  const [positions, setPositions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const [selectedStrike, setSelectedStrike] = useState(null);
  const [dir, setDir] = useState('long');
  const [lev, setLev] = useState(1.2);
  const [amt, setAmt] = useState(50);
  const [tab, setTab] = useState('bet');

  const pythPrice = usePythPrice(BTC_PYTH_FEED);

  const oracleId = oracle?.oracle?.oracle_id;
  const oracleSpot = oracle ? Number(oracle.latest_price?.spot ?? oracle.oracle?.min_strike ?? 0) / FP : 0;
  // Prefer the live Pyth price; fall back to the last on-chain oracle value
  const spotUsd = pythPrice ?? oracleSpot;

  const { probMap, ready: probsReady } = useOracleProbabilities(oracleId, spotUsd);
  const minFixed = oracle ? Number(oracle.oracle?.min_strike ?? 0) : 0;
  const tickFixed = oracle ? Number(oracle.oracle?.tick_size ?? FP) : FP;
  const tickUsd = tickFixed / FP;
  const minUsd = minFixed / FP;
  const expiry = oracle ? Number(oracle.oracle?.expiry) : null;

  // authed: balance + positions, polled while signed in
  const refresh = useCallback(async () => {
    if (!api.getToken()) { setBalance(0); setPositions([]); setRecoverable({ positions: [], totalSui: 0 }); return; }
    try {
      const [stats, list, rec] = await Promise.all([api.getStats(), api.listPositions(), api.getRecoverable().catch(() => null)]);
      setBalance(Number(stats.sui) / SUI_DP);
      setPositions(list.map(p => ({ ...p, ...posMeta(p.positionId) })));
      if (rec) setRecoverable(rec);
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
        strike: snapStrikeFixed(selectedStrike, minFixed, tickFixed),
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
        recoverable={recoverable.totalSui}
        onRecoverClick={() => setRecoverOpen(true)}
        onLoginClick={() => setAuthOpen(true)}
      />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onAuthed={onAuthed} />
      <RecoveryModal open={recoverOpen} onClose={() => setRecoverOpen(false)} data={recoverable} onDone={refresh} />

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
          min={minUsd}
          step={tickUsd || 1}
          selectedStrike={selectedStrike}
          onSelectStrike={selectStrike}
          loading={pythPrice == null}
          probabilities={probMap}
          probsReady={probsReady}
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
            <PositionsPanel positions={positions} spot={spotUsd} busy={busy} onWithdraw={withdraw} onClose={closePosition} />
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

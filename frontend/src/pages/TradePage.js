import { useState } from 'react';
import Header from '../components/trade/Header';
import PriceChart from '../components/trade/PriceChart';
import LadderPanel from '../components/trade/LadderPanel';
import RightPanel from '../components/trade/RightPanel';
import BetPanel from '../components/trade/BetPanel';
import PositionsPanel from '../components/trade/PositionsPanel';
import ArenaPanel from '../components/trade/ArenaPanel';
import AuthModal from '../components/auth/AuthModal';

// ponytail: reference spot price for the ladder/bet math. The chart runs its own
// live sim; lifting that price up + real positions/balance come when we wire the
// keeper. Business actions (placeBet/withdraw/close) are stubs for now.
const SPOT = 105432;

function TradePage() {
  const [selectedStrike, setSelectedStrike] = useState(null);
  const [dir, setDir] = useState('long');
  const [lev, setLev] = useState(10);
  const [amt, setAmt] = useState(50);
  const [tab, setTab] = useState('bet');
  const [authOpen, setAuthOpen] = useState(false);

  const [balance] = useState(2500);
  const [positions] = useState([]); // populated once placeBet is wired
  const userPnl = positions.reduce((a, p) => a + p.pnl, 0);

  const selectStrike = p => { setSelectedStrike(p); setTab('bet'); };

  // TODO(wire): on-chain actions via keeper — left empty per spec.
  const placeBet = () => {};
  const withdraw = () => {};
  const closePosition = () => {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: '#0a0a0b', fontFamily: "'Space Grotesk',sans-serif", color: '#f4f4ef', overflow: 'hidden', userSelect: 'none' }}>
      <Header balance={balance} onLoginClick={() => setAuthOpen(true)} />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <PriceChart
          selectedStrike={selectedStrike}
          onSelectStrike={selectStrike}
          positions={positions}
        />

        <LadderPanel
          currentPrice={SPOT}
          selectedStrike={selectedStrike}
          onSelectStrike={selectStrike}
        />

        <RightPanel tab={tab} onTab={setTab} posCount={positions.length}>
          {tab === 'bet' && (
            <BetPanel
              selectedStrike={selectedStrike}
              currentPrice={SPOT}
              balance={balance}
              dir={dir} lev={lev} amt={amt}
              onDir={setDir} onLev={setLev} onAmt={setAmt}
              onAmtPct={f => setAmt(Math.floor(balance * f))}
              onClear={() => setSelectedStrike(null)}
              onPlaceBet={placeBet}
            />
          )}
          {tab === 'positions' && (
            <PositionsPanel positions={positions} onWithdraw={withdraw} onClose={closePosition} />
          )}
          {tab === 'arena' && (
            <ArenaPanel posCount={positions.length} userPnl={userPnl} />
          )}
        </RightPanel>
      </div>
    </div>
  );
}

export default TradePage;

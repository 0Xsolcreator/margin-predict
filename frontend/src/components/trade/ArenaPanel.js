import { C, FONT, FONT_PIXEL } from './theme';

const LEADERBOARD = [
  { rank: '01', medal: '🥇', name: 'APEX_BULL', trades: 234, win: '76%', pnl: '48,234', rankClr: '#d4f56b' },
  { rank: '02', medal: '🥈', name: 'PRICEWHALE', trades: 187, win: '71%', pnl: '31,820', rankClr: '#9a9a96' },
  { rank: '03', medal: '🥉', name: 'SUI_BEAST', trades: 156, win: '68%', pnl: '24,150', rankClr: '#cd7f4a' },
  { rank: '04', medal: '', name: 'NEON_SHORT', trades: 203, win: '64%', pnl: '18,900', rankClr: '#5a5a58' },
  { rank: '05', medal: '', name: 'CRYPTONAUT', trades: 98, win: '61%', pnl: '15,420', rankClr: '#5a5a58' },
  { rank: '06', medal: '', name: 'ORACLE_REX', trades: 145, win: '59%', pnl: '12,800', rankClr: '#5a5a58' },
  { rank: '07', medal: '', name: 'BULL_LASER', trades: 77, win: '58%', pnl: '9,340', rankClr: '#5a5a58' },
];

// Arena leaderboard + your rank. Static board for now.
function ArenaPanel({ posCount = 0, userPnl = 0 }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <div style={{ fontFamily: FONT_PIXEL, fontSize: 13, color: C.faint, letterSpacing: 1, marginBottom: 18 }}>Top traders</div>
      {LEADERBOARD.map(t => (
        <div key={t.rank} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div style={{ width: 18, fontFamily: FONT, fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: t.rankClr }}>{t.rank}</div>
          <div style={{ width: 18, textAlign: 'center', fontSize: 14 }}>{t.medal}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#e4e4df', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
            <div style={{ fontSize: 9, color: C.ghost, marginTop: 2 }}>{t.trades} trades · {t.win} win</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: C.lime }}>+{t.pnl}</div>
            <div style={{ fontSize: 8, color: '#3a3a3c', marginTop: 2 }}>SUI</div>
          </div>
        </div>
      ))}
      <div style={{ marginTop: 18, padding: 14, border: '1px solid rgba(212,245,107,0.18)', borderRadius: 12, background: 'rgba(212,245,107,0.04)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 18, fontFamily: FONT, fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: C.lime }}>47</div>
        <div style={{ width: 18, textAlign: 'center', fontSize: 14 }}>★</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.lime }}>You</div>
          <div style={{ fontSize: 9, color: C.fainter, marginTop: 2 }}>{posCount} open</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums', color: userPnl >= 0 ? C.lime : C.red }}>{(userPnl >= 0 ? '+' : '') + userPnl.toFixed(2)}</div>
          <div style={{ fontSize: 8, color: '#3a3a3c', marginTop: 2 }}>SUI</div>
        </div>
      </div>
    </div>
  );
}

export default ArenaPanel;

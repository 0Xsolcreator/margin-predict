import { C, FONT } from './theme';

const TABS = [
  { key: 'bet', label: 'Bet' },
  { key: 'positions', label: 'Positions' },
  { key: 'arena', label: 'Arena' },
];

// Right column: tab bar + a content slot. TradePage passes the active panel
// as children so this stays a dumb container.
function RightPanel({ tab = 'bet', onTab, posCount = 0, children }) {
  return (
    <div style={{ width: 372, flexShrink: 0, borderLeft: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, display: 'flex', gap: 24, padding: '0 22px', borderBottom: `1px solid ${C.line}` }}>
        {TABS.map(t => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onTab && onTab(t.key)}
              className={`tab${on ? ' tab-on' : ''}`}
              style={{ height: 50, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: C.fainter, letterSpacing: 1, position: 'relative' }}
            >
              {t.label}{t.key === 'positions' && <span style={{ color: C.ghost }}> {posCount}</span>}
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: on ? C.lime : 'transparent', borderRadius: 2 }} />
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}

export default RightPanel;

import LandingPage from './pages/LandingPage';
import TradePage from './pages/TradePage';
import LiquidatePage from './pages/LiquidatePage';

const desktopGateStyle = `
  .dg-page   { display: block; }
  .dg-wall   { display: none; }
  @media (max-width: 1024px) {
    .dg-page { display: none; }
    .dg-wall {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #0a0a0b;
      color: #f4f4ef;
      text-align: center;
      padding: 32px 24px;
      font-family: 'Space Grotesk', sans-serif;
      gap: 20px;
    }
    .dg-logo {
      width: 52px; height: 52px;
      border-radius: 13px;
      background: #d4f56b;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 4px;
    }
    .dg-logo span {
      font-family: 'Doto', monospace;
      font-weight: 900; font-size: 32px;
      color: #0a0a0b; line-height: 1; letter-spacing: -.04em;
    }
    .dg-title {
      font-size: 22px; font-weight: 700;
      letter-spacing: -.4px; line-height: 1.2;
    }
    .dg-sub {
      font-size: 14px; color: #6a6a66; line-height: 1.6; max-width: 280px;
    }
    .dg-pill {
      display: inline-flex; align-items: center; gap: 8px;
      height: 46px; padding: 0 24px;
      background: #d4f56b; border-radius: 999px;
      font-weight: 700; font-size: 13px;
      color: #0a0a0b; letter-spacing: .5px;
      text-decoration: none; margin-top: 4px;
    }
  }
`;

function DesktopGate({ children }) {
  return (
    <>
      <style>{desktopGateStyle}</style>
      <div className="dg-page">{children}</div>
      <div className="dg-wall">
        <div className="dg-logo"><span>S</span></div>
        <div className="dg-title">Open on a larger screen</div>
        <div className="dg-sub">
          The Strike terminal is built for desktop. Grab your laptop for the full experience.
        </div>
        <a href="/" className="dg-pill">← Back to home</a>
      </div>
    </>
  );
}

// ponytail: path-based switch, no router dep. Auth is a modal in the page
// header now, so no /login or /signup routes.
function App() {
  const path = window.location.pathname;
  if (path.startsWith('/liquidate')) return <DesktopGate><LiquidatePage /></DesktopGate>;
  if (path.startsWith('/app')) return <DesktopGate><TradePage /></DesktopGate>;
  return <LandingPage />;
}

export default App;

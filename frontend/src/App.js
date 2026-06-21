import LandingPage from './pages/LandingPage';
import TradePage from './pages/TradePage';
import LiquidatePage from './pages/LiquidatePage';

// ponytail: path-based switch, no router dep. Auth is a modal in the page
// header now, so no /login or /signup routes.
function App() {
  const path = window.location.pathname;
  if (path.startsWith('/liquidate')) return <LiquidatePage />;
  if (path.startsWith('/app')) return <TradePage />;
  return <LandingPage />;
}

export default App;

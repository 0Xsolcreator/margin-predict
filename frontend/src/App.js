import LandingPage from './pages/LandingPage';
import TradePage from './pages/TradePage';

// ponytail: path-based switch, no router dep. Auth is a modal in the trade
// header now, so no /login or /signup routes.
function App() {
  return window.location.pathname.startsWith('/app') ? <TradePage /> : <LandingPage />;
}

export default App;

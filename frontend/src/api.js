// Single client for the server-custodial backend (see backend/README.md).
// Auth is a Google-nonce handshake: /auth/start -> Google id_token bound to the
// nonce -> /auth/finish -> { sessionToken, address }. Every ✓ route then takes
// Authorization: Bearer <sessionToken>.

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000';

export const getToken = () => localStorage.getItem('mp_token') || '';
export const getAddress = () => localStorage.getItem('mp_address') || '';
const setSession = (token, address) => {
  localStorage.setItem('mp_token', token);
  localStorage.setItem('mp_address', address);
};
export const clearSession = () => {
  localStorage.removeItem('mp_token');
  localStorage.removeItem('mp_address');
};

async function req(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers['Authorization'] = `Bearer ${getToken()}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) clearSession();
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }
  return data;
}

// --- auth ---
export const authStart = () => req('/auth/start', { method: 'POST' });
export async function authFinish(state, jwt) {
  const { sessionToken, address } = await req('/auth/finish', { method: 'POST', body: { state, jwt } });
  setSession(sessionToken, address);
  return { sessionToken, address };
}

// --- data ---
export const getStats = () => req('/stats', { auth: true });
export const getOracleProbabilities = (oracleId, strikes) =>
  req(`/oracles/${oracleId}/probabilities?strikes=${strikes.join(',')}`);
export const listOracles = (all = false) => req(`/oracles${all ? '?all=1' : ''}`);
export const getOracle = (id) => req(`/oracles/${id}`);
export const listPositions = () => req('/positions', { auth: true });
export const getPosition = (id, oracleId) =>
  req(`/positions/${id}${oracleId ? `?oracleId=${oracleId}` : ''}`, { auth: true });
export const placeBet = (body) => req('/positions', { method: 'POST', body, auth: true });
export const closePosition = (id, oracleId) =>
  req(`/positions/${id}/close`, { method: 'POST', body: { oracleId }, auth: true });
export const withdrawPosition = (id) =>
  req(`/positions/${id}/withdraw`, { method: 'POST', auth: true });

// --- recovery (claw back escrow from stuck pending-open positions) ---
export const getRecoverable = () => req('/recover', { auth: true });
export const runRecover = () => req('/recover', { method: 'POST', auth: true });

import { useCallback, useEffect, useState } from 'react';
import { listOracles, getOracle } from '../api';

const EMPTY_RETRY_MS = 30_000;

// Cycles through active oracles sorted by nearest expiry.
// When the current oracle expires it advances to the next one.
// When the queue runs out it re-fetches the list and starts again.
export function useOracleCycle() {
  // null = initial load not done yet; [] = loaded but empty
  const [queue, setQueue] = useState(null);
  const [oracle, setOracle] = useState(null);

  const reload = useCallback(async () => {
    try {
      const list = await listOracles(); // already filtered active + sorted by expiry asc
      setQueue(list);
    } catch {
      setQueue([]);
    }
  }, []);

  // Kick off the initial load
  useEffect(() => { reload(); }, [reload]);

  // When the queue changes: load full detail for the first entry,
  // or schedule a retry if nothing is active yet.
  useEffect(() => {
    if (queue === null) return;
    if (!queue.length) {
      const t = setTimeout(reload, EMPTY_RETRY_MS);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    getOracle(queue[0].oracle_id)
      .then(d => { if (!cancelled) setOracle(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [queue, reload]);

  // When the current oracle detail is loaded, arm a timeout to advance
  // the queue exactly when it expires.
  useEffect(() => {
    const expiry = oracle?.oracle?.expiry ? Number(oracle.oracle.expiry) : null;
    if (!expiry) return;
    const advance = () => setQueue(prev => prev?.slice(1) ?? []);
    const remaining = expiry - Date.now();
    if (remaining <= 0) { advance(); return; }
    const t = setTimeout(advance, remaining);
    return () => clearTimeout(t);
  }, [oracle]);

  return oracle;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { getOracleProbabilities } from '../api';

const POLL_MS  = 8_000;
const MIN_PROB = 0.05;

export function useOracleProbabilities(oracleId, spotUsd) {
  const [probMap, setProbMap] = useState({});
  const [ready, setReady]     = useState(false);
  const spotRef = useRef(spotUsd);
  spotRef.current = spotUsd;

  const doFetch = useCallback(async () => {
    if (!oracleId || !spotRef.current) return;
    try {
      const { probabilities } = await getOracleProbabilities(oracleId, spotRef.current);

      // Merge into the existing map so strides outside the new window keep
      // their last known probability instead of dropping to zero.
      // Strides that came back but fell below threshold are removed.
      setProbMap(prev => {
        const next = { ...prev };
        for (const { strike, up, down } of probabilities) {
          if (up !== null && up >= MIN_PROB) {
            next[strike] = { up, down };
          } else if (up !== null) {
            // Real value came back but below threshold — clear it
            delete next[strike];
          }
          // up === null means AMM couldn't quote — keep the last known value
        }
        return next;
      });

      setReady(true);
    } catch { /* keep last known map on network hiccup */ }
  }, [oracleId]);

  useEffect(() => {
    // Clear stale data from the previous oracle before starting a new cycle
    setProbMap({});
    setReady(false);
    doFetch();
    const t = setInterval(doFetch, POLL_MS);
    return () => clearInterval(t);
  }, [doFetch]);

  return { probMap, ready };
}

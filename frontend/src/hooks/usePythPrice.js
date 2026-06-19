import { useEffect, useRef, useState } from 'react';

const HERMES = 'https://hermes.pyth.network';
const SSE_TIMEOUT_MS = 2000; // fall back to polling if SSE delivers nothing in 2s

function parseFeed(feed) {
  if (!feed?.price) return null;
  const v = Number(feed.price.price) * 10 ** Number(feed.price.expo);
  return v > 0 ? v : null;
}

async function fetchLatest(feedId) {
  const res = await fetch(
    `${HERMES}/v2/updates/price/latest?ids[]=${feedId}&parsed=true`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  return parseFeed(data?.parsed?.[0]);
}

export function usePythPrice(feedId) {
  const [price, setPrice] = useState(null);
  const activeRef = useRef(true);

  useEffect(() => {
    if (!feedId) return;
    activeRef.current = true;
    let pollTimer = null;

    // --- SSE (primary, ~400 ms cadence) ---
    const es = new EventSource(
      `${HERMES}/v2/updates/price/stream?ids[]=${feedId}&parsed=true`,
    );

    es.addEventListener('price_update', (e) => {
      if (!activeRef.current) return;
      try {
        const v = parseFeed(JSON.parse(e.data)?.parsed?.[0]);
        if (v != null) setPrice(v);
      } catch {}
    });

    // --- polling fallback (kicks in if SSE delivers nothing within SSE_TIMEOUT_MS) ---
    const sseTimeout = setTimeout(() => {
      if (!activeRef.current) return;
      const poll = async () => {
        if (!activeRef.current) return;
        try {
          const v = await fetchLatest(feedId);
          if (v != null && activeRef.current) setPrice(v);
        } catch {}
      };
      poll();
      pollTimer = setInterval(poll, 1000);
    }, SSE_TIMEOUT_MS);

    return () => {
      activeRef.current = false;
      es.close();
      clearTimeout(sseTimeout);
      clearInterval(pollTimer);
    };
  }, [feedId]);

  return price;
}

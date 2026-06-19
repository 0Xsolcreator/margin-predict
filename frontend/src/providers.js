import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuiClientProvider, WalletProvider, useSuiClientContext } from '@mysten/dapp-kit';
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { registerEnokiWallets, isEnokiNetwork } from '@mysten/enoki';
import '@mysten/dapp-kit/dist/index.css';

const queryClient = new QueryClient();
const networks = { testnet: { url: getJsonRpcFullnodeUrl('testnet') } };

const ENOKI_API_KEY = process.env.REACT_APP_ENOKI_API_KEY;
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

// Registers Google (zkLogin) as a wallet inside dapp-kit. No-op if keys are
// missing, so browser-wallet connect still works without Enoki configured.
function RegisterEnokiWallets() {
  const { client, network } = useSuiClientContext();
  useEffect(() => {
    if (!ENOKI_API_KEY || !GOOGLE_CLIENT_ID || !isEnokiNetwork(network)) return;
    const { unregister } = registerEnokiWallets({
      apiKey: ENOKI_API_KEY,
      providers: { google: { clientId: GOOGLE_CLIENT_ID } },
      client,
      network,
    });
    return unregister;
  }, [client, network]);
  return null;
}

export default function Providers({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork="testnet">
        <RegisterEnokiWallets />
        <WalletProvider autoConnect>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}

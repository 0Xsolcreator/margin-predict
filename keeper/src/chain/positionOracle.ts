/// Reads the oracle a position actually trades against, straight from its
/// on-chain market key. This is the authoritative source: oracles rotate every
/// expiry, so the *active* oracle is usually not the one a position was opened
/// on, and passing the wrong one aborts in oracle_config::assert_key_matches.
///
/// Uses JSON-RPC (object content exposes the market_key fields directly, no BCS
/// decoding) rather than the gRPC client used elsewhere.

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { NETWORK, RPC_URLS } from '../config.js';

let client: SuiJsonRpcClient | null = null;
const rpc = (): SuiJsonRpcClient =>
  (client ??= new SuiJsonRpcClient({
    url: process.env.SUI_JSON_RPC_URL?.trim() || RPC_URLS[NETWORK],
    network: NETWORK,
  }));

/** Oracle id from the OPEN position's snapshot market key, or null if not found. */
export async function readPositionOracleId(positionId: string): Promise<string | null> {
  const obj = await rpc().getObject({ id: positionId, options: { showContent: true } });
  const content = obj.data?.content as { fields?: Record<string, any> } | undefined;
  const oracleId = content?.fields?.position?.fields?.market_key?.fields?.oracle_id;
  return typeof oracleId === 'string' ? oracleId : null;
}

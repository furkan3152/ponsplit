import "server-only";
import { getAddress, isAddress, zeroAddress } from "viem";
import { launcherAbi, ponsTokenAbi } from "./abi";
import { NETWORKS, isHidden, isLive, otherNetwork, type Network, type NetworkId } from "./networks";
import { toCoin } from "./pons";
import { serverClient } from "./server-network";
import type { Coin } from "./types";

export type ServerCoin = { network: Network; coin: Coin; description: string };

async function readCoin(n: Network, token: `0x${string}`): Promise<ServerCoin | null> {
  if (!isLive(n) || isHidden(n, token)) return null;
  const c = serverClient(n);
  const v = await c.readContract({ address: n.launcher!, abi: launcherAbi, functionName: "getLaunch", args: [token] });
  if (v.launch.token === zeroAddress) return null;
  const description = await c.readContract({ address: token, abi: ponsTokenAbi, functionName: "description" }).catch(() => "");
  return { network: n, coin: toCoin(v), description };
}

/**
 * A coin for server-side metadata and share images: looked up on `prefer` first, then on the other
 * network (a shared link may reach someone browsing the other one). Null when it isn't a listed
 * SplitEarn coin on either, or the chain can't be read right now.
 */
export async function fetchCoin(address: string, prefer: NetworkId): Promise<ServerCoin | null> {
  if (!isAddress(address)) return null;
  const token = getAddress(address);
  for (const id of [prefer, otherNetwork(prefer)]) {
    try {
      const found = await readCoin(NETWORKS[id], token);
      if (found) return found;
    } catch {
      // unreachable RPC: try the other network, else report nothing
    }
  }
  return null;
}

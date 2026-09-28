"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

export type ServerConfig = {
  uploads: boolean;
  xLogin: boolean;
  /** The address the server signs launches and claims as; null until SIGNER_PRIVATE_KEY is set. */
  signer: Address | null;
  /** SIGNER_PRIVATE_KEY is set but isn't a usable key. */
  keyProblem: string | null;
  resolver: string;
};

export function useServerConfig() {
  return useQuery({
    queryKey: ["server-config"],
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error(`Config unavailable (${res.status})`);
      return (await res.json()) as ServerConfig;
    },
  }).data;
}

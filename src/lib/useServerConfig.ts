"use client";

import { useQuery } from "@tanstack/react-query";

export type ServerConfig = { uploads: boolean; xLogin: boolean; devLogin: boolean; signer: boolean; resolver: string };

export function useServerConfig() {
  return useQuery({
    queryKey: ["server-config"],
    staleTime: Infinity,
    queryFn: async () => (await (await fetch("/api/config")).json()) as ServerConfig,
  }).data;
}

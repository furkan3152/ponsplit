"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

/** Whether this browser is signed in as the site's admin (see src/lib/admin.ts). */
export function useAdminSession() {
  return useQuery({
    queryKey: ["admin-session"],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch("/api/admin/session");
      if (!res.ok) return { admin: false, address: null as Address | null, configured: false };
      return (await res.json()) as { admin: boolean; address: Address | null; configured: boolean };
    },
  }).data;
}

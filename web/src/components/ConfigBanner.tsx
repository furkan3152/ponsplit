import { isConfigured } from "@/lib/config";

export function ConfigBanner() {
  if (isConfigured) return null;
  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-200">
      Contracts are not configured. Set <code className="font-mono">NEXT_PUBLIC_LAUNCHPAD_ADDRESS</code> and{" "}
      <code className="font-mono">NEXT_PUBLIC_FEE_VAULT_ADDRESS</code> in <code className="font-mono">web/.env.local</code>.
    </div>
  );
}

import { isConfigured } from "@/lib/config";

export function ConfigBanner() {
  if (isConfigured) return null;
  return (
    <div className="border-b border-line bg-sun px-4 py-2 text-center text-[13px] font-medium text-[#1d1d1f]">
      Contracts are not configured. Set <code className="font-mono">NEXT_PUBLIC_LAUNCHPAD_ADDRESS</code> and{" "}
      <code className="font-mono">NEXT_PUBLIC_FEE_VAULT_ADDRESS</code>.
    </div>
  );
}

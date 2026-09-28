"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { LogoMark } from "@/components/art";
import { errorMessage, shortAddress } from "@/lib/format";
import { KeyGenerator } from "./SetupClient";

/**
 * The sign-in screen in front of /setup. The owner connects their wallet and signs a one-time
 * message; nothing is sent on-chain. Before the site has a signing key there is nothing to sign
 * in with, so step 1 (making that key in this browser) is shown on its own.
 */
export function AdminGate({ hasKey, configured }: { hasKey: boolean; configured: boolean }) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function signIn() {
    if (!address) return;
    setBusy(true);
    setErr(null);
    try {
      const post = async (body: unknown) => {
        const res = await fetch("/api/admin/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        if (!res.ok) throw new Error(json.error || `Sign-in failed (${res.status}).`);
        return json;
      };
      const { message } = await post({ address });
      const signature = await signMessageAsync({ message: message! });
      await post({ message, signature });
      window.location.reload();
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5 pt-10 text-center">
      <LogoMark size={64} className="mx-auto" />
      <div>
        <div className="eyebrow">Owner only</div>
        <h1 className="display mt-2 text-[34px] leading-none">Admin sign-in</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
          Setup and the owner&apos;s switches are only for the wallet that runs this site. Connect it and sign a message: that proves the wallet is yours and
          costs nothing.
        </p>
      </div>

      {!hasKey ? (
        <div className="card space-y-3 p-5 text-left">
          <p className="text-[14px] text-ink-2">The site has no signing key yet. Make one here and add it to the host first; then sign in.</p>
          <KeyGenerator onChange={() => {}} />
        </div>
      ) : !configured ? (
        <p className="card p-5 text-left text-[14px] leading-relaxed text-ink-2">
          No admin wallet is set yet. On the host (Vercel → Settings → Environment Variables), add <span className="num text-ink">ADMIN_ADDRESSES</span> with your
          wallet&apos;s address, redeploy, and come back.
        </p>
      ) : !isConnected || !address ? (
        <button className="btn-neon w-full py-3.5" onClick={openConnectModal}>
          Connect wallet
        </button>
      ) : (
        <div className="space-y-2">
          <button className="btn-neon w-full py-3.5" disabled={busy} onClick={signIn}>
            {busy ? "Check your wallet…" : `Sign in as ${shortAddress(address)}`}
          </button>
          <p className="text-[12px] text-ink-3">Wrong wallet? Switch accounts in your wallet app.</p>
        </div>
      )}
      {err ? (
        <p role="alert" className="text-[13px] text-down-ink">
          {err}
        </p>
      ) : null}
    </div>
  );
}

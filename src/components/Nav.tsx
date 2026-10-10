"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useRef, useState } from "react";
import { formatSol, shortAddress } from "@/lib/format";
import { useSolBalance } from "@/lib/hooks";
import { Wordmark } from "./art/Logo";
import { SearchBox } from "./SearchBox";

/**
 * The top bar: search in the middle, the wallet and the Launch button on the right. On phones it
 * carries the logo (the sidebar is desktop only; the tab bar takes over).
 */
export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-[var(--glass)] backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] max-w-[1240px] items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <Link href="/" className="shrink-0 lg:hidden" aria-label="Tiksplit home">
          <Wordmark size={25} textClassName="text-[24px]" />
        </Link>
        <SearchBox className="hidden flex-1 md:block lg:max-w-[460px]" />
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <SearchBox className="md:hidden" compact />
          <span className="network-pill mr-1 hidden xl:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-lime" aria-hidden />Mainnet</span>
          <WalletButton />
          <Link href="/create" className="btn-primary hidden shrink-0 px-5 py-2 text-[14px] md:inline-flex">
            Launch coin
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Connect (any Solana wallet), then the address and SOL balance with a small menu. */
export function WalletButton() {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const balance = useSolBalance();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!mounted) return <div className="h-9 w-20 sm:w-28" aria-hidden />;
  if (!connected || !publicKey) {
    return (
      <button className="btn-secondary shrink-0 px-3 py-2 text-[12px] sm:px-4" onClick={() => setVisible(true)} disabled={connecting}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }
  const address = publicKey.toBase58();
  return (
    <div ref={box} className="relative">
      <button className="btn-secondary min-w-0 gap-2 px-3 py-2 text-[12px]" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {wallet?.adapter.icon ? <img src={wallet.adapter.icon} alt="" width={16} height={16} className="h-4 w-4 shrink-0 rounded" /> : <span className="h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-lime" aria-hidden />}
        <span className="num truncate">{shortAddress(address)}</span>
        {balance.data !== undefined ? <span className="hidden text-ink-2 lg:inline">{formatSol(balance.data, 3)} SOL</span> : null}
      </button>
      {open ? (
        <div className="card absolute right-0 top-[calc(100%+8px)] z-40 w-60 p-2 text-[13px] shadow-xl">
          <div className="px-2.5 pb-2 pt-1.5">
            <div className="eyebrow">Wallet</div>
            <div className="num mt-1 break-all text-[12px] text-ink-2">{address}</div>
            {balance.data !== undefined ? <div className="num mt-1 text-ink">{formatSol(balance.data, 4)} SOL</div> : null}
          </div>
          <button className="w-full rounded-xl px-2.5 py-2 text-left hover:bg-card-2" onClick={() => void navigator.clipboard?.writeText(address).then(() => setOpen(false))}>
            Copy address
          </button>
          <Link href="/me" className="block w-full rounded-xl px-2.5 py-2 text-left hover:bg-card-2" onClick={() => setOpen(false)}>
            My coins
          </Link>
          <button className="w-full rounded-xl px-2.5 py-2 text-left text-down-ink hover:bg-card-2" onClick={() => void disconnect().then(() => setOpen(false))}>
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}

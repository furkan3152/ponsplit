import Link from "next/link";
import { activeChain } from "@/lib/chains";
import { FAUCET_URL } from "@/lib/config";
import { LogoMark } from "./art";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-[13px] text-ink-2 sm:flex-row sm:items-center sm:px-6">
        <div className="flex items-center gap-2">
          <LogoMark size={20} />
          <span>PonSplit on {activeChain.name}</span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-auto">
          <Link href="/how" className="hover:text-ink">
            How it works
          </Link>
          {activeChain.testnet ? (
            <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="hover:text-ink">
              Testnet faucet ↗
            </a>
          ) : null}
          <a href={activeChain.blockExplorers.default.url} target="_blank" rel="noreferrer" className="hover:text-ink">
            Explorer ↗
          </a>
        </div>
        <p className="text-ink-3 sm:basis-full">
          Experimental software on a {activeChain.testnet ? "test network; tokens have no value" : "live network; trade at your own risk"}.
        </p>
      </div>
    </footer>
  );
}

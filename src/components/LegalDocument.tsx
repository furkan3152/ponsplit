import Link from "next/link";
import type { ReactNode } from "react";

export function LegalDocument({ title, children }: { title: string; children: ReactNode }) {
  return <article className="mx-auto max-w-3xl py-5 sm:py-10"><span className="edition-label">Tiksplit / Updated 10 October 2026</span><h1 className="editorial mt-4 text-5xl uppercase sm:text-7xl">{title}</h1><div className="mt-8 space-y-7 text-[14px] leading-7 text-ink-2 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_a]:underline">{children}</div><div className="mt-10 border-t border-line pt-5"><Link href="/" className="text-sm text-ink-2 hover:text-ink">Back to Tiksplit</Link></div></article>;
}

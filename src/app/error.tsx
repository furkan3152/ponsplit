"use client";

import Link from "next/link";
import { NotFoundArt } from "@/components/art";
import { Reveal } from "@/components/motion";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="relative mx-auto flex max-w-2xl flex-col items-center pb-6 pt-2 text-center sm:pt-8">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-x-0 -top-10 -z-10 h-[520px]" />
      <div aria-hidden className="relative grid w-full select-none place-items-center">
        <span
          className="display pointer-events-none bg-clip-text text-[36vw] leading-[0.85] tracking-normal text-transparent sm:text-[240px]"
          style={{ backgroundImage: "linear-gradient(to bottom, var(--line-2) 15%, transparent 95%)" }}
        >
          oops
        </span>
        <div className="absolute left-1/2 top-1/2 -z-10 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-down opacity-[0.12] blur-3xl" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <NotFoundArt className="h-40 w-[13.5rem] animate-float sm:h-52 sm:w-[17.5rem]" />
        </div>
      </div>
      <Reveal className="mt-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-down" aria-hidden />
          Unexpected error
        </span>
      </Reveal>
      <Reveal as="h1" delay={60} className="display mt-5 max-w-xl text-[44px] leading-[0.92] sm:text-[64px]">
        Something split the wrong way
      </Reveal>
      <Reveal delay={120}>
        <p className="mx-auto mt-4 max-w-md text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">
          The page hit an error. Your funds are safe on-chain; try again in a moment.
        </p>
      </Reveal>
      <Reveal delay={180} className="mt-8 flex flex-wrap justify-center gap-3">
        <button className="btn-neon group/cta px-6 py-3 text-[15px]" onClick={reset}>
          <span aria-hidden className="inline-block transition-transform duration-500 group-hover/cta:-rotate-180">
            ↻
          </span>
          Try again
        </button>
        <Link href="/" className="btn-secondary px-6 py-3 text-[15px]">
          Back home
        </Link>
      </Reveal>
      {error.digest ? <p className="mt-8 font-mono text-[11px] text-ink-3">Error ref · {error.digest}</p> : null}
    </div>
  );
}

"use client";

import { NotFoundArt } from "@/components/art";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-16 text-center">
      <NotFoundArt className="h-44 w-60" />
      <h1 className="font-display text-[32px] font-bold tracking-tight">Something split the wrong way</h1>
      <p className="text-[15px] text-ink-2">The page hit an error. Your funds are safe on-chain; try again in a moment.</p>
      <button className="btn-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}

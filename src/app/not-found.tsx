import Link from "next/link";
import { NotFoundArt } from "@/components/art";
import { Reveal } from "@/components/motion";

export default function NotFound() {
  return (
    <div className="relative mx-auto flex max-w-2xl flex-col items-center pb-6 pt-2 text-center sm:pt-8">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-x-0 -top-10 -z-10 h-[520px]" />
      <div aria-hidden className="relative grid w-full select-none place-items-center">
        <span
          className="display pointer-events-none bg-clip-text text-[42vw] leading-[0.8] tracking-normal text-transparent sm:text-[280px]"
          style={{ backgroundImage: "linear-gradient(to bottom, var(--line-2) 15%, transparent 95%)" }}
        >
          404
        </span>
        <div className="absolute left-1/2 top-1/2 -z-10 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lime opacity-[0.14] blur-3xl" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <NotFoundArt className="h-40 w-[13.5rem] animate-float sm:h-52 sm:w-[17.5rem]" />
        </div>
      </div>
      <Reveal className="mt-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
          <span className="h-1.5 w-1.5 rounded-full bg-sun" aria-hidden />
          Error 404 · page not found
        </span>
      </Reveal>
      <Reveal as="h1" delay={60} className="display mt-5 text-[48px] leading-[0.92] sm:text-[72px]">
        Lost the <span className="accent text-neon pr-1.5">map</span>
      </Reveal>
      <Reveal delay={120}>
        <p className="mt-4 text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">This page doesn&apos;t exist. Maybe it split.</p>
      </Reveal>
      <Reveal delay={180} className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-neon group/cta px-6 py-3 text-[15px]">
          <span aria-hidden className="transition-transform duration-300 group-hover/cta:-translate-x-1">
            ←
          </span>
          Back home
        </Link>
        <Link href="/how" className="btn-secondary px-6 py-3 text-[15px]">
          How it works
        </Link>
      </Reveal>
    </div>
  );
}

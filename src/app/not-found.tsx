import Link from "next/link";
import { NotFoundArt } from "@/components/art";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-16 text-center">
      <NotFoundArt className="h-44 w-60" />
      <h1 className="font-display text-[32px] font-bold tracking-tight">Lost the map</h1>
      <p className="text-[15px] text-ink-2">This page doesn&apos;t exist. Maybe it split.</p>
      <Link href="/" className="btn-primary">
        Back home
      </Link>
    </div>
  );
}

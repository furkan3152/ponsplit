import { EmptyArt } from "./art";

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card relative flex flex-col items-center gap-3 overflow-hidden px-6 py-14 text-center">
      <div aria-hidden className="bg-grid absolute inset-0 -z-10" />
      <EmptyArt className="h-24 w-32 animate-float" />
      <div className="display text-[24px] leading-tight">{title}</div>
      {children ? <div className="text-[14px] text-ink-2">{children}</div> : null}
    </div>
  );
}

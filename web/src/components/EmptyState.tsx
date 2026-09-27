import { EmptyArt } from "./art";

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <EmptyArt className="h-24 w-32" />
      <div className="text-[17px] font-semibold">{title}</div>
      {children ? <div className="text-[14px] text-ink-2">{children}</div> : null}
    </div>
  );
}

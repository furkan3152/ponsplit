/** Shares of the creator fee, never shares of a trade's full value. */
export function creatorFeeSplit(platformBps: number, launcherBps: number) {
  if (!Number.isInteger(platformBps) || platformBps <= 0 || platformBps > 5000) throw new Error("Platform share must be from 1 to 5000 basis points.");
  if (!Number.isInteger(launcherBps) || launcherBps < 0 || launcherBps > 1000) throw new Error("Launcher reward must be between 0% and 10%.");
  return { platformBps, launcherBps, creatorBps: 10_000 - platformBps - launcherBps };
}

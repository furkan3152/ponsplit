import { CreatorAvatar, CreatorAvatarStack } from "./CreatorAvatar";

/** Compatibility export for older imports; new UI uses CreatorAvatar. */
export function GithubAvatar({ handle, login, id, size, className }: { handle?: string; login?: string; id?: string; size?: number; className?: string }) {
  return <CreatorAvatar handle={handle ?? login ?? id} size={size} className={className} />;
}

export const GithubAvatarStack = CreatorAvatarStack;

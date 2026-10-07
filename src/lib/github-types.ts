/** A GitHub account as Splitdev shows it. `id` is GitHub's permanent numeric id: pump.fun's fee account is keyed by it. */
export type GithubProfile = { id: string; login: string; name: string; avatar: string; type: "User" | "Organization" };

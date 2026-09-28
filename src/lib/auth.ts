import { createHash } from "crypto";
import type { NextAuthOptions } from "next-auth";
import { adminKey } from "./adminKey";
import CredentialsProvider from "next-auth/providers/credentials";
import TwitterProvider from "next-auth/providers/twitter";
import { isValidHandle, normalizeHandle } from "./handles";
import { mockXId, resolverMode } from "./x";

declare module "next-auth" {
  interface Session {
    x?: { id: string; username: string; name?: string; image?: string };
  }
}

/** Local-only login that fakes an X account. Never enabled unless the mock resolver is on. */
export const devLoginEnabled = process.env.ENABLE_DEV_LOGIN === "true" && resolverMode() === "mock";

// Falls back to a secret derived from the signer key so deployments need one less variable.
const secret =
  process.env.NEXTAUTH_SECRET ||
  (adminKey() ? createHash("sha256").update(`ponsplit-nextauth:${adminKey()}`).digest("hex") : undefined);

// OAuth callbacks need the site's public URL. Without NEXTAUTH_URL it falls back to the host's
// production URL: Vercel's production domain (a custom domain once one is added) or Render's
// onrender.com URL. Register <that URL>/api/auth/callback/twitter in the X app; set
// NEXTAUTH_URL=https://<your-domain> explicitly if the site is reached some other way, otherwise X
// redirects users to a host where their sign-in cookies don't exist.
if (!process.env.NEXTAUTH_URL) {
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    process.env.NEXTAUTH_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  } else if (process.env.RENDER_EXTERNAL_URL) {
    process.env.NEXTAUTH_URL = process.env.RENDER_EXTERNAL_URL;
  }
}

export const authOptions: NextAuthOptions = {
  secret,
  providers: [
    TwitterProvider({
      clientId: process.env.TWITTER_CLIENT_ID ?? "",
      clientSecret: process.env.TWITTER_CLIENT_SECRET ?? "",
      version: "2.0",
    }),
    ...(devLoginEnabled
      ? [
          CredentialsProvider({
            id: "dev",
            name: "Dev X account",
            credentials: { username: { label: "X username", type: "text" } },
            async authorize(credentials) {
              const username = normalizeHandle(credentials?.username ?? "");
              if (!isValidHandle(username)) return null;
              return { id: mockXId(username).toString(), name: username };
            },
          }),
        ]
      : []),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 },
  callbacks: {
    async jwt({ token, profile, account, user }) {
      if (account?.provider === "twitter" && profile) {
        // OAuth 2.0 profile shape: { data: { id, name, username, profile_image_url } }
        const d = (profile as { data?: { id?: string; username?: string; name?: string; profile_image_url?: string } }).data;
        if (d?.id && d.username) {
          token.x = { id: d.id, username: d.username.toLowerCase(), name: d.name, image: d.profile_image_url };
        }
      } else if (account?.provider === "dev" && user) {
        token.x = { id: user.id, username: user.name ?? "", name: user.name ?? "" };
      }
      return token;
    },
    async session({ session, token }) {
      if (token.x) session.x = token.x as NonNullable<typeof session.x>;
      return session;
    },
  },
};

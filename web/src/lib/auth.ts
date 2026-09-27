import type { NextAuthOptions } from "next-auth";
import TwitterProvider from "next-auth/providers/twitter";

declare module "next-auth" {
  interface Session {
    xUsername?: string;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    TwitterProvider({
      clientId: process.env.TWITTER_CLIENT_ID ?? "",
      clientSecret: process.env.TWITTER_CLIENT_SECRET ?? "",
      version: "2.0",
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 },
  callbacks: {
    async jwt({ token, profile }) {
      // OAuth 2.0 profile shape: { data: { id, name, username, profile_image_url } }
      const username = (profile as { data?: { username?: string } } | undefined)?.data?.username;
      if (username) token.xUsername = username.toLowerCase();
      return token;
    },
    async session({ session, token }) {
      if (typeof token.xUsername === "string") session.xUsername = token.xUsername;
      return session;
    },
  },
};

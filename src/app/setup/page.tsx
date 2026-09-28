import type { Metadata } from "next";
import { adminKey } from "@/lib/adminKey";
import { adminsConfigured, currentAdmin } from "@/lib/admin";
import { AdminGate } from "./AdminGate";
import SetupClient from "./SetupClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Setup", robots: { index: false, follow: false } };

/**
 * /setup is for the site's owner only: the wallets in ADMIN_ADDRESSES and the on-chain owner of
 * each pinned launcher. Anyone else gets the sign-in screen; the setup page isn't rendered for them.
 */
export default async function SetupPage() {
  const admin = await currentAdmin();
  if (admin) return <SetupClient admin={admin} />;
  return <AdminGate hasKey={Boolean(adminKey())} configured={await adminsConfigured()} />;
}

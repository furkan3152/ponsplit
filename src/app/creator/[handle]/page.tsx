import { notFound } from "next/navigation";
import { CreatorFees } from "@/components/CreatorFees";
import {
  isValidTikTokHandle,
  normalizeTikTokHandle,
} from "@/lib/tiktok-config";

export default function CreatorPage({
  params,
}: {
  params: { handle: string };
}) {
  const handle = normalizeTikTokHandle(params.handle);
  if (!isValidTikTokHandle(handle)) notFound();
  return <CreatorFees initialHandle={handle} />;
}

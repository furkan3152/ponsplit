import { memoryMetadata } from "../store";

export const dynamic = "force-dynamic";

/** GET → metadata saved in memory (SPLIDEV_METADATA_STORE=memory, the local end-to-end test only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = process.env.SPLIDEV_METADATA_STORE === "memory" ? memoryMetadata.get(id) : undefined;
  if (!json) return Response.json({ error: "Not found." }, { status: 404 });
  return new Response(json, { headers: { "content-type": "application/json" } });
}

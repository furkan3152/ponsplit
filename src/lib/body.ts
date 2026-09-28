import "server-only";

/**
 * Reads a request body, refusing anything over `maxBytes` before it is buffered in full. Route
 * handlers have no default body limit, so without this one large request can exhaust memory.
 */
export async function readBody(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** JSON body capped at `maxBytes` (default 16 KB). Returns null when missing, too large or invalid. */
export async function readJson<T>(req: Request, maxBytes = 16 * 1024): Promise<T | null> {
  const bytes = await readBody(req, maxBytes).catch(() => null);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

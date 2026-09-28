/**
 * Makes a picture fit the upload limits (2 MB, at most MAX_SIDE px on a side) in the browser, so a
 * photo straight off a phone camera just works. GIFs are left alone (redrawing would stop them
 * moving); anything already small enough is sent as it is. Transparent images stay PNG; photos
 * that are still too big as PNG become JPEG.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 1024;

export async function shrinkImage(file: File): Promise<File> {
  if (file.type === "image/gif" || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // not something the browser can read; the server says why
  }
  const big = Math.max(bitmap.width, bitmap.height);
  if (file.size <= MAX_BYTES && big <= MAX_SIDE) {
    bitmap.close();
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / big);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string, quality?: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality));
  let out = await encode("image/png");
  let type = "image/png";
  if (!out || out.size > MAX_BYTES) {
    out = await encode("image/jpeg", 0.88);
    type = "image/jpeg";
  }
  if (!out) return file;
  return new File([out], file.name.replace(/\.\w+$/, "") + (type === "image/png" ? ".png" : ".jpg"), { type });
}

/**
 * Image type and size from the file's own bytes (never from a declared MIME type or extension).
 * Used to refuse "decompression bombs": a small file that declares a huge canvas, which an image
 * decoder would expand to hundreds of megabytes of pixels.
 */

export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** Limits for anything we store or render: plenty for a coin logo. */
export const MAX_IMAGE_SIDE = 2048;
export const MAX_IMAGE_PIXELS = 2048 * 2048;

export function sniffImage(b: Uint8Array): ImageType | null {
  const at = (i: number, bytes: number[]) => bytes.every((x, j) => b[i + j] === x);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/**
 * The largest width × height the decoder will allocate for this file, or null when the header
 * can't be read (callers treat that as "reject"). For GIFs every frame is checked, not just the
 * logical screen.
 */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  switch (sniffImage(b)) {
    case "image/png":
      // Signature (8) + IHDR length (4) + "IHDR" (4), then width and height.
      if (b.length < 24 || !(b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52)) return null;
      return { width: be32(b, 16), height: be32(b, 20) };
    case "image/jpeg":
      return jpegSize(b);
    case "image/gif":
      return gifSize(b);
    case "image/webp":
      return webpSize(b);
    default:
      return null;
  }
}

function jpegSize(b: Uint8Array) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // image data before any frame header
    // SOF0..SOF15 hold the frame size; C4 (DHT), C8 (JPG) and CC (DAC) are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: be16(b, i + 5), width: be16(b, i + 7) };
    }
    i += 2 + be16(b, i + 2);
  }
  return null;
}

function gifSize(b: Uint8Array) {
  if (b.length < 13) return null;
  let width = le16(b, 6);
  let height = le16(b, 8);
  let i = 13;
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 0x07) + 1)); // global colour table
  const skipSubBlocks = () => {
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    i++;
  };
  while (i < b.length) {
    const block = b[i];
    if (block === 0x3b) return { width, height }; // trailer
    if (block === 0x21) {
      i += 2; // extension introducer + label
      skipSubBlocks();
    } else if (block === 0x2c) {
      if (i + 10 > b.length) return null;
      // A frame may be larger than the logical screen; the decoder allocates for the frame.
      width = Math.max(width, le16(b, i + 1) + le16(b, i + 5));
      height = Math.max(height, le16(b, i + 3) + le16(b, i + 7));
      const flags = b[i + 9];
      i += 10;
      if (flags & 0x80) i += 3 * (1 << ((flags & 0x07) + 1)); // local colour table
      i += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      return null;
    }
  }
  return { width, height };
}

function webpSize(b: Uint8Array) {
  if (b.length < 30) return null;
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === "VP8X") return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  if (chunk === "VP8L") {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  return null;
}

/** True when the image's real dimensions are within the limits above. */
export function imageWithinLimits(b: Uint8Array): boolean {
  const size = imageSize(b);
  if (!size || size.width <= 0 || size.height <= 0) return false;
  return size.width <= MAX_IMAGE_SIDE && size.height <= MAX_IMAGE_SIDE && size.width * size.height <= MAX_IMAGE_PIXELS;
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { imageSize, imageWithinLimits, sniffImage } from "./image-bytes.ts";

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16be = (n: number) => [(n >> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >> 8) & 255];
const u24le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

function png(w: number, h: number) {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32be(w), ...u32be(h), 8, 6, 0, 0, 0]);
}

function jpeg(w: number, h: number) {
  const app0 = [0xff, 0xe0, ...u16be(16), 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const dht = [0xff, 0xc4, ...u16be(4), 0, 0]; // must not be mistaken for a frame header
  const sof0 = [0xff, 0xc0, ...u16be(11), 8, ...u16be(h), ...u16be(w), 1, 1, 0x11, 0];
  return new Uint8Array([0xff, 0xd8, ...app0, ...dht, ...sof0, 0xff, 0xd9]);
}

function gif(screen: [number, number], frames: [number, number, number, number][]) {
  const out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...u16le(screen[0]), ...u16le(screen[1]), 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
  out.push(0x21, 0xf9, 4, 0, 0, 0, 0, 0); // graphic control extension
  for (const [left, top, w, h] of frames) {
    out.push(0x2c, ...u16le(left), ...u16le(top), ...u16le(w), ...u16le(h), 0, 2, 2, 0x4c, 0x01, 0);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}

function webpVp8x(w: number, h: number) {
  const riff = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
  return new Uint8Array([...riff, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1), 0, 0]);
}

test("detects the real type from the bytes", () => {
  assert.equal(sniffImage(png(1, 1)), "image/png");
  assert.equal(sniffImage(jpeg(1, 1)), "image/jpeg");
  assert.equal(sniffImage(gif([1, 1], [[0, 0, 1, 1]])), "image/gif");
  assert.equal(sniffImage(webpVp8x(1, 1)), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<html>")), null);
});

test("reads dimensions from each format's header", () => {
  assert.deepEqual(imageSize(png(512, 300)), { width: 512, height: 300 });
  assert.deepEqual(imageSize(jpeg(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(imageSize(webpVp8x(800, 600)), { width: 800, height: 600 });
  assert.deepEqual(imageSize(gif([100, 100], [[0, 0, 100, 100]])), { width: 100, height: 100 });
});

test("rejects decompression bombs: small files with huge canvases", () => {
  assert.equal(imageWithinLimits(png(512, 512)), true);
  assert.equal(imageWithinLimits(png(8000, 8000)), false);
  assert.equal(imageWithinLimits(jpeg(16000, 16000)), false);
  assert.equal(imageWithinLimits(webpVp8x(10000, 10)), false);
  // A GIF whose frame is far larger than its tiny logical screen.
  assert.equal(imageWithinLimits(gif([10, 10], [[0, 0, 9000, 9000]])), false);
  assert.equal(imageWithinLimits(gif([10, 10], [[0, 0, 10, 10]])), true);
});

test("JPEG: skips padding and FF 00 between segments like the decoder, and finds the same frame", () => {
  const sof = (w: number, h: number, kind = 0xc0) => [0xff, kind, ...u16be(11), 8, ...u16be(h), ...u16be(w), 1, 1, 0x11, 0];
  const app0 = [0xff, 0xe0, ...u16be(16), 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  // Harmless padding (some cameras write it) is still read correctly.
  const padded = new Uint8Array([0xff, 0xd8, ...app0, 0, 0, ...sof(400, 300), 0xff, 0xd9]);
  assert.deepEqual(imageSize(padded), { width: 400, height: 300 });
  // "FF 00" at a boundary must not be read as a segment length that jumps over the real frame
  // header to a small decoy one (the decoder would decode the huge frame).
  const decoy = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x00, 0x23, ...sof(20000, 20000, 0xc2), ...sof(64, 64), 0xff, 0xd9]);
  assert.deepEqual(imageSize(decoy), { width: 20000, height: 20000 });
  assert.equal(imageWithinLimits(decoy), false);
  // Reserved markers are refused.
  assert.equal(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0x02, 0, 4, 0, 0, ...sof(10, 10)])), null);
});

test("rejects files whose header can't be read", () => {
  assert.equal(imageWithinLimits(new Uint8Array([0xff, 0xd8, 0xff])), false);
  assert.equal(imageWithinLimits(png(0, 10)), false);
});

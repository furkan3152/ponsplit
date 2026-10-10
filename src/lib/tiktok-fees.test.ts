import test from "node:test";
import assert from "node:assert/strict";
import { creatorFeeSplit } from "./tiktok-fees";
import { isValidTikTokHandle, normalizeTikTokHandle } from "./tiktok-config";

test("current creator-fee model allocates exactly twenty percent to platform and eighty to creator", () => {
  assert.deepEqual(creatorFeeSplit(2000, 0), { platformBps: 2000, launcherBps: 0, creatorBps: 8000 });
});

test("creator fee allocation conserves all basis points at every supported launcher reward", () => {
  for (let reward = 0; reward <= 1000; reward++) {
    const s = creatorFeeSplit(1000, reward);
    assert.equal(s.creatorBps + s.platformBps + s.launcherBps, 10_000);
    assert.ok(s.creatorBps >= 8000);
  }
});

test("invalid rewards and platform shares cannot enter a permanent split", () => {
  for (const reward of [-1, 1001, 0.5, NaN, Infinity, "100"]) assert.throws(() => creatorFeeSplit(1000, reward as number));
  for (const platform of [0, -1, 5001, NaN]) assert.throws(() => creatorFeeSplit(platform, 0));
});

test("TikTok handles normalize only recognized profile URLs and valid username syntax", () => {
  assert.equal(normalizeTikTokHandle(" https://www.tiktok.com/@Creator.name/video/123?lang=en "), "creator.name");
  assert.equal(normalizeTikTokHandle("@Mixed_CASE"), "mixed_case");
  assert.ok(isValidTikTokHandle(normalizeTikTokHandle("tiktok.com/@creator")));
  for (const input of ["https://evil.example/@creator", "https://tiktok.com.evil/@creator", "@@creator", "creator.", "name with spaces", "a".repeat(25), "créator"]) assert.equal(isValidTikTokHandle(normalizeTikTokHandle(input)), false, input);
});

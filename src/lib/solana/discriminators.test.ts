import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// The account discriminators hard-coded in reads.ts (no crypto in the browser bundle) must match Anchor's.
test("account discriminators match sha256('account:<Name>')", () => {
  const src = readFileSync(new URL("./reads.ts", import.meta.url), "utf8");
  for (const [name, constant] of [["SharingConfig", "SHARING_CONFIG_DISC"], ["SocialFeePda", "SOCIAL_FEE_PDA_DISC"]]) {
    const m = src.match(new RegExp(`${constant} = Buffer\\.from\\(\\[([\\d, ]+)\\]\\)`));
    assert.ok(m, constant);
    const want = [...createHash("sha256").update(`account:${name}`).digest().subarray(0, 8)];
    assert.deepEqual(m![1].split(",").map((x) => Number(x.trim())), want, name);
  }
});

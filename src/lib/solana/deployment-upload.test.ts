import assert from "node:assert/strict";
import test from "node:test";
import { sendUploadQueue } from "./deployment-upload.ts";

test("signed upload queue sends each write once and caps simultaneous requests at three", async () => {
  let active = 0, maximum = 0;
  const seen: number[] = [];
  await sendUploadQueue(Array.from({ length: 71 }, (_, i) => i), async (item, index) => {
    assert.equal(item, index);
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve));
    seen.push(item);
    active--;
  });
  assert.equal(maximum, 3);
  assert.equal(active, 0);
  assert.deepEqual(seen.sort((a,b) => a-b), Array.from({ length: 71 }, (_, i) => i));
});

test("a failed upload stops new sends and waits for in-flight writes before permitting resume", async () => {
  const started: number[] = [];
  const release: Array<() => void> = [];
  const reject: Array<(error: Error) => void> = [];
  const failure = new Error("Upload disconnected");
  let settled = false;
  const work = sendUploadQueue([0,1,2,3,4,5], async i => {
    started.push(i);
    await new Promise<void>((resolve, fail) => { release[i] = resolve; reject[i] = fail; });
  });
  const checked = assert.rejects(work, error => error === failure).then(() => { settled = true; });
  assert.deepEqual(started, [0,1,2]);
  reject[1](failure);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, "failure must not release the UI while other writes are still active");
  release[0]();release[2]();
  await checked;
  assert.deepEqual(started, [0,1,2], "later signed writes remain unsent and can be resumed from readback");
  assert.equal(settled, true);
});

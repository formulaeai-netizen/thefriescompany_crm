import assert from "node:assert/strict";
import test from "node:test";
import { buildSchedulerHandle, createOverlapGuardedRunner } from "./services/scheduler.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("overlapping runs are prevented - a second call while the first is still in progress is skipped", async () => {
  let calls = 0;
  let concurrent = 0;
  let maxConcurrent = 0;

  const runner = createOverlapGuardedRunner("test-workflow", async () => {
    calls++;
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(20);
    concurrent--;
  });

  const first = runner();
  const second = runner(); // fired before `first` resolves - must be skipped
  await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.equal(maxConcurrent, 1);
});

test("after a run completes, the next call is allowed to run again", async () => {
  let calls = 0;
  const runner = createOverlapGuardedRunner("test-workflow", async () => {
    calls++;
    await sleep(5);
  });

  await runner();
  await runner();

  assert.equal(calls, 2);
});

test("a workflow error is isolated - it never throws out of the guarded runner, and the flag resets for the next run", async () => {
  let attempt = 0;
  const runner = createOverlapGuardedRunner("failing-workflow", async () => {
    attempt++;
    throw new Error("simulated workflow failure");
  });

  await assert.doesNotReject(() => runner());
  assert.equal(attempt, 1);

  // Confirm the "running" flag was released even after the error, so a
  // second scheduled run is not skipped due to a stuck guard.
  await assert.doesNotReject(() => runner());
  assert.equal(attempt, 2);
});

test("one workflow's error does not affect an independent workflow's runner", async () => {
  const failing = createOverlapGuardedRunner("failing-workflow", async () => {
    throw new Error("boom");
  });
  let okCalls = 0;
  const ok = createOverlapGuardedRunner("ok-workflow", async () => {
    okCalls++;
  });

  await failing();
  await ok();

  assert.equal(okCalls, 1);
});

test("graceful stop calls stop() on every scheduled task exactly once", () => {
  let stopCalls = 0;
  const fakeTask = { stop: () => stopCalls++ };
  const handle = buildSchedulerHandle([fakeTask, fakeTask, fakeTask]);

  handle.stop();

  assert.equal(stopCalls, 3);
});

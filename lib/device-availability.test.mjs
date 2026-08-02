import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  createDeviceAvailabilityTracker,
  recordDeviceAvailabilitySample,
} = await jiti.import("./device-availability.ts");

test("does not show offline after one transient failure", () => {
  const tracker = recordDeviceAvailabilitySample(
    createDeviceAvailabilityTracker("mac-main"),
    "offline",
    1_000,
  );
  assert.equal(tracker.offline, false);
  assert.equal(tracker.consecutiveFailures, 1);
});

test("requires three failures spanning the confirmation window", () => {
  let tooFast = createDeviceAvailabilityTracker("mac-main");
  tooFast = recordDeviceAvailabilitySample(tooFast, "offline", 1_000);
  tooFast = recordDeviceAvailabilitySample(tooFast, "offline", 5_000);
  tooFast = recordDeviceAvailabilitySample(tooFast, "offline", 8_999);
  assert.equal(tooFast.offline, false);

  let tracker = createDeviceAvailabilityTracker("mac-main");
  tracker = recordDeviceAvailabilitySample(tracker, "offline", 1_000);
  tracker = recordDeviceAvailabilitySample(tracker, "offline", 5_000);
  tracker = recordDeviceAvailabilitySample(tracker, "offline", 9_000);
  assert.equal(tracker.offline, true);
});

test("an online sample resets an unconfirmed failure streak", () => {
  let tracker = createDeviceAvailabilityTracker("mac-main");
  tracker = recordDeviceAvailabilitySample(tracker, "offline", 1_000);
  tracker = recordDeviceAvailabilitySample(tracker, "offline", 6_000);
  tracker = recordDeviceAvailabilitySample(tracker, "online", 7_000);
  tracker = recordDeviceAvailabilitySample(tracker, "offline", 12_000);

  assert.equal(tracker.offline, false);
  assert.equal(tracker.consecutiveFailures, 1);
  assert.equal(tracker.firstFailureAt, 12_000);
});

test("requires two consecutive successes to recover from confirmed offline", () => {
  let tracker = createDeviceAvailabilityTracker("mac-main", true);
  tracker = recordDeviceAvailabilitySample(tracker, "online", 1_000);
  assert.equal(tracker.offline, true);

  tracker = recordDeviceAvailabilitySample(tracker, "offline", 2_000);
  tracker = recordDeviceAvailabilitySample(tracker, "online", 3_000);
  assert.equal(tracker.offline, true);

  tracker = recordDeviceAvailabilitySample(tracker, "online", 4_000);
  assert.equal(tracker.offline, false);
});

test("creating a tracker for a new device clears prior evidence", () => {
  const tracker = createDeviceAvailabilityTracker("linux-home");
  assert.deepEqual(tracker, {
    deviceId: "linux-home",
    offline: false,
    consecutiveFailures: 0,
    firstFailureAt: null,
    consecutiveSuccesses: 0,
  });
});

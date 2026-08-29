import "../test_helper.js";
import "../../../background_scripts/browser_toolbox/gesture_frame_coordinator.js";

context("Gesture frame coordinator", () => {
  should("accept only the active tab and frame request", () => {
    const coordinator = new BrowserToolboxGestureFrameCoordinator();
    assert.isTrue(coordinator.start(7, 2, "request-1234"));
    assert.isFalse(coordinator.isActive(7, 1, "request-1234"));
    assert.isTrue(coordinator.isActive(7, 2, "request-1234"));
    assert.isTrue(coordinator.update(7, 2, "request-1234", "R"));
    const finished = coordinator.finish(7, 2, "request-1234");
    assert.equal(2, finished.frameId);
    assert.equal("request-1234", finished.requestId);
    assert.equal(["R"], finished.directions);
    assert.isFalse(coordinator.isActive(7, 2, "request-1234"));
  });

  should("reject invalid, repeated, expired and mismatched sessions", () => {
    const coordinator = new BrowserToolboxGestureFrameCoordinator();
    assert.isFalse(coordinator.start(null, 0, "request-1234"));
    assert.isFalse(coordinator.start(7, 0, null));
    assert.isTrue(coordinator.start(7, 0, "request-5678"));
    assert.isFalse(coordinator.update(7, 1, "request-5678", "R"));
    assert.isFalse(coordinator.update(7, 0, "other-request", "R"));
    assert.isTrue(coordinator.update(7, 0, "request-5678", "R"));
    assert.isTrue(coordinator.update(7, 0, "request-5678", "R"));

    for (const direction of ["U", "D", "L", "R", "UL", "UR", "DL", "DR", "U"]) {
      coordinator.update(7, 0, "request-5678", direction);
    }
    assert.isFalse(coordinator.update(7, 0, "request-5678", "D"));
    assert.isFalse(coordinator.isActive(7, 0, "request-5678"));
    assert.equal(null, coordinator.finish(7, 1, "request-5678"));
    assert.equal(null, coordinator.finish(7, 0, "request-5678"));
  });

  should("cancel only matching requests and expire old sessions", () => {
    let now = 1000;
    stub(Date, "now", () => now);
    const coordinator = new BrowserToolboxGestureFrameCoordinator();
    assert.isTrue(coordinator.start(3, 1, "request-9012"));
    assert.isTrue(coordinator.isActive(3, 1, "request-9012"));
    coordinator.cancel(3, "other-request");
    assert.isTrue(coordinator.isActive(3, 1, "request-9012"));
    now = 3501;
    assert.isFalse(coordinator.isActive(3, 1, "request-9012"));
    coordinator.cancel(3, "request-9012");
    assert.isFalse(coordinator.isActive(3, 1, "request-9012"));
    coordinator.start(4, 2, "request-3456");
    coordinator.clearTab(4);
    assert.isFalse(coordinator.isActive(4, 2, "request-3456"));
  });

  should("honor the validated duration of each session", () => {
    let now = 1000;
    stub(Date, "now", () => now);
    const coordinator = new BrowserToolboxGestureFrameCoordinator();
    assert.isTrue(coordinator.start(5, 1, "request-7890", 10000));
    now = 10999;
    assert.isTrue(coordinator.isActive(5, 1, "request-7890"));
    now = 11001;
    assert.isFalse(coordinator.isActive(5, 1, "request-7890"));
  });
});

import "../test_helper.js";
import "../../../background_scripts/open_key_mouse/gesture_frame_coordinator.js";

context("Gesture frame coordinator", () => {
  should("accept only the active tab and frame request", () => {
    const coordinator = new OpenKeyMouseGestureFrameCoordinator();
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
});

import "../test_helper.js";
import "../../../content_scripts/mouse/path_sampler.js";
import "../../../content_scripts/mouse/direction_quantizer.js";
import "../../../content_scripts/mouse/gesture_session.js";

context("Gesture session", () => {
  should("keep an ordinary right click native until activation", () => {
    const session = new OpenKeyMouseGestureSession({ activationDistancePx: 10 });
    session.start({ x: 0, y: 0 }, 1000);
    const result = session.move({ x: 5, y: 0 }, 1010);
    assert.equal("PENDING", result.state);
    assert.equal("NATIVE_CONTEXT_MENU", session.end().state);
  });

  should("cancel an expired active session without a command", () => {
    const session = new OpenKeyMouseGestureSession({ activationDistancePx: 5, maxDurationMs: 20 });
    session.start({ x: 0, y: 0 }, 1000);
    assert.isTrue(session.move({ x: 10, y: 0 }, 1010).activated);
    assert.equal("CANCELLED", session.move({ x: 20, y: 0 }, 1030).state);
    assert.equal(0, session.snapshot(false).points.length);
  });
});

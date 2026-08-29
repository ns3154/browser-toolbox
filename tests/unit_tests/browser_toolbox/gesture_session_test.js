import "../test_helper.js";
import "../../../content_scripts/mouse/path_sampler.js";
import "../../../content_scripts/mouse/direction_quantizer.js";
import "../../../content_scripts/mouse/gesture_session.js";

context("Gesture session", () => {
  should("mark an unactivated right-button session as a native-context candidate", () => {
    const session = new BrowserToolboxGestureSession({ activationDistancePx: 10 });
    session.start({ x: 0, y: 0 }, 1000);
    const result = session.move({ x: 5, y: 0 }, 1010);
    assert.equal("PENDING", result.state);
    assert.equal("NATIVE_CONTEXT_MENU", session.end(1010).state);
  });

  should("keep native context menu terminal after a later pointer move", () => {
    const session = new BrowserToolboxGestureSession({ activationDistancePx: 10 });
    session.start({ x: 0, y: 0 }, 1000);

    assert.equal("NATIVE_CONTEXT_MENU", session.contextMenu({ x: 2, y: 0 }, 1005).state);
    assert.equal("NATIVE_CONTEXT_MENU", session.move({ x: 40, y: 0 }, 1010).state);
    assert.equal("NATIVE_CONTEXT_MENU", session.end(1020).state);
    assert.equal(0, session.snapshot(false).points.length);
  });

  should("activate when context menu coordinates have already crossed the threshold", () => {
    const session = new BrowserToolboxGestureSession({ activationDistancePx: 10 });
    session.start({ x: 0, y: 0 }, 1000);

    const result = session.contextMenu({ x: 12, y: 0 }, 1010);
    assert.isTrue(result.activated);
    assert.equal("ACTIVE", result.state);
  });

  should("recognize diagonal movement in the default eight-way mode", () => {
    const session = new BrowserToolboxGestureSession({
      activationDistancePx: 5,
      minimumSegmentDistancePx: 10,
    });
    session.start({ x: 0, y: 0 }, 1000);

    const result = session.move({ x: 20, y: -20 }, 1010);
    assert.isTrue(result.activated);
    assert.equal(["UR"], result.pattern);
    assert.equal(["UR"], session.end(1020).pattern);
  });

  should("cancel an expired active session without a command", () => {
    const session = new BrowserToolboxGestureSession({
      activationDistancePx: 5,
      maxDurationMs: 20,
    });
    session.start({ x: 0, y: 0 }, 1000);
    assert.isTrue(session.move({ x: 10, y: 0 }, 1010).activated);
    assert.equal("CANCELLED", session.move({ x: 20, y: 0 }, 1030).state);
    assert.equal(0, session.snapshot(false).points.length);
  });

  should("cancel an active session that expires before pointerup", () => {
    const session = new BrowserToolboxGestureSession({
      activationDistancePx: 5,
      maxDurationMs: 20,
    });
    session.start({ x: 0, y: 0 }, 1000);
    assert.isTrue(session.move({ x: 10, y: 0 }, 1010).activated);
    const result = session.end(1031);
    assert.equal("CANCELLED", result.state);
    assert.equal(0, result.pattern.length);
    assert.equal(0, result.points.length);
  });
});

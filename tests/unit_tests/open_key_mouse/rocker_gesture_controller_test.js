import "../test_helper.js";
import "../../../content_scripts/mouse/rocker_gesture_controller.js";

context("Rocker gesture controller", () => {
  should("recognize both button orders and cancel incomplete input", () => {
    const controller = new OpenKeyMouseRockerGestureController();
    assert.equal(null, controller.pointerDown(2));
    assert.equal("HOLD_RIGHT_THEN_CLICK_LEFT", controller.pointerDown(0));
    assert.isTrue(controller.pointerUp(0));
    assert.isTrue(controller.pointerUp(2));
    assert.equal(null, controller.pointerDown(0));
    assert.equal("HOLD_LEFT_THEN_CLICK_RIGHT", controller.pointerDown(2));
  });

  should("ignore invalid or repeated buttons and clear suppression", () => {
    const controller = new OpenKeyMouseRockerGestureController();
    assert.equal(null, controller.pointerDown(1));
    assert.equal(null, controller.pointerDown(2));
    assert.equal(null, controller.pointerDown(2));
    assert.isFalse(controller.pointerUp(0));
    controller.cancel();
    assert.isFalse(controller.pointerUp(2));
    assert.equal(null, controller.pointerDown(0));
    assert.equal("HOLD_LEFT_THEN_CLICK_RIGHT", controller.pointerDown(2));
    assert.isTrue(controller.pointerUp(2));
    assert.isTrue(controller.pointerUp(0));
  });
});

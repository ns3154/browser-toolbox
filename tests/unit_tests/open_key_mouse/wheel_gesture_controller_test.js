import "../test_helper.js";
import "../../../content_scripts/mouse/wheel_gesture_controller.js";

context("Wheel gesture controller", () => {
  should("accumulate a threshold and respect cooldown", () => {
    const controller = new OpenKeyMouseWheelGestureController();
    const settings = { enabled: true, threshold: 80, cooldownMs: 180 };
    assert.equal(null, controller.handle({ buttons: 2, deltaY: 40, now: 1000, settings }));
    assert.equal(
      { button: "RIGHT_BUTTON", direction: "DOWN" },
      controller.handle({ buttons: 2, deltaY: 50, now: 1000, settings }),
    );
    assert.equal(null, controller.handle({ buttons: 2, deltaY: 100, now: 1100, settings }));
    assert.equal(
      { button: "RIGHT_BUTTON", direction: "UP" },
      controller.handle({ buttons: 2, deltaY: -180, now: 1300, settings }),
    );
  });
});

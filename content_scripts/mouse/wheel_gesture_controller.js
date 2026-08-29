// 滚轮适配器使用累计阈值，避免触控板的小幅 delta 误触发命令。
(function () {
  const BUTTONS = Object.freeze({ LEFT_BUTTON: 1, RIGHT_BUTTON: 2, MIDDLE_BUTTON: 4 });

  function heldButton(buttons) {
    if (buttons & BUTTONS.RIGHT_BUTTON) return "RIGHT_BUTTON";
    if (buttons & BUTTONS.LEFT_BUTTON) return "LEFT_BUTTON";
    if (buttons & BUTTONS.MIDDLE_BUTTON) return "MIDDLE_BUTTON";
    return null;
  }

  function buttonName(button) {
    return button === 0
      ? "LEFT_BUTTON"
      : button === 1
      ? "MIDDLE_BUTTON"
      : button === 2
      ? "RIGHT_BUTTON"
      : null;
  }

  class WheelGestureController {
    constructor() {
      this.accumulated = new Map();
      this.lastTriggerAt = new Map();
    }

    handle({ buttons, deltaY, now = Date.now(), settings }) {
      if (!settings?.enabled) return null;
      const button = heldButton(buttons);
      if (!button) {
        this.reset();
        return null;
      }
      if (!Number.isFinite(deltaY)) return null;
      const value = (this.accumulated.get(button) || 0) + deltaY;
      this.accumulated.set(button, value);
      const threshold = settings.threshold;
      if (Math.abs(value) < threshold) return null;
      const last = this.lastTriggerAt.get(button) || 0;
      if (now - last < settings.cooldownMs) return null;
      this.lastTriggerAt.set(button, now);
      if (settings.continuousTabSwitching) this.accumulated.set(button, value % threshold);
      else this.accumulated.set(button, 0);
      return { button, direction: value < 0 ? "UP" : "DOWN" };
    }

    release(button) {
      const name = buttonName(button);
      if (!name) return;
      this.accumulated.delete(name);
      this.lastTriggerAt.delete(name);
    }

    reset() {
      this.accumulated.clear();
      this.lastTriggerAt.clear();
    }
  }

  globalThis.BrowserToolboxWheelGestureController = WheelGestureController;
  globalThis.BrowserToolboxWheelButtons = BUTTONS;
  globalThis.BrowserToolboxWheelButtonName = buttonName;
})();

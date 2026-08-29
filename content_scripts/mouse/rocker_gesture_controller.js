// 摇杆手势只在第二个按键按下时完成，未完成组合不抑制原生点击。
(function () {
  class RockerGestureController {
    constructor() {
      this.held = null;
      this.suppressed = false;
    }

    pointerDown(button) {
      if (button !== 0 && button !== 2) return null;
      if (this.held == null) {
        this.held = button;
        return null;
      }
      if (this.held === button) return null;
      const result = this.held === 2 && button === 0
        ? "HOLD_RIGHT_THEN_CLICK_LEFT"
        : this.held === 0 && button === 2
        ? "HOLD_LEFT_THEN_CLICK_RIGHT"
        : null;
      if (result) this.suppressed = true;
      return result;
    }

    pointerUp(button) {
      const suppressed = this.suppressed;
      if (button === this.held) this.held = null;
      if (this.suppressed && this.held == null) this.suppressed = false;
      return suppressed;
    }

    cancel() {
      this.held = null;
      this.suppressed = false;
    }
  }

  globalThis.BrowserToolboxRockerGestureController = RockerGestureController;
})();

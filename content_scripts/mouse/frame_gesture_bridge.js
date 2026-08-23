// Frame 只发送方向摘要，不发送鼠标坐标；Port 在一次手势结束后立即关闭。
(function () {
  class FrameGestureBridge {
    constructor() {
      this.port = null;
      this.requestId = null;
      this.lastDirection = null;
    }

    start(requestId) {
      this.requestId = requestId;
      this.lastDirection = null;
      try {
        this.port = chrome.runtime.connect({ name: "open-key-mouse-gesture" });
        this.port.postMessage({ type: "start", requestId });
      } catch (_) {
        this.port = null;
      }
    }

    update(direction) {
      if (!this.port || direction === this.lastDirection) return;
      this.lastDirection = direction;
      this.port.postMessage({ type: "update", requestId: this.requestId, direction });
    }

    finish(pattern) {
      if (this.port) this.port.postMessage({ type: "finish", requestId: this.requestId, pattern });
      this.close();
    }

    cancel() {
      if (this.port) this.port.postMessage({ type: "cancel", requestId: this.requestId });
      this.close();
    }

    close() {
      try {
        this.port?.disconnect();
      } catch (_) {}
      this.port = null;
      this.requestId = null;
      this.lastDirection = null;
    }
  }

  globalThis.OpenKeyMouseFrameGestureBridge = FrameGestureBridge;
})();

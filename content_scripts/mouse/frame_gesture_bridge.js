// Frame 只发送方向摘要，不发送鼠标坐标；每次消息都带 requestId 以绑定短生命周期会话。
(function () {
  class FrameGestureBridge {
    constructor() {
      this.requestId = null;
      this.lastDirection = null;
      this.readyPromise = Promise.resolve(true);
      this.resolveReady = null;
      this.readyTimer = null;
    }

    start(requestId) {
      this.requestId = requestId;
      this.lastDirection = null;
      this.readyPromise = new Promise((resolve) => {
        this.resolveReady = resolve;
        this.readyTimer = setTimeout(() => this.finishReady(false), 500);
      });
      try {
        chrome.runtime.sendMessage({
          handler: "openKeyMouse.gestureStart",
          requestId,
        }).then((result) => {
          const accepted = result?.accepted === true;
          this.finishReady(accepted);
          return accepted;
        }).catch(() => {
          this.finishReady(false);
          return false;
        });
      } catch (_) {
        this.finishReady(false);
      }
    }

    waitUntilReady() {
      return this.readyPromise;
    }

    update(direction) {
      if (!this.requestId || direction === this.lastDirection) return;
      this.lastDirection = direction;
      chrome.runtime.sendMessage({
        handler: "openKeyMouse.gestureUpdate",
        requestId: this.requestId,
        direction,
      }).catch(() => {});
    }

    finish(pattern) {
      if (!this.requestId) return;
      chrome.runtime.sendMessage({
        handler: "openKeyMouse.gestureFinish",
        requestId: this.requestId,
        pattern,
      }).catch(() => {});
      this.close();
    }

    cancel() {
      if (!this.requestId) return;
      chrome.runtime.sendMessage({
        handler: "openKeyMouse.gestureCancel",
        requestId: this.requestId,
      }).catch(() => {});
      this.close();
    }

    close() {
      this.finishReady(false);
      this.requestId = null;
      this.lastDirection = null;
    }

    finishReady(accepted) {
      if (!this.resolveReady) return;
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
      const resolve = this.resolveReady;
      this.resolveReady = null;
      resolve(accepted);
    }
  }

  globalThis.OpenKeyMouseFrameGestureBridge = FrameGestureBridge;
})();

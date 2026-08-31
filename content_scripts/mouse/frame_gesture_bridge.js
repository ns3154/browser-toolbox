// Frame 只发送方向摘要，不发送鼠标坐标；手势期间使用短生命周期 Port 绑定会话。
(function () {
  const GESTURE_PORT_NAME = "browserToolbox.gesture";
  const GESTURE_READY_TIMEOUT_MS = 2000;

  class FrameGestureBridge {
    constructor({ runtimeApi = globalThis.chrome?.runtime } = {}) {
      this.runtimeApi = runtimeApi;
      this.requestId = null;
      this.lastDirection = null;
      this.port = null;
      this.readyPromise = Promise.resolve(true);
      this.resolveReady = null;
      this.readyTimer = null;
      this.messageListener = (message) => this.handleMessage(message);
      this.disconnectListener = () => this.handleDisconnect();
    }

    start(requestId) {
      this.close();
      this.requestId = requestId;
      this.lastDirection = null;
      this.readyPromise = new Promise((resolve) => {
        this.resolveReady = resolve;
        // Service Worker 冷启动可能与配置读取并行发生，给首个手势留出完整的启动窗口。
        this.readyTimer = setTimeout(() => this.finishReady(false), GESTURE_READY_TIMEOUT_MS);
      });
      try {
        const port = this.runtimeApi?.connect?.({ name: GESTURE_PORT_NAME });
        if (
          !port?.postMessage ||
          !port.onMessage?.addListener ||
          !port.onDisconnect?.addListener
        ) throw new Error("Gesture Port is unavailable.");
        this.port = port;
        port.onMessage.addListener(this.messageListener);
        port.onDisconnect.addListener(this.disconnectListener);
        port.postMessage({
          handler: "browserToolbox.gestureStart",
          requestId,
        });
      } catch (_) {
        this.close();
      }
    }

    waitUntilReady() {
      return this.readyPromise;
    }

    update(direction) {
      if (!this.requestId || !this.port || direction === this.lastDirection) return;
      this.lastDirection = direction;
      try {
        this.port.postMessage({
          handler: "browserToolbox.gestureUpdate",
          requestId: this.requestId,
          direction,
        });
      } catch (_) {
        this.close();
      }
    }

    finish(pattern) {
      if (!this.requestId || !this.port) return;
      try {
        this.port.postMessage({
          handler: "browserToolbox.gestureFinish",
          requestId: this.requestId,
          pattern,
        });
      } catch (_) {
        // Port 已失效时仍需关闭本地引用，避免下次手势复用旧会话。
      }
      this.close();
    }

    cancel() {
      if (!this.requestId || !this.port) return;
      try {
        this.port.postMessage({
          handler: "browserToolbox.gestureCancel",
          requestId: this.requestId,
        });
      } catch (_) {
        // Port 已失效时 Service Worker 会通过 onDisconnect 清理对应会话。
      }
      this.close();
    }

    close() {
      this.finishReady(false);
      const port = this.port;
      this.port = null;
      this.requestId = null;
      this.lastDirection = null;
      try {
        port?.disconnect?.();
      } catch (_) {
        // 关闭失效 Port 不应阻断本地手势状态清理。
      }
    }

    handleMessage(message) {
      if (!this.requestId || !message || typeof message !== "object") return;
      if (typeof message.accepted === "boolean") this.finishReady(message.accepted);
    }

    handleDisconnect() {
      this.port = null;
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

  globalThis.BrowserToolboxFrameGestureBridge = FrameGestureBridge;
})();

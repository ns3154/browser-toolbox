// Service Worker 中的短生命周期手势会话。这里只保存方向和 requestId，不保存鼠标坐标。
(function () {
  class GestureFrameCoordinator {
    constructor() {
      this.sessions = new Map();
    }

    start(tabId, frameId, requestId) {
      if (tabId == null || frameId == null || typeof requestId !== "string") return false;
      this.sessions.set(tabId, { frameId, requestId, directions: [], startedAt: Date.now() });
      return true;
    }

    update(tabId, frameId, requestId, direction) {
      const session = this.sessions.get(tabId);
      if (!session || session.frameId !== frameId || session.requestId !== requestId) return false;
      if (session.directions.at(-1) !== direction) session.directions.push(direction);
      if (session.directions.length > 8) return false;
      return true;
    }

    isActive(tabId, frameId, requestId) {
      const session = this.sessions.get(tabId);
      return Boolean(
        session && session.frameId === frameId && session.requestId === requestId &&
          Date.now() - session.startedAt <= 2500,
      );
    }

    finish(tabId, frameId, requestId) {
      const session = this.sessions.get(tabId);
      if (!session || session.frameId !== frameId || session.requestId !== requestId) return null;
      this.sessions.delete(tabId);
      return session;
    }

    cancel(tabId, requestId) {
      const session = this.sessions.get(tabId);
      if (session?.requestId === requestId) this.sessions.delete(tabId);
    }

    clearTab(tabId) {
      this.sessions.delete(tabId);
    }
  }

  globalThis.OpenKeyMouseGestureFrameCoordinator = GestureFrameCoordinator;
  globalThis.OpenKeyMouseGestureFrameCoordinatorInstance ||= new GestureFrameCoordinator();
})();

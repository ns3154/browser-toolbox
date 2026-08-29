// 右键菜单保护覆盖手势候选、激活轨迹和 pointerup 后的浏览器事件间隙。
(function () {
  class ContextMenuGuard {
    constructor() {
      this.active = false;
      this.provisional = false;
      this.pending = false;
      this.pendingUntil = 0;
      this.contextMenuSeen = false;
      this.nativeMenuRetryUntil = 0;
      this.nativeMenuRetryPoint = null;
    }

    startPendingGesture() {
      // macOS 会在首次位移前派发 contextmenu；候选阶段先拦住这一枚事件，
      // 让同一次按住移动仍有机会越过阈值，但此时不会显示轨迹或执行命令。
      this.provisional = true;
      this.active = false;
      this.pending = false;
      this.pendingUntil = 0;
      this.contextMenuSeen = false;
      this.clearNativeMenuRetry();
    }

    activate() {
      if (this.active) return;
      this.active = true;
      this.provisional = false;
      this.pending = false;
      this.pendingUntil = 0;
      this.contextMenuSeen = false;
    }

    deactivate() {
      this.active = false;
      this.provisional = false;
    }

    armForContextMenu(graceMs = 1000) {
      // 某些浏览器在 pointerup 之后才派发 contextmenu；仅为已激活的轨迹保留一次性保护，
      // 避免轻点右键在清理 PENDING 状态后仍被误拦截。若菜单已经在 ACTIVE 阶段处理，
      // 则无需重复保护。
      if (!this.active || this.contextMenuSeen) return;
      this.pending = true;
      this.pendingUntil = Date.now() + graceMs;
    }

    shouldSuppress() {
      if (this.pending && Date.now() > this.pendingUntil) {
        this.pending = false;
        this.pendingUntil = 0;
      }
      return this.provisional || this.active || this.pending;
    }

    consume() {
      if (this.active) this.contextMenuSeen = true;
      this.pending = false;
      this.pendingUntil = 0;
    }

    clearPending() {
      this.pending = false;
      this.pendingUntil = 0;
      this.contextMenuSeen = false;
    }

    armNativeMenuRetry(point, graceMs = 600, now = Date.now()) {
      this.reset();
      this.nativeMenuRetryUntil = now + graceMs;
      this.nativeMenuRetryPoint = { x: point.x, y: point.y };
    }

    consumeNativeMenuRetry(point, maxDistancePx = 12, now = Date.now()) {
      const retryPoint = this.nativeMenuRetryPoint;
      const withinTime = retryPoint != null && now <= this.nativeMenuRetryUntil;
      const distance = retryPoint == null
        ? Number.POSITIVE_INFINITY
        : Math.hypot(point.x - retryPoint.x, point.y - retryPoint.y);
      const matched = withinTime && distance <= maxDistancePx;
      // 第二次右键无论是否命中都消费旧候选；未命中时本次输入重新成为手势候选。
      this.clearNativeMenuRetry();
      return matched;
    }

    clearNativeMenuRetry() {
      this.nativeMenuRetryUntil = 0;
      this.nativeMenuRetryPoint = null;
    }

    reset() {
      this.active = false;
      this.provisional = false;
      this.clearPending();
      this.clearNativeMenuRetry();
    }
  }

  globalThis.BrowserToolboxContextMenuGuard = ContextMenuGuard;
})();

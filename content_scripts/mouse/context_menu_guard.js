// 右键菜单保护按配置从手势会话开始生效，并覆盖 pointerup 到 contextmenu 的事件间隙。
(function () {
  class ContextMenuGuard {
    constructor() {
      this.active = false;
      this.pending = false;
      this.pendingUntil = 0;
      this.contextMenuSeen = false;
    }

    activate() {
      if (this.active) return;
      this.active = true;
      this.pending = false;
      this.pendingUntil = 0;
      this.contextMenuSeen = false;
    }

    deactivate() {
      this.active = false;
    }

    armForContextMenu(graceMs = 1000) {
      // 某些浏览器在 pointerup 之后才派发 contextmenu；保留一次性保护，避免已完成轨迹
      // 在清理 ACTIVE 状态后又打开浏览器菜单。若菜单已经在 ACTIVE 阶段处理，则无需重复保护。
      if (this.contextMenuSeen) return;
      this.pending = true;
      this.pendingUntil = Date.now() + graceMs;
    }

    shouldSuppress() {
      if (this.pending && Date.now() > this.pendingUntil) {
        this.pending = false;
        this.pendingUntil = 0;
      }
      return this.active || this.pending;
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
  }

  globalThis.BrowserToolboxContextMenuGuard = ContextMenuGuard;
})();

// 右键菜单保护只在手势进入 ACTIVE 后生效。
(function () {
  class ContextMenuGuard {
    constructor() {
      this.active = false;
    }

    activate() {
      this.active = true;
    }

    deactivate() {
      this.active = false;
    }

    shouldSuppress() {
      return this.active;
    }
  }

  globalThis.OpenKeyMouseContextMenuGuard = ContextMenuGuard;
})();

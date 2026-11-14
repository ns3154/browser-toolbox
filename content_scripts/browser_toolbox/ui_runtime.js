// SPDX-License-Identifier: GPL-3.0-or-later
// 兼容公共对象只作可逆门面，组件、HUD及焦点的状态和异步工作由本次引擎独立拥有。
(function () {
  const owners = new WeakMap();
  class Controller {
    constructor(resources, context, enabled, {
      page = globalThis,
      host = globalThis.BrowserToolboxRuntimeHostInstance,
      send = (message) => chrome.runtime.sendMessage(message),
      channel = () => new MessageChannel(),
      registry = globalThis.UIComponent.instances,
      facade = globalThis.HUD,
    } = {}) {
      Object.assign(this, {
        resources,
        context,
        enabled,
        page,
        host,
        send,
        channel,
        registry,
        facade,
      });
      this.epoch = host.runtimeEpoch;
      this.components = new Set();
      this.focus = new BrowserToolboxFrameFocus(this);
      facade.destroy();
      this.saved = Object.getOwnPropertyDescriptors(facade);
      this.hud = new BrowserToolboxHudRuntime.Hud(this, (facade.generation || 0) + 1);
      this.installFacade();
      resources.add(() => this.destroy());
    }
    identity() {
      return {
        documentId: this.context.documentId,
        runtimeEpoch: this.epoch,
        incognito: this.context.incognito === true,
      };
    }
    valid(preparing = false) {
      return !this.closed && this.enabled() && !this.host.disposed && !this.host.suspended &&
        !this.host.maintenancePaused && this.host.context.documentId === this.context.documentId &&
        this.host.runtimeEpoch === this.epoch &&
        (this.host.state === "active" || preparing && this.host.state === "initializing") &&
        this.host.plan.moduleImplementations.ui === "browser-toolbox";
    }
    installFacade() {
      owners.set(this.facade, this);
      this.installedKeys = new Set();
      for (const key of Object.getOwnPropertyNames(BrowserToolboxHudRuntime.Hud.prototype)) {
        if (key === "constructor") continue;
        Object.defineProperty(this.facade, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: this.hud[key].bind(this.hud),
        });
        this.installedKeys.add(key);
      }
      for (const key of [...Object.keys(this.hud), "_showForDurationTimerId"]) {
        if (key === "controller") continue;
        Object.defineProperty(this.facade, key, {
          configurable: true,
          enumerable: true,
          get: () => this.hud[key],
          set: (value) => this.hud[key] = value,
        });
        this.installedKeys.add(key);
      }
    }
    css() {
      if (!this.cssLoading) {
        this.cssLoading = (async () => {
          const items = await chrome.storage.session.get("vimiumCSSInChromeStorage");
          if (items.vimiumCSSInChromeStorage) return items.vimiumCSSInChromeStorage;
          const response = await fetch(chrome.runtime.getURL("content_scripts/vimium.css"));
          return response.ok ? response.text() : "";
        })().catch(() => "");
      }
      return this.cssLoading;
    }
    createComponent() {
      if (!this.valid(true)) throw new Error("UI_RUNTIME_INACTIVE");
      return new BrowserToolboxUIComponent(this);
    }
    cancelInteractions() {
      this.help?.abort(false);
      this.hud.abandon();
      for (const ui of this.components) ui.hide(false);
    }
    destroy() {
      if (this.closed) return;
      this.closed = true;
      this.help?.destroy();
      this.hud.destroy();
      for (const ui of [...this.components]) ui.destroy();
      this.focus.destroy();
      // 旧引擎异步任务看到递增后的旧代次；新引擎释放后不再持有兼容对象。
      if (owners.get(this.facade) === this) {
        for (const key of this.installedKeys) {
          if (this.saved[key]) Object.defineProperty(this.facade, key, this.saved[key]);
          else delete this.facade[key];
        }
        owners.delete(this.facade);
      }
      this.cssLoading = null;
    }
  }
  globalThis.BrowserToolboxUIRuntime = Object.freeze({ Controller });
})();

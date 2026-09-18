// 原生右键菜单管理器：只负责 contextMenus 生命周期和一次性输入令牌，不参与页面指针手势。
(function () {
  const registry = globalThis.BrowserToolboxToolRegistry;
  const tokenStore = globalThis.BrowserToolboxToolInputTokenStoreInstance;
  const launcher = globalThis.BrowserToolboxToolLauncherInstance;
  const ROOT_ID = "browser-toolbox.root";
  const ALL_TOOLS_ID = "browser-toolbox.all-tools";
  const MANAGE_ID = "browser-toolbox.manage-tools";
  const SEPARATOR_ID = "browser-toolbox.separator.primary";
  const toolIdForMenu = (toolId) => `browser-toolbox.tool.${toolId}`;
  const configuredToolIdForMenu = (toolId) => `browser-toolbox.configured-tool.${toolId}`;

  function menuProperties(overrides = {}) {
    return Object.assign({ contexts: ["all"] }, overrides);
  }

  class ToolContextMenuManager {
    constructor({ contextMenus = chrome.contextMenus, settingsRepository, openSettings } = {}) {
      this.contextMenus = contextMenus;
      this.settingsRepository = settingsRepository;
      this.openSettings = openSettings || (() =>
        chrome.tabs.create({
          url: chrome.runtime.getURL("pages/mouse_options.html"),
        }));
      this.listenerInstalled = false;
      this.currentIds = new Set();
      this.reconcilePromise = null;
      this.reconcileQueued = false;
    }

    reconcile(settings = this.settingsRepository?.getSettings?.()) {
      this.pendingSettings = settings;
      this.reconcileQueued = true;
      if (this.reconcilePromise) return this.reconcilePromise;
      const run = (async () => {
        let result = false;
        while (this.reconcileQueued) {
          this.reconcileQueued = false;
          const nextSettings = this.pendingSettings;
          this.pendingSettings = undefined;
          result = await this.reconcileOnce(nextSettings);
        }
        return result;
      })();
      const promise = run.finally(() => {
        if (this.reconcilePromise === promise) this.reconcilePromise = null;
      });
      this.reconcilePromise = promise;
      return promise;
    }

    async reconcileOnce(settings) {
      if (!this.contextMenus?.removeAll || !this.contextMenus?.create) return false;
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve();
        };
        try {
          const result = this.contextMenus.removeAll(finish);
          if (result?.then) result.then(() => finish(), finish);
        } catch (error) {
          finish(error);
        }
      });
      this.currentIds = new Set();
      if (settings?.tools?.enabled === false || settings?.tools?.contextMenu?.enabled === false) {
        return true;
      }
      globalThis.BrowserToolboxI18n?.setLocale?.(settings?.general?.language || "auto");
      const selected = registry.validateToolIds(settings?.tools?.contextMenu?.toolIds, {
          max: 3,
          source: "selection",
          surface: "contextMenu",
        })
        ? settings.tools.contextMenu.toolIds
        : registry.DEFAULT_CONTEXT_MENU_TOOL_IDS;
      await this.create(menuProperties({
        id: ROOT_ID,
        title: globalThis.BrowserToolboxI18n?.message("browserToolbox") || "Browser Toolbox",
        contexts: ["all"],
      }));
      for (const toolId of selected) {
        await this.create(menuProperties({
          id: configuredToolIdForMenu(toolId),
          parentId: ROOT_ID,
          title: globalThis.BrowserToolboxI18n?.message(registry.get(toolId).titleKey) || toolId,
          // 工具页既支持接收选中文本，也支持从空白输入开始使用。
          contexts: ["all"],
        }));
      }
      await this.create(menuProperties({ id: SEPARATOR_ID, parentId: ROOT_ID, type: "separator" }));
      await this.create(menuProperties({
        id: ALL_TOOLS_ID,
        parentId: ROOT_ID,
        title: globalThis.BrowserToolboxI18n?.message("allTools") || "All tools",
        contexts: ["all"],
      }));
      for (const descriptor of registry.list({ source: "selection", surface: "contextMenu" })) {
        await this.create(menuProperties({
          id: toolIdForMenu(descriptor.id),
          parentId: ALL_TOOLS_ID,
          title: globalThis.BrowserToolboxI18n?.message(descriptor.titleKey) || descriptor.id,
          // 没有选中文本时仍保留入口，点击后打开空白工具页。
          contexts: ["all"],
        }));
      }
      await this.create(menuProperties({
        id: MANAGE_ID,
        parentId: ROOT_ID,
        title: globalThis.BrowserToolboxI18n?.message("manageTools") || "Manage tools",
        contexts: ["all"],
      }));
      if (!this.listenerInstalled && this.contextMenus.onClicked?.addListener) {
        this.contextMenus.onClicked.addListener((info, tab) => this.handleClick(info, tab));
        this.listenerInstalled = true;
      }
      return true;
    }

    async create(properties) {
      this.currentIds.add(properties.id);
      try {
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve();
          };
          try {
            const result = this.contextMenus.create(properties, () => {
              const lastError = globalThis.chrome?.runtime?.lastError;
              finish(lastError ? new Error(lastError.message) : null);
            });
            if (result?.then) result.then(() => finish(), finish);
            else if (this.contextMenus.create.length < 2) finish();
          } catch (error) {
            finish(error);
          }
        });
      } catch (_) {
        // 浏览器在扩展重载期间可能短暂返回重复 ID；下一次 reconcile 会完整重建。
      }
    }

    async handleClick(info = {}, tab = {}) {
      if (info.menuItemId === MANAGE_ID) return this.openSettings();
      const prefixes = ["browser-toolbox.tool.", "browser-toolbox.configured-tool."];
      const prefix = prefixes.find((value) =>
        typeof info.menuItemId === "string" && info.menuItemId.startsWith(value)
      );
      if (!prefix) return;
      const toolId = info.menuItemId.slice(prefix.length);
      const descriptor = registry.get(toolId);
      if (!descriptor || !descriptor.allowedSources.includes("selection")) return;
      const input = typeof info.selectionText === "string" ? info.selectionText : "";
      let token = "";
      let notice = input ? "" : "empty-selection";
      if (descriptor.inputMode !== "none" && input.length > 0) {
        try {
          token = await tokenStore.put({
            toolId,
            input,
            source: "selection",
            tabId: tab?.id,
          });
        } catch (_) {
          // 超出一次性令牌上限时仍打开空白工具页，让用户可以手工粘贴或导入本地文件。
          notice = "selection-too-large";
        }
      }
      return launcher.open(toolId, { token, notice, source: "selection", tab });
    }
  }

  globalThis.BrowserToolboxToolContextMenuManager = Object.freeze({
    ROOT_ID,
    ALL_TOOLS_ID,
    MANAGE_ID,
    SEPARATOR_ID,
    toolIdForMenu,
    configuredToolIdForMenu,
    ToolContextMenuManager,
  });
})();

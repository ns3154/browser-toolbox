// 浏览器级命令适配器。所有外部 URL 先经过统一协议校验，再调用 tabs/windows API。
(function () {
  const invocationApi = globalThis.OpenKeyMouseCommandInvocation;

  function activeTabFromQuery(tabs) {
    return Array.isArray(tabs) && tabs.length > 0 ? tabs[0] : null;
  }

  class BrowserCommandAdapter {
    constructor(repository) {
      this.repository = repository;
    }

    async getTab(invocation, sender) {
      if (sender?.tab) return sender.tab;
      if (invocation.context?.tabId != null) return await chrome.tabs.get(invocation.context.tabId);
      return activeTabFromQuery(await chrome.tabs.query({ active: true, currentWindow: true }));
    }

    async openUrl(url, active, tab) {
      if (!invocationApi.isAllowedUrl(url)) {
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.BLOCKED_URL_SCHEME, url);
      }
      await chrome.tabs.create({
        url,
        active,
        index: tab?.index == null ? undefined : tab.index + 1,
      });
      return invocationApi.createResult(true);
    }

    async execute(invocation, sender) {
      const tab = await this.getTab(invocation, sender);
      if (!tab && !["OpenKeyMouse.newWindow"].includes(invocation.commandName)) {
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.NO_ACTIVE_TAB);
      }
      const context = invocation.context || {};
      switch (invocation.commandName) {
        case "OpenKeyMouse.closeWindow":
          await chrome.windows.remove(tab.windowId);
          return invocationApi.createResult(true);
        case "OpenKeyMouse.newWindow":
          await chrome.windows.create({
            url: context.linkUrl && invocationApi.isAllowedUrl(context.linkUrl)
              ? context.linkUrl
              : undefined,
          });
          return invocationApi.createResult(true);
        case "OpenKeyMouse.toggleKeyboard":
          return this.toggleModule("keyboard", tab.url);
        case "OpenKeyMouse.toggleMouseGestures":
          return this.toggleModule("mouse", tab.url);
        case "OpenKeyMouse.toggleSuperDrag":
          return this.toggleModule("superDrag", tab.url);
        case "OpenKeyMouse.showTabList":
          await chrome.tabs.create({ url: chrome.runtime.getURL("pages/tab_list.html") });
          return invocationApi.createResult(true);
        case "OpenKeyMouse.searchSelection":
          return this.searchSelection(context.selectedText, invocation.options?.disposition, tab);
        case "OpenKeyMouse.openLinkForeground":
        case "OpenKeyMouse.openImageForeground":
          return this.openUrl(context.linkUrl || context.imageUrl, true, tab);
        case "OpenKeyMouse.openLinkBackground":
        case "OpenKeyMouse.openImageBackground":
          return this.openUrl(context.linkUrl || context.imageUrl, false, tab);
        case "OpenKeyMouse.toggleFullscreen":
          return this.toggleWindowState(tab, "fullscreen");
        case "OpenKeyMouse.minimizeWindow":
          return this.toggleWindowState(tab, "minimized");
        case "OpenKeyMouse.maximizeWindow":
          return this.toggleWindowState(tab, "maximized");
        default:
          return invocationApi.createResult(false, invocationApi.ERROR_CODES.UNKNOWN_COMMAND);
      }
    }

    async toggleModule(moduleName, url) {
      const current = this.repository.getEffectiveSettings(url).effectiveModules?.[moduleName];
      const overrides = Object.assign({}, this.repository.sessionOverrides, {
        [moduleName]: !current,
      });
      await this.repository.setSessionOverrides(overrides);
      return invocationApi.createResult(true, invocationApi.ERROR_CODES.OK, undefined, {
        enabled: !current,
      });
    }

    async toggleWindowState(tab, state) {
      if (tab?.windowId == null) {
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.NO_ACTIVE_TAB);
      }
      let nextState = state;
      if (state === "fullscreen") {
        const window = await chrome.windows.get(tab.windowId);
        nextState = window?.state === "fullscreen" ? "normal" : "fullscreen";
      }
      await chrome.windows.update(tab.windowId, { state: nextState });
      return invocationApi.createResult(true);
    }

    async searchSelection(text, disposition, tab) {
      if (typeof text !== "string" || text.trim().length === 0) {
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.NO_MATCHING_ELEMENT);
      }
      const query = text.trim();
      if (chrome.search?.query) {
        await chrome.search.query({
          disposition: disposition === "background" ? "NEW_TAB" : "CURRENT_TAB",
          text: query,
        });
        return invocationApi.createResult(true);
      }
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      return this.openUrl(searchUrl, disposition !== "background", tab);
    }

    async executeExisting(commandName, invocation, sender, backgroundCommands) {
      const tab = await this.getTab(invocation, sender);
      if (!tab) return invocationApi.createResult(false, invocationApi.ERROR_CODES.NO_ACTIVE_TAB);
      const command = backgroundCommands?.[commandName];
      if (typeof command !== "function") {
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.UNKNOWN_COMMAND);
      }
      const registry = globalThis.OpenKeyMouseCommandRegistry?.getCommand(commandName);
      const registryEntry = Object.assign({
        command: commandName,
        options: invocation.options || {},
      }, registry || {});
      try {
        await command({
          count: invocation.count,
          tab,
          tabId: tab.id,
          registryEntry,
          url: invocation.context?.linkUrl,
        }, sender || {});
        return invocationApi.createResult(true);
      } catch (error) {
        return invocationApi.createResult(
          false,
          invocationApi.ERROR_CODES.COMMAND_FAILED,
          error.message,
        );
      }
    }
  }

  globalThis.OpenKeyMouseBrowserCommandAdapter = BrowserCommandAdapter;
})();

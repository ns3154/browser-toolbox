// 浏览器级命令适配器。所有外部 URL 先经过统一协议校验，再调用 tabs/windows API。
import * as userSearchEngines from "../user_search_engines.js";

/**
 * 浏览器标签页的最小命令上下文。
 * @typedef {Object} BrowserToolboxTabContext
 * @property {number} [id] 标签页 ID。
 * @property {number} [windowId] 窗口 ID。
 * @property {number} [index] 标签页位置。
 * @property {string} [url] 标签页 URL。
 */
(function () {
  const invocationApi = globalThis.BrowserToolboxCommandInvocation;
  const toolRegistry = globalThis.BrowserToolboxToolRegistry;
  const toolLauncher = globalThis.BrowserToolboxToolLauncherInstance;

  function isHttpUrl(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 8192) return false;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol);
    } catch (_) {
      return false;
    }
  }

  function isHttpSearchTemplate(value) {
    if (typeof value !== "string") return false;
    return isHttpUrl(value.replace(/%[sS]/g, "browser-toolbox-query"));
  }

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

    /**
     * 执行一个浏览器级命令。
     * @param {BrowserToolboxCommandInvocation} invocation 经过校验的调用。
     * @param {Object} [sender] Runtime 发送方上下文。
     * @returns {Promise<BrowserToolboxCommandResult>} 执行结果。
     */
    async execute(invocation, sender) {
      const tab = await this.getTab(invocation, sender);
      if (
        !tab &&
        !["BrowserToolbox.newWindow", "BrowserToolbox.openSettings"].includes(
          invocation.commandName,
        )
      ) {
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.NO_ACTIVE_TAB);
      }
      const context = invocation.context || {};
      switch (invocation.commandName) {
        case "BrowserToolbox.closeWindow":
          await chrome.windows.remove(tab.windowId);
          return invocationApi.createResult(true);
        case "BrowserToolbox.newWindow":
          await chrome.windows.create({
            url: context.linkUrl && invocationApi.isAllowedUrl(context.linkUrl)
              ? context.linkUrl
              : undefined,
          });
          return invocationApi.createResult(true);
        case "BrowserToolbox.toggleKeyboard":
          return this.toggleModule("keyboard", tab.url);
        case "BrowserToolbox.toggleMouseGestures":
          return this.toggleModule("mouse", tab.url);
        case "BrowserToolbox.toggleSuperDrag":
          return this.toggleModule("superDrag", tab.url);
        case "BrowserToolbox.showTabList":
          await chrome.tabs.create({ url: chrome.runtime.getURL("pages/tab_list.html") });
          return invocationApi.createResult(true);
        case "BrowserToolbox.openSettings":
          await chrome.tabs.create({ url: chrome.runtime.getURL("pages/mouse_options.html") });
          return invocationApi.createResult(true);
        case "BrowserToolbox.openTool": {
          const toolId = invocation.options?.toolId;
          const source = invocation.options?.source ||
            (invocation.options?.inputToken ? "selection" : "action");
          if (!toolRegistry?.get?.(toolId)) {
            return invocationApi.createResult(
              false,
              invocationApi.ERROR_CODES.INVALID_OPTIONS,
              "Unknown tool.",
            );
          }
          return toolLauncher.open(toolId, {
            token: invocation.options?.inputToken || "",
            source,
            tab,
          });
        }
        case "BrowserToolbox.searchSelection":
          return this.searchSelection(
            context.selectedText,
            invocation.options?.disposition,
            tab,
            invocation.options?.keyword,
          );
        case "BrowserToolbox.openLinkForeground":
        case "BrowserToolbox.openImageForeground":
          return this.openUrl(context.linkUrl || context.imageUrl, true, tab);
        case "BrowserToolbox.openLinkBackground":
        case "BrowserToolbox.openImageBackground":
          return this.openUrl(context.linkUrl || context.imageUrl, false, tab);
        case "BrowserToolbox.toggleFullscreen":
          return this.toggleWindowState(tab, "fullscreen");
        case "BrowserToolbox.minimizeWindow":
          return this.toggleWindowState(tab, "minimized");
        case "BrowserToolbox.maximizeWindow":
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
      const effective = this.repository.getEffectiveSettings(url).effectiveModules || {};
      return invocationApi.createResult(true, invocationApi.ERROR_CODES.OK, undefined, {
        enabled: effective[moduleName] !== false,
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

    /**
     * 将选中文本交给浏览器搜索或指定的本地搜索引擎。
     * @param {unknown} text 选中文本。
     * @param {string} [disposition] 打开位置。
     * @param {BrowserToolboxTabContext} [tab] 当前标签页。
     * @param {string} [keyword] 搜索引擎 keyword。
     * @returns {Promise<BrowserToolboxCommandResult>} 执行结果。
     */
    async searchSelection(text, disposition, tab, keyword) {
      if (typeof text !== "string" || text.trim().length === 0) {
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.NO_MATCHING_ELEMENT);
      }
      const query = text.trim();
      if (typeof keyword === "string" && keyword.trim().length > 0) {
        let config = "";
        try {
          config = await this.repository?.getSearchEngines?.();
        } catch (_) {
          // 配置仓库不可用时，下面的解析会安全拒绝未知 keyword。
        }
        if (typeof config !== "string") config = "";
        const engine = userSearchEngines.parseConfig(config).keywordToEngine[keyword.trim()];
        if (!engine || !isHttpSearchTemplate(engine.url)) {
          return invocationApi.createResult(
            false,
            invocationApi.ERROR_CODES.INVALID_OPTIONS,
            "Search engine keyword is unknown or unsafe.",
          );
        }
        const searchUrl = UrlUtils.createSearchUrl(query, engine.url);
        if (!isHttpUrl(searchUrl)) {
          return invocationApi.createResult(
            false,
            invocationApi.ERROR_CODES.BLOCKED_URL_SCHEME,
            searchUrl,
          );
        }
        return this.openUrl(searchUrl, disposition !== "background", tab);
      }
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
      const registry = globalThis.BrowserToolboxCommandRegistry?.getCommand(commandName);
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

  globalThis.BrowserToolboxBrowserCommandAdapter = BrowserCommandAdapter;
})();

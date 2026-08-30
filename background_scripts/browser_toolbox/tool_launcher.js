// 工具启动器：只根据静态注册表生成扩展内部 URL，不把输入内容放进 URL。
(function () {
  const registry = globalThis.BrowserToolboxToolRegistry;
  const invocationApi = globalThis.BrowserToolboxCommandInvocation;
  const tokenPattern = globalThis.BrowserToolboxToolInputTokenStore?.tokenPattern || /^[a-f0-9]{32}$/;

  function createToolUrl(toolId, { token = "", source = "action", notice = "" } = {}) {
    const descriptor = registry.get(toolId);
    if (!descriptor || !descriptor.allowedSources.includes(source)) return null;
    if (token && !tokenPattern.test(token)) return null;
    if (token && source !== "selection") return null;
    const url = new URL(chrome.runtime.getURL("pages/tools/index.html"));
    url.searchParams.set("tool", toolId);
    url.searchParams.set("source", source);
    if (token) url.searchParams.set("inputToken", token);
    if (["empty-selection", "selection-too-large"].includes(notice)) {
      url.searchParams.set("notice", notice);
    }
    return url.href;
  }

  class ToolLauncher {
    constructor({ tabs = chrome.tabs } = {}) {
      this.tabs = tabs;
    }

    async open(toolId, options = {}) {
      const url = createToolUrl(toolId, options);
      if (!url) {
        return invocationApi.createResult(
          false,
          invocationApi.ERROR_CODES.INVALID_OPTIONS,
          "Unknown tool or source.",
        );
      }
      const tab = options.tab;
      const created = await this.tabs.create({
        url,
        active: options.active !== false,
        index: tab?.index == null ? undefined : tab.index + 1,
      });
      return invocationApi.createResult(true, invocationApi.ERROR_CODES.OK, undefined, {
        toolId,
        tabId: created?.id,
      });
    }
  }

  globalThis.BrowserToolboxToolLauncher = Object.freeze({ ToolLauncher, createToolUrl });
  globalThis.BrowserToolboxToolLauncherInstance ||= new ToolLauncher();
})();

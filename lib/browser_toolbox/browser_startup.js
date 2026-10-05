// 浏览器启动导航的纯校验与标签页打开逻辑。
(function () {
  const MAX_URL_LENGTH = 2048;
  const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

  /**
   * 校验启动网址。
   * @param {unknown} value 待校验的配置值。
   * @returns {{ok: boolean, code?: string, url?: string}} 校验结果。
   */
  function validateUrl(value) {
    if (typeof value !== "string") return { ok: false, code: "type" };
    if (value.length > MAX_URL_LENGTH) return { ok: false, code: "too-long" };
    if (value === "") return { ok: true, url: "" };
    if (value !== value.trim()) return { ok: false, code: "whitespace" };
    try {
      const parsed = new URL(value);
      if (!HTTP_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) {
        return { ok: false, code: "protocol" };
      }
    } catch (_) {
      return { ok: false, code: "invalid" };
    }
    return { ok: true, url: value };
  }

  class BrowserStartupNavigator {
    /**
     * 创建启动导航器。
     * @param {Object} [dependencies] 可替换的浏览器 API，便于隔离测试。
     * @param {Object} [dependencies.tabsApi] tabs API。
     * @param {Object} [dependencies.windowsApi] windows API。
     * @param {Function} [dependencies.logger] 诊断日志函数。
     */
    constructor({
      tabsApi = globalThis.chrome?.tabs,
      windowsApi = globalThis.chrome?.windows,
      logger = () => {},
    } = {}) {
      this.tabsApi = tabsApi;
      this.windowsApi = windowsApi;
      this.logger = logger;
      this.handled = false;
    }

    /**
     * 在当前启动事件中打开配置网址至多一次。
     * @param {Object} settings BrowserToolbox 设置。
     * @returns {Promise<Object>} 打开结果。
     */
    async openConfiguredPage(settings) {
      if (this.handled) return { opened: false, reason: "already-handled" };
      this.handled = true;

      const startup = settings?.browserStartup;
      if (!startup?.enabled) return { opened: false, reason: "disabled" };
      const validation = validateUrl(startup.url);
      if (!validation.ok || !validation.url) {
        this.logger("browserStartup.url 校验失败，跳过启动导航。");
        return { opened: false, reason: "invalid-url" };
      }
      if (!this.tabsApi?.create || !this.windowsApi?.getAll || !this.windowsApi?.create) {
        this.logger("浏览器启动导航 API 不可用，跳过启动导航。");
        return { opened: false, reason: "api-unavailable" };
      }

      const windows = await this.windowsApi.getAll({ populate: false });
      const normalWindows = (Array.isArray(windows) ? windows : []).filter((window) =>
        window && window.type === "normal" && window.incognito !== true &&
        Number.isInteger(window.id)
      );
      const targetWindow = normalWindows.find((window) => window.focused) || normalWindows[0];
      if (targetWindow) {
        const tab = await this.tabsApi.create({
          windowId: targetWindow.id,
          url: validation.url,
          active: true,
        });
        return {
          opened: true,
          mode: "tab",
          windowId: targetWindow.id,
          tabId: tab?.id,
          url: validation.url,
        };
      }

      const window = await this.windowsApi.create({
        url: validation.url,
        type: "normal",
        focused: true,
      });
      return {
        opened: true,
        mode: "window",
        windowId: window?.id,
        url: validation.url,
      };
    }
  }

  globalThis.BrowserToolboxBrowserStartup = Object.freeze({
    MAX_URL_LENGTH,
    validateUrl,
    BrowserStartupNavigator,
  });
})();

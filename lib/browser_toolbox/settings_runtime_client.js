// 内容脚本的只读运行时配置客户端。有效配置由 Service Worker 计算，本地仓库只负责兜底。
/**
 * 内容脚本可读取的运行时设置。
 * @typedef {Object} BrowserToolboxRuntimeSettings
 * @property {Object} effectiveModules 有效模块状态。
 * @property {Object} [general] 常规设置。
 */
(function () {
  const schema = globalThis.BrowserToolboxSettingsSchema;
  const policy = globalThis.BrowserToolboxSettingsPolicy;
  const protocol = globalThis.BrowserToolboxMessageProtocol;
  const defaultRepository = globalThis.BrowserToolboxSettingsRepositoryInstance;
  // Service Worker 冷启动和并行读取 Vimium 配置可能超过半秒；子 frame 超时后只能安全关闭，
  // 因此给一次配置请求留出有限但足够的启动窗口，避免正常冷启动被误判为失联。
  const DEFAULT_TIMEOUT_MS = 2000;

  function currentUrl() {
    return globalThis.location?.href || "";
  }

  function defaultIsTopFrame() {
    if (!globalThis.window) return true;
    try {
      return globalThis.window.top === globalThis.window;
    } catch (_) {
      // 跨源窗口无法读取 top 时按非顶层 frame 处理，避免用 frame URL 绕过站点规则。
      return false;
    }
  }

  function failClosedSettings() {
    return policy.withEffectiveSettings({
      ...schema.DEFAULT_SETTINGS,
      general: { ...schema.DEFAULT_SETTINGS.general, enabled: false },
    });
  }

  function isEffectiveSettings(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const modules = value.effectiveModules;
    return modules && typeof modules === "object" && !Array.isArray(modules) &&
      Object.values(modules).every((enabled) => typeof enabled === "boolean");
  }

  function applyContentLocale(settings) {
    const language = settings?.general?.language;
    if (!schema.SUPPORTED_LANGUAGES.includes(language)) return;
    globalThis.BrowserToolboxI18n?.setLocale?.(language);
  }

  function applyContentTheme(settings) {
    globalThis.BrowserToolboxTheme?.applyTheme?.(settings?.general?.theme, globalThis.document);
  }

  /**
   * 为 Runtime 请求提供有限超时。
   * @param {Promise<unknown>|unknown} request Runtime 请求。
   * @param {number} timeoutMs 超时毫秒数。
   * @returns {Promise<unknown>} 请求结果或 null。
   */
  async function requestWithTimeout(request, timeoutMs) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    try {
      return await Promise.race([Promise.resolve(request), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  class SettingsRuntimeClient {
    constructor({
      runtimeApi = globalThis.chrome?.runtime,
      fallbackRepository = defaultRepository,
      requestTimeoutMs = DEFAULT_TIMEOUT_MS,
      isTopFrame = defaultIsTopFrame,
    } = {}) {
      this.runtimeApi = runtimeApi;
      this.fallbackRepository = fallbackRepository;
      this.requestTimeoutMs = requestTimeoutMs;
      this.isTopFrame = typeof isTopFrame === "function" ? isTopFrame : defaultIsTopFrame;
      this.settings = null;
      this.contextUrl = null;
      this.invalidationVersion = 0;
      this.refreshPromise = null;
      this.refreshContextUrl = null;
      this.listeners = new Set();
      this.readonlyListeners = new Set();
      this.defaultTopSnapshot = null;
      this.defaultChildSnapshot = null;
      this.messageListener = (message) => this.handleMessage(message);
      this.listenerInstalled = false;
      this.install();
    }

    install() {
      if (this.listenerInstalled || !this.runtimeApi?.onMessage?.addListener) return;
      this.runtimeApi.onMessage.addListener(this.messageListener);
      this.listenerInstalled = true;
    }

    /**
     * 确保指定顶层 URL 的有效配置已经加载。
     * @param {string} [context] 顶层 URL。
     * @returns {Promise<BrowserToolboxRuntimeSettings>} 有效配置。
     */
    async ensureLoaded(context = currentUrl(), options = {}) {
      const url = typeof context === "string" ? context : currentUrl();
      if (this.settings && this.contextUrl === url) return this.getSettings(options);
      return this.refresh(url, options);
    }

    /**
     * 刷新指定上下文的运行时配置。
     * @param {string} [context] 顶层 URL。
     * @param {{readonly?: boolean}} [options] 读取选项。
     * @returns {Promise<BrowserToolboxRuntimeSettings>} 最新配置。
     */
    async refresh(context = this.contextUrl || currentUrl(), options = {}) {
      const url = typeof context === "string" ? context : currentUrl();
      let promise = this.refreshPromise;
      if (promise) {
        if (this.refreshContextUrl !== url) {
          await promise.catch(() => {});
          promise = null;
        }
      }

      if (!promise) {
        promise = this.load(url);
        this.refreshPromise = promise;
        this.refreshContextUrl = url;
      }
      try {
        const snapshot = await promise;
        return options?.readonly ? snapshot : schema.clone(snapshot);
      } finally {
        if (this.refreshPromise === promise) {
          this.refreshPromise = null;
          this.refreshContextUrl = null;
        }
      }
    }

    async load(url) {
      while (true) {
        const version = this.invalidationVersion;
        let next = null;
        let fresh = false;
        const topFrame = this.isTopFrameContext();
        if (this.runtimeApi?.sendMessage) {
          try {
            const response = await requestWithTimeout(
              this.runtimeApi.sendMessage({ handler: "browserToolbox.effectiveSettings" }),
              this.requestTimeoutMs,
            );
            if (isEffectiveSettings(response)) next = response;
          } catch (_) {
            // Service Worker 不可用时继续走本地只读兜底，不阻断页面已有输入行为。
          }
        }
        // 顶层 Service Worker 失效时可以用当前页面 URL 兜底；子 frame 的 URL 可能不同源，
        // 不能让本地兜底根据它重新计算站点规则，否则会绕过顶层页面的停用配置。
        if (!next && topFrame && this.fallbackRepository) {
          try {
            await this.fallbackRepository.ensureLoaded();
            next = this.fallbackRepository.getEffectiveSettings(url);
            fresh = Boolean(next);
          } catch (_) {
            // 兜底存储也不可用时使用内存默认值，保持客户端的返回形状稳定。
          }
        }
        if (!next) {
          next = topFrame
            ? policy.withEffectiveSettings(schema.DEFAULT_SETTINGS, url)
            : failClosedSettings();
          fresh = true;
        }
        // 请求期间收到配置失效通知时丢弃旧结果，避免短暂恢复到过期配置。
        if (version !== this.invalidationVersion) continue;

        this.settings = fresh ? next : schema.clone(next);
        this.contextUrl = url;
        // 每次有效配置加载或热更新时同步语言与主题，确保网页 HUD 与设置页保持一致。
        applyContentLocale(this.settings);
        applyContentTheme(this.settings);
        this.emit();
        return this.settings;
      }
    }

    /**
     * 返回当前配置快照；尚未加载时按 frame 安全策略返回默认值。
     * @param {{readonly?: boolean}} [options] 读取选项。
     * @returns {BrowserToolboxRuntimeSettings} 配置快照。
     */
    getSettings({ readonly = false } = {}) {
      if (this.settings) return readonly ? this.settings : schema.clone(this.settings);
      // 内部只读消费方复用实例级默认快照，避免首屏监听器同步触发递归深克隆。
      if (this.isTopFrameContext()) {
        if (!readonly) return policy.withEffectiveSettings(schema.DEFAULT_SETTINGS);
        return (this.defaultTopSnapshot ||= policy.withEffectiveSettings(schema.DEFAULT_SETTINGS));
      }
      if (!readonly) return failClosedSettings();
      return (this.defaultChildSnapshot ||= failClosedSettings());
    }

    isTopFrameContext() {
      try {
        return this.isTopFrame() === true;
      } catch (_) {
        // 无法确认 frame 层级时默认关闭内容脚本功能。
        return false;
      }
    }

    addEventListener(listener, { readonly = false } = {}) {
      if (typeof listener !== "function") return;
      this.listeners.add(listener);
      if (readonly) this.readonlyListeners.add(listener);
    }

    removeEventListener(listener) {
      this.listeners.delete(listener);
      this.readonlyListeners.delete(listener);
    }

    invalidate() {
      this.invalidationVersion++;
      this.settings = null;
    }

    handleMessage(message) {
      if (
        !protocol?.validate?.(message) ||
        message.type !== "browserToolbox.settingsChanged"
      ) return false;
      this.invalidate();
      this.refresh(this.contextUrl || this.refreshContextUrl || currentUrl()).catch(() => {});
      return false;
    }

    emit() {
      for (const listener of this.listeners) {
        try {
          listener(this.getSettings({ readonly: this.readonlyListeners.has(listener) }));
        } catch (_) {
          // 单个内容脚本订阅者失败不能阻止其他模块获得新配置。
        }
      }
    }

    destroy() {
      if (this.listenerInstalled) {
        this.runtimeApi?.onMessage?.removeListener?.(this.messageListener);
      }
      this.listenerInstalled = false;
      this.listeners.clear();
      this.readonlyListeners.clear();
      this.settings = null;
      this.defaultTopSnapshot = null;
      this.defaultChildSnapshot = null;
      this.invalidationVersion++;
      this.refreshPromise = null;
      this.refreshContextUrl = null;
    }
  }

  globalThis.BrowserToolboxSettingsRuntimeClient = SettingsRuntimeClient;
  globalThis.BrowserToolboxSettingsRuntimeClientInstance ||= new SettingsRuntimeClient();
})();

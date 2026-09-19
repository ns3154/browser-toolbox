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
    const settings = schema.clone(schema.DEFAULT_SETTINGS);
    settings.general.enabled = false;
    return policy.withEffectiveSettings(settings);
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
    async ensureLoaded(context = currentUrl()) {
      const url = typeof context === "string" ? context : currentUrl();
      if (this.settings && this.contextUrl === url) return this.getSettings();
      return this.refresh(url);
    }

    /**
     * 刷新指定上下文的运行时配置。
     * @param {string} [context] 顶层 URL。
     * @returns {Promise<BrowserToolboxRuntimeSettings>} 最新配置。
     */
    async refresh(context = this.contextUrl || currentUrl()) {
      const url = typeof context === "string" ? context : currentUrl();
      if (this.refreshPromise) {
        if (this.refreshContextUrl === url) return this.refreshPromise;
        await this.refreshPromise.catch(() => {});
      }

      const promise = this.load(url);
      this.refreshPromise = promise;
      this.refreshContextUrl = url;
      try {
        return await promise;
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
          } catch (_) {
            // 兜底存储也不可用时使用内存默认值，保持客户端的返回形状稳定。
          }
        }
        if (!next) {
          next = topFrame
            ? policy.withEffectiveSettings(schema.DEFAULT_SETTINGS, url)
            : failClosedSettings();
        }
        // 请求期间收到配置失效通知时丢弃旧结果，避免短暂恢复到过期配置。
        if (version !== this.invalidationVersion) continue;

        this.settings = schema.clone(next);
        this.contextUrl = url;
        // 内容脚本运行在网页自己的隔离世界里，不能依赖设置页已经选择过语言。
        // 每次有效配置加载或热更新时同步语言，确保网页 HUD 与设置页保持一致。
        applyContentLocale(this.settings);
        this.emit();
        return this.getSettings();
      }
    }

    /**
     * 返回当前配置快照；尚未加载时按 frame 安全策略返回默认值。
     * @returns {BrowserToolboxRuntimeSettings} 配置快照。
     */
    getSettings() {
      return schema.clone(
        this.settings ||
          (this.isTopFrameContext()
            ? policy.withEffectiveSettings(schema.DEFAULT_SETTINGS)
            : failClosedSettings()),
      );
    }

    isTopFrameContext() {
      try {
        return this.isTopFrame() === true;
      } catch (_) {
        // 无法确认 frame 层级时默认关闭内容脚本功能。
        return false;
      }
    }

    addEventListener(listener) {
      if (typeof listener === "function") this.listeners.add(listener);
    }

    removeEventListener(listener) {
      this.listeners.delete(listener);
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
          listener(this.getSettings());
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
      this.settings = null;
      this.invalidationVersion++;
      this.refreshPromise = null;
      this.refreshContextUrl = null;
    }
  }

  globalThis.BrowserToolboxSettingsRuntimeClient = SettingsRuntimeClient;
  globalThis.BrowserToolboxSettingsRuntimeClientInstance ||= new SettingsRuntimeClient();
})();

// SPDX-License-Identifier: GPL-3.0-or-later
// Phase 1 只读适配：旧字段仍是权威来源，不创建迁移索引、快照或新的配置写入路径。
(function () {
  const clone = (value) => structuredClone(value);
  // Frame 会话包含按键映射树，使用纯 JS 浅层递归克隆避免 V8 structuredClone 序列化开销，同时保留配置测试的 structuredClone 计数契约。
  const cloneSession = (value) =>
    globalThis.BrowserToolboxValueUtils
      ? globalThis.BrowserToolboxValueUtils.clone(value)
      : structuredClone(value);
  class SettingsProvider {
    constructor({ legacy, runtimeSettings, repository, url }) {
      this.legacy = legacy;
      this.runtimeSettings = runtimeSettings;
      this.repository = repository;
      this.url = url;
      this.revision = 0;
      this.listeners = new Map();
      this.removers = [];
      this.snapshot = null;
      this.loading = null;
      this.generation = 0;
      this.sourceRevision = 0;
      this.publishedSourceRevision = -1;
      this.destroyed = false;
    }

    async load() {
      if (this.loading) return this.loading;
      const generation = this.generation;
      const loading = (async () => {
        for (;;) {
          const sourceRevision = this.sourceRevision;
          // 两个只读来源互不依赖；全部就绪且代次有效后才发布，避免串行增加每个文档的启动等待。
          const [, effective] = await Promise.all([
            this.legacy.onLoaded(),
            (async () => {
              if (this.runtimeSettings) return this.runtimeSettings.ensureLoaded(this.url());
              if (this.repository) {
                await this.repository.ensureLoaded();
                return this.repository.getEffectiveSettings(this.url());
              }
              return null;
            })(),
          ]);
          if (generation !== this.generation || this.destroyed) {
            throw new Error("SETTINGS_PROVIDER_CLOSED");
          }
          if (sourceRevision !== this.sourceRevision) continue;
          // 白名单来自旧版本默认字段，不能把 Settings.getSettings() 中的 Mark、会话或其他扩展数据当作配置。
          const keyboard = {};
          for (const key of Object.keys(this.legacy.defaultOptions)) {
            keyboard[key] = this.legacy.get(key);
          }
          const value = {
            keyboard,
            effective,
            sourceVersion: "2.4.2",
            configurationRevision: this.legacy.configurationRevision || null,
          };
          // 首次没有旧快照可比较，直接发布；热更新仍逐值比较并保持最小revision。
          if (!this.snapshot || JSON.stringify(value) !== JSON.stringify(this.value)) {
            this.value = value;
            this.snapshot = { ...value, revision: ++this.revision };
            for (const [listener, when] of this.listeners) {
              if (!when || when()) listener(clone(this.snapshot));
            }
          }
          this.publishedSourceRevision = sourceRevision;
          this.installSubscriptions();
          return clone(this.snapshot);
        }
      })();
      this.loading = loading;
      try {
        return await loading;
      } finally {
        if (this.loading === loading) this.loading = null;
      }
    }

    installSubscriptions() {
      if (this.removers.length || this.destroyed) return;
      const refresh = () => {
        this.sourceRevision++;
        // 在途读取不能吞掉后到的通知；即使通知落在Promise结束窗口，也在清除loading后补读。
        this.load().then(() => {
          if (!this.destroyed && this.publishedSourceRevision !== this.sourceRevision) return this.load();
        }).catch(() => {});
      };
      this.legacy.addEventListener("change", refresh);
      this.removers.push(() => this.legacy.removeEventListener("change", refresh));
      const source = this.runtimeSettings || this.repository;
      if (source) {
        source.addEventListener(refresh);
        this.removers.push(() => source.removeEventListener(refresh));
      }
    }

    getEffective() {
      return this.snapshot ? clone(this.snapshot) : null;
    }

    subscribe(listener, { when = null } = {}) {
      this.listeners.set(listener, when);
      return () => this.listeners.delete(listener);
    }

    invalidate() {
      this.generation++;
      this.loading = null;
    }

    destroy() {
      this.destroyed = true;
      this.generation++;
      for (const remove of this.removers.splice(0)) remove();
      this.listeners.clear();
    }
  }

  class InitialContext {
    constructor({ provider, bridge, resources, eventTarget, url }) {
      Object.assign(this, { provider, bridge, url });
      this.initialUrl = url();
      this.invalidated = this.claimed = this.closed = false;
      // 只把首读与后续脚本的编译重叠；这里不创建引擎、不取得输入执行权。
      this.removePagehide = resources.listen(eventTarget, "pagehide", () => this.invalidate());
      this.removeCleanup = resources.add(() => {
        if (this.claimed) return;
        this.closed = true;
        this.provider.destroy();
        this.bridge.destroy();
      });
      this.ready = bridge.initializeFrame();
      this.ready.catch(() => {});
      const generation = provider.generation;
      this.settings = provider.load().then((snapshot) => ({ snapshot, generation }));
      this.settings.catch(() => {});
    }

    invalidate() {
      if (this.invalidated) return;
      this.invalidated = true;
      this.bridge.invalidateSession();
      this.provider.invalidate();
    }

    claim() {
      if (this.closed) throw new Error("INITIAL_CONTEXT_CLOSED");
      if (this.claimed) throw new Error("INITIAL_CONTEXT_ALREADY_CLAIMED");
      if (this.initialUrl !== this.url()) this.invalidate();
      this.claimed = true;
      this.removePagehide();
      this.removeCleanup();
      // 领取后由Host接管文档生命周期；设置按当前版本领取，不能复用预读后已失效的快照。
      return {
        provider: this.provider,
        bridge: this.bridge,
        ready: this.invalidated ? null : this.ready,
        readSettings: () => this.readSettings(),
      };
    }

    async readSettings() {
      const { snapshot, generation } = await this.settings;
      const provider = this.provider;
      if (
        !this.invalidated && generation === provider.generation &&
        snapshot.revision === provider.revision &&
        provider.sourceRevision === provider.publishedSourceRevision
      ) return snapshot;
      return provider.load();
    }
  }

  class FrameRuntimeBridge {
    constructor(runtimeApi, timeoutMs = 3000) {
      this.runtimeApi = runtimeApi;
      this.timeoutMs = timeoutMs;
      this.generation = 0;
      this.pending = null;
      this.session = null;
      this.destroyed = false;
    }

    async initializeFrame() {
      if (this.destroyed) throw new Error("FRAME_BRIDGE_CLOSED");
      if (this.pending) return this.pending;
      const generation = ++this.generation;
      let timer;
      const pending = Promise.race([
        this.runtimeApi.sendMessage(
          this.useV2()
            ? BrowserToolboxMessageProtocol.envelope("lifecycle", "initialize", {
              runtimeEpoch: (globalThis.BrowserToolboxRuntimeHostInstance?.runtimeEpoch || 0) +
                (globalThis.BrowserToolboxRuntimeHostInstance?.engine ? 0 : 1),
            })
            : { handler: "initializeFrame" },
        ),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("FRAME_HANDSHAKE_TIMEOUT")), this.timeoutMs);
          this.cancelInitialization = () => reject(new Error("FRAME_BRIDGE_CLOSED"));
        }),
      ]).then((response) => {
        if (this.destroyed || generation !== this.generation) {
          throw new Error("STALE_FRAME_HANDSHAKE");
        }
        if (
          !response || !Number.isInteger(response.frameId) ||
          typeof response.isEnabledForUrl !== "boolean"
        ) throw new Error("INVALID_FRAME_SESSION");
        this.session = cloneSession(response);
        return cloneSession(response);
      }).finally(() => {
        clearTimeout(timer);
        if (this.pending === pending) {
          this.pending = null;
          this.cancelInitialization = null;
        }
      });
      this.pending = pending;
      return pending;
    }

    sendToTopFrame(message) {
      return this.sendToFrame(0, message);
    }

    async registerSession(context, runtimeEpoch) {
      if (!this.useV2() || !context.documentId) return context;
      if (
        this.session?.documentId === context.documentId &&
        this.session.runtimeEpoch === runtimeEpoch
      ) return { ...context, ...cloneSession(this.session) };
      const message = BrowserToolboxMessageProtocol.envelope("lifecycle", "register", {
        runtimeEpoch,
      });
      const response = await this.runtimeApi.sendMessage(message);
      if (!response?.ok) throw new Error(response?.code || "FRAME_AUTHORITY_UNAVAILABLE");
      if (
        response.session.documentId !== context.documentId ||
        response.session.runtimeEpoch !== runtimeEpoch
      ) throw new Error("INVALID_FRAME_SESSION");
      this.session = { ...context, ...response.session };
      return cloneSession(this.session);
    }

    invalidateSession() {
      this.generation++;
      this.session = null;
      const cancel = this.cancelInitialization;
      this.pending = null;
      this.cancelInitialization = null;
      cancel?.();
    }

    useV2() {
      return typeof this.runtimeApi.id === "string" && !globalThis.isUnitTests &&
        !globalThis.vimiumDomTestsAreRunning &&
        !this.runtimeApi.getURL?.("").startsWith("moz-extension:");
    }
    identity() {
      const host = globalThis.BrowserToolboxRuntimeHostInstance;
      return {
        documentId: host?.context.documentId,
        runtimeEpoch: host?.runtimeEpoch,
        incognito: host?.context.incognito === true,
      };
    }
    lifecycle(action, payload = {}) {
      return this.runtimeApi.sendMessage(
        BrowserToolboxMessageProtocol.envelope("lifecycle", action, payload, this.identity()),
      );
    }
    ready() {
      return this.useV2()
        ? this.lifecycle("ready")
        : this.runtimeApi.sendMessage({ handler: "domReady" });
    }
    hints(operation, input) {
      return this.useV2()
        ? this.lifecycle("hints", { ...input, operation })
        : this.runtimeApi.sendMessage({
          ...input,
          handler: operation === "prepare"
            ? "prepareToActivateLinkHintsMode"
            : "broadcastLinkHintsMessage",
        });
    }

    sendToFrame(frameId, message) {
      return this.useV2()
        ? this.lifecycle("relay", { frameId, message })
        : this.runtimeApi.sendMessage({ handler: "sendMessageToFrames", frameId, message });
    }

    async broadcastToTab(message) {
      return this.useV2()
        ? this.lifecycle("relay", { message })
        : this.runtimeApi.sendMessage({ handler: "sendMessageToFrames", message });
    }

    destroy() {
      this.destroyed = true;
      this.generation++;
      this.session = null;
      this.cancelInitialization?.();
    }
  }

  class KeyboardEngine {
    constructor({ installModes, cleanup, handlerStack, applySettings, pageExecutor }) {
      Object.assign(this, { installModes, cleanup, handlerStack, applySettings, pageExecutor });
      this.active = false;
    }

    async initialize(context) {
      // 提示 Canary 延迟编译本地旧核心；准备回退时先安装，仍由同一 Host 管理模式和事件。
      await globalThis.BrowserToolboxLoadCompatibleHints?.();
      this.context = context;
    }

    activate() {
      this.active = true;
      this.installModes();
    }

    async setEffectiveSettings(snapshot, reason) {
      this.applySettings(snapshot, reason);
    }

    handleKeyEvent(event) {
      return this.handleEvent(event.type, event);
    }

    handleEvent(type, event) {
      return this.handlerStack.decideEvent(type, event);
    }

    executeCommand(invocation) {
      return this.pageExecutor.execute(invocation);
    }

    async destroy(reason) {
      if (!this.active) return;
      this.active = false;
      this.cleanup(reason);
    }

    getDiagnostics() {
      return { initializationState: this.active ? "active" : "disabled" };
    }
  }

  globalThis.BrowserToolboxCompatRuntime = Object.freeze({
    SettingsProvider,
    FrameRuntimeBridge,
    KeyboardEngine,
    InitialContext,
  });
  // 只有独立Canary的活动网页预读；默认兼容包、公开组件和预渲染仍沿用原授权入口。
  if (
    globalThis.BrowserToolboxRuntimePlans?.COMPILED_CANARY &&
    !globalThis.isUnitTests && !globalThis.vimiumDomTestsAreRunning &&
    globalThis.document && /^(https?|file):$/.test(location.protocol) &&
    !document.prerendering && !globalThis.BrowserToolboxDocumentResources?.closed
  ) {
    const provider = new SettingsProvider({
      legacy: globalThis.BrowserToolboxVimiumSettingsAdapterInstance,
      runtimeSettings: globalThis.BrowserToolboxSettingsRuntimeClientInstance,
      repository: globalThis.BrowserToolboxSettingsRepositoryInstance,
      url: () => location.href,
    });
    const bridge = new FrameRuntimeBridge(chrome.runtime);
    globalThis.BrowserToolboxInitialRuntimeContext = new InitialContext({
      provider, bridge, resources: BrowserToolboxDocumentResources,
      eventTarget: globalThis, url: () => location.href,
    });
  }
})();

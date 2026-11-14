// SPDX-License-Identifier: GPL-3.0-or-later
// 文档只有一个输入所有者；模块准备与事件分配分离，失败先释放输入再清理资源。
(function () {
  class ResourceScope {
    constructor() {
      this.entries = new Map();
      this.closed = false;
    }

    add(dispose, kind = "subscription") {
      if (this.closed) {
        dispose();
        return () => {};
      }
      const token = {};
      const remove = () => {
        if (!this.entries.delete(token)) return;
        dispose();
      };
      this.entries.set(token, { kind, remove });
      return remove;
    }

    listen(target, type, callback, capture = true) {
      target.addEventListener(type, callback, capture);
      return this.add(() => target.removeEventListener(type, callback, capture), "listener");
    }

    timeout(callback, ms) {
      let remove;
      const id = setTimeout(() => {
        remove();
        if (!this.closed) callback();
      }, ms);
      remove = this.add(() => clearTimeout(id), "timer");
      return id;
    }

    dispose() {
      this.closed = true;
      const errors = [];
      for (const entry of [...this.entries.values()].reverse()) {
        try {
          entry.remove();
        } catch (_) {
          errors.push("RESOURCE_CLEANUP_FAILED");
        }
      }
      return errors;
    }

    counts() {
      const counts = {};
      for (const { kind } of this.entries.values()) counts[kind] = (counts[kind] || 0) + 1;
      return counts;
    }
  }

  const COMPAT_PLAN = Object.freeze({
    planVersion: 1,
    keyboardEngine: "vimium-compat",
    moduleImplementations: Object.freeze({
      input: "vimium-compat",
      hints: "vimium-compat",
      find: "vimium-compat",
      visual: "vimium-compat",
      ui: "vimium-compat",
    }),
  });
  const INPUT_EVENTS = Object.freeze([
    "keydown",
    "keypress",
    "keyup",
    "click",
    "focus",
    "blur",
    "mousedown",
    "scroll",
  ]);
  const PASS = Object.freeze({
    preventDefault: false,
    stopPropagation: false,
    consumeKeyup: false,
  });

  function validatePlan(plan) {
    return plan?.planVersion === COMPAT_PLAN.planVersion &&
      plan.keyboardEngine === COMPAT_PLAN.keyboardEngine &&
      JSON.stringify(plan.moduleImplementations) ===
        JSON.stringify(COMPAT_PLAN.moduleImplementations);
  }

  class RuntimeHost {
    constructor({
      eventTarget,
      documentTarget,
      engineFactory,
      applyDecision,
      isContextValid = () => true,
      beforeEvent = () => {},
      onLifecycle = () => {},
      authorizeContext = async (context) => context,
      documentResources = new ResourceScope(),
      allowedPlans = [COMPAT_PLAN],
    }) {
      this.eventTarget = eventTarget;
      this.documentTarget = documentTarget;
      this.engineFactory = engineFactory;
      this.applyDecision = applyDecision;
      this.isContextValid = isContextValid;
      this.beforeEvent = beforeEvent;
      this.onLifecycle = onLifecycle;
      this.authorizeContext = authorizeContext;
      this.documentResources = documentResources;
      this.allowedPlans = allowedPlans;
      this.eventResources = new ResourceScope();
      this.observers = new Map();
      this.engine = null;
      this.engineResources = null;
      this.deactivation = null;
      this.prepared = new WeakSet();
      this.preparedRuntimes = new Set();
      this.runtimeEpoch = 0;
      this.interactionEpoch = 0;
      this.state = "disabled";
      this.lastErrorCode = null;
      this.lastSettingsRevision = 0;
      this.plan = COMPAT_PLAN;
      this.context = {};
      this.disposed = false;
      this.suspended = false;
      this.transition = Promise.resolve();
      this.mount();
    }

    mount() {
      if (this.mounted || this.disposed) return;
      this.mounted = true;
      for (const type of INPUT_EVENTS) {
        this.eventResources.listen(this.eventTarget, type, (event) => this.dispatch(type, event));
      }
      this.eventResources.listen(
        this.documentTarget,
        "DOMActivate",
        (event) => this.dispatch("DOMActivate", event),
      );
      for (const type of ["hashchange", "pagehide", "pageshow", "prerenderingchange"]) {
        const target = type === "prerenderingchange" ? this.documentTarget : this.eventTarget;
        this.eventResources.listen(target, type, (event) => {
          if (type === "pagehide") this.suspended = true;
          this.onLifecycle(type, event);
        });
      }
    }

    observe(type, listener) {
      const listeners = this.observers.get(type) || new Set();
      this.observers.set(type, listeners);
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    dispatch(type, event) {
      if (
        this.disposed || (!globalThis.isUnitTests && !globalThis.vimiumDomTestsAreRunning &&
          event.isTrusted !== true)
      ) return PASS;
      if (!this.isContextValid()) {
        this.lastErrorCode = "EXTENSION_CONTEXT_LOST";
        this.dispose("context-lost");
        return PASS;
      }
      try {
        this.beforeEvent(type, event);
        for (const listener of this.observers.get(type) || []) listener(event);
        if (this.state !== "active" || this.suspended || this.documentTarget.prerendering) {
          return PASS;
        }
        if (
          type === "keydown" && event.key === "Escape" && !event.isComposing &&
          event.keyCode !== 229
        ) this.interactionEpoch++;
        const decision = type.startsWith("key")
          ? this.engine.handleKeyEvent(event)
          : this.engine.handleEvent(type, event);
        // Promise 不能承担吞键决定，异步实现出错时直接进入释放输入的失败状态。
        if (!decision || typeof decision.then === "function") {
          throw new Error("ASYNC_EVENT_DECISION");
        }
        this.applyDecision(type, event, decision);
        return decision;
      } catch (_) {
        this.lastErrorCode = "EVENT_DISPATCH_FAILED";
        this.deactivate("event-failed");
        return PASS;
      }
    }

    markInitializationStage(stage) {
      // 只保留当前初始化各阶段的耗时，不保存页面数据、输入或跨文档历史。
      if (
        ![
          "ui-authorization",
          "register-listeners",
          "read-context",
          "prepare-engine",
          "activate-engine",
          "apply-settings",
          "ready",
        ].includes(stage)
      ) return;
      const now = performance.now();
      if (["ui-authorization", "read-context"].includes(stage)) {
        this.initializationTimings = {};
        this.initializationTimingStage = null;
      }
      if (this.initializationTimingStage) {
        this.initializationTimings[this.initializationTimingStage] =
          Math.round((now - this.initializationTimingStarted) * 1000) / 1000;
      }
      this.initializationStage = this.initializationTimingStage = stage;
      this.initializationTimingStarted = now;
    }

    async prepare(plan, settingsRevision, context = this.context) {
      if (this.disposed) throw new Error("RUNTIME_DISPOSED");
      const canonical = this.allowedPlans.find((item) =>
        item.planVersion === plan?.planVersion &&
        item.keyboardEngine === plan.keyboardEngine &&
        JSON.stringify(item.moduleImplementations) === JSON.stringify(plan.moduleImplementations)
      );
      if (!canonical) throw new Error("UNVERIFIED_RUNTIME_PLAN");
      const engine = this.engineFactory(canonical);
      const resources = new ResourceScope();
      try {
        await engine.initialize(context, resources);
        if (this.disposed) throw new Error("RUNTIME_DISPOSED");
      } catch (error) {
        resources.dispose();
        await engine.destroy("prepare-failed");
        this.lastErrorCode = "INITIALIZATION_FAILED";
        throw error;
      }
      const prepared = { plan: canonical, settingsRevision, context, engine, resources };
      this.prepared.add(prepared);
      this.preparedRuntimes.add(prepared);
      return prepared;
    }

    activate(prepared) {
      const action = async () => {
        if (this.disposed || !this.prepared.delete(prepared)) {
          throw new Error("INVALID_PREPARED_RUNTIME");
        }
        this.preparedRuntimes.delete(prepared);
        if (this.suspended) {
          prepared.resources.dispose();
          await prepared.engine.destroy("document-suspended");
          throw new Error("DOCUMENT_SUSPENDED");
        }
        await this.deactivate("activation");
        this.state = "initializing";
        this.runtimeEpoch++;
        this.context = prepared.context;
        this.plan = prepared.plan;
        this.lastSettingsRevision = prepared.settingsRevision;
        this.engine = prepared.engine;
        this.engineResources = prepared.resources;
        try {
          this.context = await this.authorizeContext(this.context, this.runtimeEpoch);
          if (
            this.context.planVersion != null && this.context.planVersion !== this.plan.planVersion
          ) {
            throw new Error("RUNTIME_PLAN_MISMATCH");
          }
          await this.engine.activate(this.context, this.engineResources);
          if (this.disposed || this.suspended) {
            await this.deactivate("document-inactive-during-activation");
            return this.getDiagnostics();
          }
          this.state = "active";
          this.lastErrorCode = null;
        } catch (error) {
          await this.deactivate("activation-failed");
          this.state = "failed";
          this.lastErrorCode = "ACTIVATION_FAILED";
          throw error;
        }
        return this.getDiagnostics();
      };
      const result = this.transition.then(action);
      this.transition = result.catch(() => {});
      return result;
    }

    async setEffectiveSettings(snapshot, reason) {
      if (this.disposed || !this.engine) return;
      this.lastSettingsRevision = snapshot.revision;
      await this.engine.setEffectiveSettings(snapshot, reason);
    }

    deactivate(reason) {
      if (this.deactivation) return this.deactivation;
      // 同步撤销执行权，尚在等待的清理过程不会继续吞掉网页事件。
      this.state = "deactivating";
      this.interactionEpoch++;
      const engine = this.engine;
      const resources = this.engineResources;
      this.engine = this.engineResources = null;
      if (resources?.dispose().length) this.lastErrorCode = "RESOURCE_CLEANUP_FAILED";
      // 合并并发停用；新的激活必须等旧引擎清理完成，避免迟到清理覆盖新状态。
      let finish;
      const pending = new Promise((resolve) => finish = resolve);
      this.deactivation = pending;
      (async () => {
        try {
          await engine?.destroy(reason);
        } catch (_) {
          this.lastErrorCode = "ENGINE_CLEANUP_FAILED";
        }
        this.state = "disabled";
        if (this.deactivation === pending) this.deactivation = null;
        finish();
      })();
      return pending;
    }

    async dispose(reason) {
      if (this.disposed) return;
      this.disposed = true;
      if (this.eventResources.dispose().length + this.documentResources.dispose().length) {
        this.lastErrorCode = "RESOURCE_CLEANUP_FAILED";
      }
      this.observers.clear();
      for (const prepared of this.preparedRuntimes) {
        prepared.resources.dispose();
        try {
          await prepared.engine.destroy(reason);
        } catch (_) {
          this.lastErrorCode = "ENGINE_CLEANUP_FAILED";
        }
      }
      this.preparedRuntimes.clear();
      await this.deactivate(reason);
    }

    getDiagnostics({ includeIdentity = false } = {}) {
      const result = {
        engineName: this.plan.keyboardEngine,
        engineVersion: this.engine?.version ||
          (this.plan.planVersion === 1 ? "2.4.2-adapter.1" : "input-canary.1"),
        runtimeEpoch: this.runtimeEpoch,
        planVersion: this.plan.planVersion,
        listenerOwner: this.mounted && !this.disposed ? "BrowserToolbox.RuntimeHost" : null,
        initializationState: this.state,
        initializationStage: this.initializationStage || null,
        initializationTimings: { ...this.initializationTimings },
        lastSettingsRevision: this.lastSettingsRevision,
        lastErrorCode: this.lastErrorCode,
        lastFailureStage: this.lastFailureStage || null,
        resources: {
          events: this.eventResources.counts(),
          document: this.documentResources.counts(),
          engine: this.engineResources?.counts() || {},
        },
      };
      if (includeIdentity) {
        result.frameId = this.context.frameId ?? null;
        result.documentId = this.context.documentId ?? null;
        result.isTopFrame = this.context.frameId === 0;
      }
      return result;
    }
  }

  globalThis.BrowserToolboxRuntime = Object.freeze({
    ResourceScope,
    RuntimeHost,
    COMPAT_PLAN,
    INPUT_EVENTS,
    PASS,
    validatePlan,
  });
  // 库的会话订阅属于文档而非某次模式激活；停用引擎仍保留订阅，文档销毁时统一释放。
  globalThis.BrowserToolboxDocumentResources ||= new ResourceScope();
})();

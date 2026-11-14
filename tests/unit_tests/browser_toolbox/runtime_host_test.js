// 运行时的故障注入使用合成事件和资源，检查副作用、吞键决定与注销结果。
import "../test_helper.js";
import "../../../lib/browser_toolbox/runtime_host.js";
import "../../../lib/browser_toolbox/compat_runtime.js";
import "../../../lib/handler_stack.js";

const { RuntimeHost, ResourceScope, COMPAT_PLAN } = BrowserToolboxRuntime;

context("RuntimeHost 输入所有权与故障恢复", () => {
  function target() {
    const listeners = new Map();
    return {
      listeners,
      addEventListener(type, fn) {
        const set = listeners.get(type) || new Set();
        set.add(fn);
        listeners.set(type, set);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
      fire(type, event = { type, isTrusted: true }) {
        for (const fn of listeners.get(type) || []) fn(event);
      },
      size() {
        return [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
      },
    };
  }

  function harness({ activateFails = false, prepareFails = false, asyncDecision = false } = {}) {
    const window = target();
    const document = target();
    let executions = 0;
    let activeResources = 0;
    let contextValid = true;
    const decisions = [];
    const host = new RuntimeHost({
      eventTarget: window,
      documentTarget: document,
      isContextValid: () => contextValid,
      applyDecision: (_type, _event, decision) => decisions.push(decision),
      engineFactory: () => ({
        initialize(_context, scope) {
          activeResources++;
          scope.add(() => activeResources--);
          if (prepareFails) throw new Error("合成准备失败");
        },
        activate() {
          if (activateFails) throw new Error("合成激活失败");
        },
        handleKeyEvent() {
          executions++;
          const result = { preventDefault: true, stopPropagation: true, consumeKeyup: true };
          return asyncDecision ? Promise.resolve(result) : result;
        },
        handleEvent() {
          return BrowserToolboxRuntime.PASS;
        },
        setEffectiveSettings() {},
        destroy() {},
      }),
    });
    return {
      host,
      window,
      document,
      decisions,
      executions: () => executions,
      resources: () => activeResources,
      loseContext: () => contextValid = false,
    };
  }

  should("准备不取得执行权，激活后同步返回配对 keyup 的吞键决定", async () => {
    const h = harness();
    h.window.fire("keydown");
    const prepared = await h.host.prepare(COMPAT_PLAN, 1, { frameId: 0, documentId: "synthetic" });
    h.window.fire("keydown");
    assert.equal(0, h.executions());
    await h.host.activate(prepared);
    h.window.fire("keydown");
    assert.equal(1, h.executions());
    assert.equal(
      [{ preventDefault: true, stopPropagation: true, consumeKeyup: true }],
      h.decisions,
    );
    await h.host.dispose("test");
    assert.equal(0, h.window.size() + h.document.size() + h.resources());
  });

  should("重复 mount 与连续 100 次激活不增加监听器或重复执行", async () => {
    const h = harness();
    const listenerCount = h.window.size() + h.document.size();
    for (let index = 0; index < 100; index++) {
      h.host.mount();
      await h.host.activate(await h.host.prepare(COMPAT_PLAN, index));
      h.window.fire("keydown");
      assert.equal(index + 1, h.executions());
      assert.equal(listenerCount, h.window.size() + h.document.size());
      assert.equal(1, h.resources());
    }
    await h.host.dispose("test");
    await h.host.dispose("test-again");
    assert.equal(0, h.window.size() + h.document.size() + h.resources());
  });

  should("旧引擎清理未完成时，新引擎不能提前激活或被迟到清理停用", async () => {
    const h = harness();
    await h.host.activate(await h.host.prepare(COMPAT_PLAN, 1));
    let finishCleanup;
    h.host.engine.destroy = () => new Promise((resolve) => finishCleanup = resolve);
    const pause = h.host.deactivate("maintenance-pause");
    let activated = false;
    const recovery = h.host.activate(await h.host.prepare(COMPAT_PLAN, 2)).then(() => {
      activated = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const beforeCleanup = { activated, state: h.host.state };
    finishCleanup();
    await Promise.all([pause, recovery]);
    const finalState = h.host.state;
    await h.host.dispose("test");
    assert.equal({ activated: false, state: "deactivating" }, beforeCleanup);
    assert.equal("active", finalState);
  });

  should("清理同步触发重入停用时，重入调用也必须等待原清理", async () => {
    const h = harness();
    await h.host.activate(await h.host.prepare(COMPAT_PLAN, 1));
    let finishCleanup, nestedFinished = false;
    h.host.engine.destroy = () => {
      h.host.deactivate("nested").then(() => nestedFinished = true);
      return new Promise((resolve) => finishCleanup = resolve);
    };
    const pause = h.host.deactivate("maintenance-pause");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const beforeCleanup = { nestedFinished, state: h.host.state };
    finishCleanup();
    await pause;
    await h.host.dispose("test");
    assert.equal({ nestedFinished: false, state: "deactivating" }, beforeCleanup);
  });

  should("未登记模块组合不能破坏当前兼容方案", async () => {
    const h = harness();
    await h.host.activate(await h.host.prepare(COMPAT_PLAN, 1));
    let rejected = false;
    try {
      await h.host.prepare({ ...COMPAT_PLAN, keyboardEngine: "browser-toolbox" }, 2);
    } catch (_) {
      rejected = true;
    }
    h.window.fire("keydown");
    assert.isTrue(rejected);
    assert.equal(1, h.executions());
    await h.host.dispose("test");
  });

  for (const failure of ["prepareFails", "activateFails"]) {
    should(`${failure} 失败后释放所有临时资源并放行页面输入`, async () => {
      const h = harness({ [failure]: true });
      let rejected = false;
      try {
        await h.host.activate(await h.host.prepare(COMPAT_PLAN, 1));
      } catch (_) {
        rejected = true;
      }
      h.window.fire("keydown");
      assert.isTrue(rejected);
      assert.equal(0, h.resources());
      assert.equal(0, h.decisions.length);
      await h.host.dispose("test");
    });
  }

  should("异步吞键决定被拒绝且不 suppress 原生事件", async () => {
    const h = harness({ asyncDecision: true });
    await h.host.activate(await h.host.prepare(COMPAT_PLAN, 1));
    h.window.fire("keydown");
    assert.equal(0, h.decisions.length);
    assert.equal("EVENT_DISPATCH_FAILED", h.host.getDiagnostics().lastErrorCode);
    await h.host.dispose("test");
  });

  should("后台扩展上下文失效时同步撤销所有监听器并放行按键", async () => {
    const h = harness();
    await h.host.activate(await h.host.prepare(COMPAT_PLAN, 1));
    h.loseContext();
    h.window.fire("keydown");
    assert.equal(0, h.executions());
    assert.equal(0, h.window.size() + h.document.size());
    assert.equal("EXTENSION_CONTEXT_LOST", h.host.getDiagnostics().lastErrorCode);
    await h.host.dispose("test");
  });

  should("pagehide 与预渲染不执行命令，诊断不导出关联身份", async () => {
    const h = harness();
    await h.host.activate(
      await h.host.prepare(COMPAT_PLAN, 1, {
        frameId: 0,
        documentId: "synthetic",
        url: "sensitive",
        secret: "sensitive",
      }),
    );
    h.document.prerendering = true;
    h.window.fire("keydown");
    h.document.prerendering = false;
    h.window.fire("pagehide");
    h.window.fire("keydown");
    assert.equal(0, h.executions());
    const diagnostics = h.host.getDiagnostics();
    assert.isFalse("documentId" in diagnostics);
    assert.isFalse(JSON.stringify(diagnostics).includes("sensitive"));
    assert.equal("synthetic", h.host.getDiagnostics({ includeIdentity: true }).documentId);
    await h.host.dispose("test");
  });

  should("清理注销器抛错不阻止其余资源释放，定时任务不能迟到执行", async () => {
    const scope = new ResourceScope();
    let calls = 0;
    scope.add(() => calls++);
    scope.add(() => {
      throw new Error("合成清理失败");
    });
    scope.timeout(() => calls += 100, 0);
    assert.equal(["RESOURCE_CLEANUP_FAILED"], scope.dispose());
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(1, calls);
    assert.equal({}, scope.counts());
  });

  should("pagehide 后迟到的准备结果不能重新取得执行权", async () => {
    const h = harness();
    const prepared = await h.host.prepare(COMPAT_PLAN, 1);
    h.window.fire("pagehide");
    let rejected = false;
    try {
      await h.host.activate(prepared);
    } catch (_) {
      rejected = true;
    }
    h.window.fire("keydown");
    assert.isTrue(rejected);
    assert.equal(0, h.executions());
    assert.equal(0, h.resources());
    await h.host.dispose("test");
  });
});

context("只读配置与 frame 适配", () => {
  should("等待旧设置时有效配置再次更新，必须重读而不能丢掉键盘开关通知", async () => {
    let effective = { effectiveModules: { keyboard: true } }, releaseLegacy, pendingLegacy = false;
    const callbacks = new Set(), published = [];
    const provider = new BrowserToolboxCompatRuntime.SettingsProvider({
      legacy: {
        defaultOptions: { keyMappings: "" },
        onLoaded: () =>
          pendingLegacy ? new Promise((resolve) => releaseLegacy = resolve) : Promise.resolve(),
        get: () => "",
        addEventListener() {},
        removeEventListener() {},
      },
      runtimeSettings: {
        ensureLoaded: async () => structuredClone(effective),
        addEventListener: (fn) => callbacks.add(fn),
        removeEventListener: (fn) => callbacks.delete(fn),
      },
      url: () => "合成页面",
    });
    await provider.load();
    provider.subscribe((value) => published.push(value.effective.effectiveModules.keyboard));
    pendingLegacy = true;
    const loading = provider.load();
    await Promise.resolve();
    effective = { effectiveModules: { keyboard: false } };
    for (const fn of callbacks) fn();
    pendingLegacy = false;
    releaseLegacy();
    assert.isFalse((await loading).effective.effectiveModules.keyboard);
    assert.equal([false], published);
    assert.isFalse(provider.getEffective().effective.effectiveModules.keyboard);
    provider.destroy();
    assert.equal(0, callbacks.size);
  });
  should("两路只读配置并行，未全部就绪和失效代次都不能发布", async () => {
    let releaseLegacy;
    let releaseEffective;
    let effectiveStarted = false;
    const legacy = {
      defaultOptions: { keyMappings: "" },
      onLoaded: () => new Promise((resolve) => releaseLegacy = resolve),
      get: () => "map j scrollUp",
      addEventListener() {},
      removeEventListener() {},
    };
    const provider = new BrowserToolboxCompatRuntime.SettingsProvider({
      legacy,
      runtimeSettings: {
        ensureLoaded() {
          effectiveStarted = true;
          return new Promise((resolve) => releaseEffective = resolve);
        },
        addEventListener() {},
        removeEventListener() {},
      },
      url: () => "合成页面",
    });
    const pending = provider.load();
    assert.isTrue(effectiveStarted);
    assert.equal(null, provider.getEffective());
    releaseEffective({ general: { enabled: true } });
    await Promise.resolve();
    assert.equal(null, provider.getEffective());
    releaseLegacy();
    assert.equal("map j scrollUp", (await pending).keyboard.keyMappings);
    const stale = provider.load();
    provider.invalidate();
    releaseEffective({ general: { enabled: false } });
    releaseLegacy();
    let rejected = false;
    try {
      await stale;
    } catch (failure) {
      rejected = failure.message === "SETTINGS_PROVIDER_CLOSED";
    }
    assert.isTrue(rejected);
    assert.isTrue(provider.getEffective().effective.general.enabled);
    provider.destroy();
  });
  should("通知落在快照发布与loading清除之间，也会补读最新有效配置", async () => {
    let mapping = "", enabled = true;
    const callbacks = new Set(), published = [];
    const provider = new BrowserToolboxCompatRuntime.SettingsProvider({
      legacy: {
        defaultOptions: { keyMappings: "" },
        onLoaded: async () => {},
        get: () => mapping,
        addEventListener() {},
        removeEventListener() {},
      },
      runtimeSettings: {
        ensureLoaded: async () => ({ effectiveModules: { keyboard: enabled } }),
        addEventListener: (fn) => callbacks.add(fn),
        removeEventListener: (fn) => callbacks.delete(fn),
      },
      url: () => "合成页面",
    });
    await provider.load();
    provider.subscribe((value) => {
      published.push(value.effective.effectiveModules.keyboard);
      if (enabled) {
        enabled = false;
        for (const fn of callbacks) fn();
      }
    });
    mapping = "map j scrollUp";
    await provider.load();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal([true, false], published);
    assert.isFalse(provider.getEffective().effective.effectiveModules.keyboard);
    provider.destroy();
  });
  should("尚未准备接收的订阅不克隆丢弃快照，准备后仍收到独立配置", async () => {
    let ready = false, value = "first", copies = 0;
    const published = [];
    const clone = globalThis.structuredClone;
    stub(globalThis, "structuredClone", (value) => {
      if (value?.sourceVersion === "2.4.2") copies++;
      return clone(value);
    });
    const provider = new BrowserToolboxCompatRuntime.SettingsProvider({
      legacy: {
        defaultOptions: { keyMappings: "" },
        async onLoaded() {},
        get() { return value; },
        addEventListener() {}, removeEventListener() {},
      },
      url: () => "合成页面",
    });
    provider.subscribe((snapshot) => published.push(snapshot), { when: () => ready });
    await provider.load();
    assert.equal([], published);
    assert.equal(1, copies);
    ready = true;
    value = "second";
    const loaded = await provider.load();
    assert.equal(3, copies);
    assert.equal("second", published[0].keyboard.keyMappings);
    published[0].keyboard.keyMappings = "调用者修改";
    assert.equal("second", loaded.keyboard.keyMappings);
    assert.equal("second", provider.getEffective().keyboard.keyMappings);
    provider.destroy();
  });
  should("旧权威字段中的空值有效，工具箱副本不能覆盖，订阅和 revision 可清理", async () => {
    const listeners = new Set();
    let fail = false;
    let value = "";
    const provider = new BrowserToolboxCompatRuntime.SettingsProvider({
      legacy: {
        defaultOptions: { keyMappings: "", searchEngines: "", exclusionRules: [] },
        async onLoaded() {
          if (fail) throw new Error("合成读取失败");
        },
        get(key) {
          return key === "exclusionRules" ? [] : value;
        },
        addEventListener(_name, fn) {
          listeners.add(fn);
        },
        removeEventListener(_name, fn) {
          listeners.delete(fn);
        },
      },
      runtimeSettings: {
        async ensureLoaded() {
          return { keyboard: { keyMappings: "陈旧副本" } };
        },
        addEventListener(fn) {
          listeners.add(fn);
        },
        removeEventListener(fn) {
          listeners.delete(fn);
        },
      },
      url: () => "合成页面",
    });
    const first = await provider.load();
    assert.equal("", first.keyboard.keyMappings);
    assert.equal([], first.keyboard.exclusionRules);
    assert.equal(1, first.revision);
    first.keyboard.keyMappings = "外部修改";
    assert.equal("", (await provider.load()).keyboard.keyMappings);
    value = "map j scrollUp";
    assert.equal(2, (await provider.load()).revision);
    fail = true;
    try {
      await provider.load();
    } catch (_) { /* 读取失败仍保留最后有效快照。 */ }
    assert.equal(value, provider.getEffective().keyboard.keyMappings);
    provider.destroy();
    assert.equal(0, listeners.size);
  });

  should("并行 frame 握手只发送一次，销毁后迟到的身份不能发布", async () => {
    let resolve;
    let sends = 0;
    const bridge = new BrowserToolboxCompatRuntime.FrameRuntimeBridge({
      sendMessage() {
        sends++;
        return new Promise((done) => resolve = done);
      },
    });
    const first = bridge.initializeFrame();
    const second = bridge.initializeFrame();
    bridge.destroy();
    resolve({ frameId: 0, documentId: "synthetic", isEnabledForUrl: true });
    const results = await Promise.allSettled([first, second]);
    assert.equal(1, sends);
    assert.isTrue(results.every((result) => result.status === "rejected"));
    assert.equal(null, bridge.session);
  });

  should("销毁能立即结束没有回包的握手，不保留超时任务", async () => {
    const bridge = new BrowserToolboxCompatRuntime.FrameRuntimeBridge({
      sendMessage: () => new Promise(() => {}),
    });
    const pending = bridge.initializeFrame();
    bridge.destroy();
    const result = await Promise.race([
      pending.then(() => "错误地发布", () => "已取消"),
      new Promise((resolve) => setTimeout(() => resolve("仍在等待"), 20)),
    ]);
    assert.equal("已取消", result);
    assert.equal(null, bridge.pending);
  });
  should("缓存冻结取消旧握手，恢复立刻读取新身份，旧完成不能清除新会话", async () => {
    const resolvers = [];
    const bridge = new BrowserToolboxCompatRuntime.FrameRuntimeBridge({
      sendMessage: () => new Promise((resolve) => resolvers.push(resolve)),
    });
    const first = bridge.initializeFrame().then(() => "错误发布", () => "已取消");
    bridge.invalidateSession();
    const second = bridge.initializeFrame();
    resolvers[0]({ frameId: 0, documentId: "old", isEnabledForUrl: true });
    resolvers[1]({ frameId: 0, documentId: "new", isEnabledForUrl: true });
    assert.equal("已取消", await first);
    assert.equal("new", (await second).documentId);
    assert.equal("new", bridge.session.documentId);
    bridge.destroy();
  });
});

context("Canary 初次上下文读取与输入所有权分离", () => {
  function initialContext() {
    const listeners = new Map();
    const eventTarget = {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    };
    const resources = new ResourceScope();
    const responses = [];
    let loads = 0, invalidations = 0, destroyed = false, url = "https://synthetic.test/";
    const provider = {
      revision: 0, generation: 0, sourceRevision: 0, publishedSourceRevision: -1,
      async load() {
        loads++;
        this.publishedSourceRevision = this.sourceRevision;
        return { revision: ++this.revision };
      },
      invalidate() { invalidations++; this.generation++; },
      destroy: () => destroyed = true,
    };
    const bridge = new BrowserToolboxCompatRuntime.FrameRuntimeBridge({
      sendMessage: () => new Promise((resolve) => responses.push(resolve)),
    });
    const initial = new BrowserToolboxCompatRuntime.InitialContext({
      provider, bridge, resources, eventTarget, url: () => url,
    });
    const respond = (index, documentId) => responses[index]({
      frameId: 0, documentId, isEnabledForUrl: true,
    });
    return {
      initial, provider, bridge, resources, listeners, responses, respond,
      loads: () => loads, invalidations: () => invalidations, destroyed: () => destroyed,
      changeUrl: () => url += "next",
    };
  }

  should("首读与后续模块加载重叠，领取一次已完成身份且不复用后续握手", async () => {
    const h = initialContext();
    assert.equal(1, h.responses.length);
    assert.equal(1, h.loads());
    h.respond(0, "first");
    await h.initial.ready;
    const claimed = h.initial.claim();
    assert.equal(h.provider, claimed.provider);
    assert.equal(h.bridge, claimed.bridge);
    assert.equal("first", (await claimed.ready).documentId);
    assert.equal(1, (await claimed.readSettings()).revision);
    assert.equal(1, h.loads());
    assert.equal({}, h.resources.counts());
    assert.equal(0, h.listeners.size);
    assert.isFalse(h.destroyed());
    const next = h.bridge.initializeFrame();
    assert.equal(2, h.responses.length);
    h.respond(1, "second");
    assert.equal("second", (await next).documentId);
    h.bridge.destroy();
  });

  should("预读完成后收到配置变化，领取时重新读取最新版本", async () => {
    const h = initialContext();
    h.respond(0, "current");
    await h.initial.ready;
    await h.initial.settings;
    h.provider.sourceRevision++;
    const claimed = h.initial.claim();
    assert.equal(2, (await claimed.readSettings()).revision);
    assert.equal(2, h.loads());
    h.bridge.destroy();
  });

  for (const reason of ["pagehide", "url-change"]) {
    should(`${reason} 废弃预读，迟到旧身份不能阻塞下一次读取`, async () => {
      const h = initialContext();
      if (reason === "pagehide") h.listeners.get("pagehide")();
      else h.changeUrl();
      const claimed = h.initial.claim();
      assert.equal(null, claimed.ready);
      assert.equal(1, h.invalidations());
      const next = h.bridge.initializeFrame();
      h.respond(0, "stale");
      h.respond(1, "current");
      assert.equal("current", (await next).documentId);
      assert.equal("current", h.bridge.session.documentId);
      assert.equal({}, h.resources.counts());
      h.bridge.destroy();
    });
  }

  should("Host 尚未领取就销毁文档，立即取消握手并清理临时订阅", async () => {
    const h = initialContext();
    h.resources.dispose();
    const result = await h.initial.ready.then(() => "错误发布", () => "已取消");
    assert.equal("已取消", result);
    assert.isTrue(h.destroyed());
    assert.isTrue(h.bridge.destroyed);
    assert.equal(null, h.bridge.pending);
    assert.equal(0, h.listeners.size);
    assert.equal({}, h.resources.counts());
    let rejected = false;
    try { h.initial.claim(); } catch (_) { rejected = true; }
    assert.isTrue(rejected);
  });
});

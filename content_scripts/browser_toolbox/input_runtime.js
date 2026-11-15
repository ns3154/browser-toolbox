// SPDX-License-Identifier: GPL-3.0-or-later
// 普通模式与输入保护同属一个引擎；共享 Mode 只负责栈资源，键序列不调用旧 Normal/KeyHandler。
(function () {
  class KeySequence {
    constructor(mapping = {}) {
      this.mapping = mapping;
      this.passKeys = [];
      this.reset();
    }
    reset() {
      this.prefix = 0;
      this.paths = [this.mapping];
    }
    configure(mapping, passKeys = this.passKeys) {
      this.mapping = mapping || {};
      this.passKeys = passKeys || [];
      this.reset();
    }
    get pending() {
      return this.prefix !== 0 || this.paths.length !== 1;
    }
    accept(key) {
      const paths = this.paths.filter((path) => path && Object.hasOwn(path, key));
      const continuation = paths.some((path) => path !== this.mapping);
      if (!continuation && this.prefix === 0 && this.passKeys.includes(key)) {
        if (key) this.reset();
        return { handled: false };
      }
      if (paths.length) {
        if (!Object.hasOwn(this.paths[0], key)) this.prefix = 0;
        const next = paths.map((path) => path[key]);
        const entry = next[0];
        if (entry.command != null) {
          const count = this.prefix > 0 ? this.prefix : null;
          this.reset();
          return { handled: true, entry, count };
        }
        this.paths = [...next, this.mapping];
        return { handled: true };
      }
      if (/^[0-9]$/.test(key) && (this.prefix > 0 || key !== "0")) {
        this.prefix = this.paths.length === 1 ? this.prefix * 10 + Number(key) : Number(key);
        this.paths = [this.mapping];
        return { handled: true };
      }
      if (key) this.reset();
      return { handled: false };
    }
  }

  class NormalMode extends globalThis.Mode {
    get keyMapping() {
      return this.sequence.mapping;
    }
    get passKeys() {
      return this.sequence.passKeys;
    }
    init(options = {}) {
      // 通知、退出和重新初始化都会使在途首读失效，旧回包不能覆盖当前键序列。
      const mappingRevision = this.mappingRevision = (this.mappingRevision || 0) + 1;
      this.sequence = new KeySequence(options.keyMapping);
      super.init({
        ...options,
        name: "normal",
        indicator: options.indicator ?? false,
        exitOnEscape: false,
        keydown: (event) => this.keydown(event),
      });
      const mapping = globalThis.BrowserToolboxFrameRuntimeBridgeInstance?.session
        ?.normalModeKeyStateMapping;
      if (!options.keyMapping && mapping) this.sequence.configure(mapping);
      else if (!options.keyMapping) {
        chrome.storage.session.get("normalModeKeyStateMapping").then((items) => {
          if (this.modeIsActive && this.mappingRevision === mappingRevision) {
            this.sequence.configure(items.normalModeKeyStateMapping);
          }
        }).catch(() => {});
      }
      const change = (changes, area) => {
        if (this.modeIsActive && area === "session" && changes.normalModeKeyStateMapping) {
          this.mappingRevision++;
          this.sequence.configure(changes.normalModeKeyStateMapping.newValue);
        }
      };
      chrome.storage.onChanged.addListener(change);
      this.onExit(() => {
        this.mappingRevision++;
        chrome.storage.onChanged.removeListener(change);
      });
      this.leaveOnEscape = options.exitOnEscape;
    }
    setPassKeys(keys) {
      this.sequence.configure(this.sequence.mapping, this.leaveOnEscape ? [] : keys);
    }
    keydown(event) {
      if (KeyboardUtils.isEscape(event)) {
        if (this.sequence.pending) {
          this.sequence.reset();
          return this.suppressEvent;
        }
        if (this.leaveOnEscape) {
          this.exit();
          return this.suppressEvent;
        }
        if (globalThis.HelpDialog?.isShowing()) {
          HelpDialog.toggle();
          return this.suppressEvent;
        }
        globalThis.HintCoordinator?.mouseOutOfLastClickedElement();
        return this.continueBubbling;
      }
      const result = this.sequence.accept(KeyboardUtils.getKeyCharString(event));
      if (result.entry) {
        this.invoke(result.entry, result.count);
        if (this.options.count != null && --this.options.count <= 0) this.exit();
      }
      return result.handled ? this.suppressEvent : this.continueBubbling;
    }
    invoke(entry, prefix) {
      const descriptor = BrowserToolboxCommandDefinitions.getCommand(entry.command);
      const host = BrowserToolboxRuntimeHostInstance;
      if (!descriptor || host.state !== "active") return;
      const { count, countProvided } = BrowserToolboxCommandInvocation.keyboardCount(
        descriptor,
        entry.options || {},
        prefix,
      );
      const threshold = descriptor.countPolicy.confirmationThreshold;
      const confirmationGranted = threshold != null && count > threshold;
      if (
        confirmationGranted && !confirm(
          `You have asked Vimium to perform ${count} repetitions of the ` +
            `command "${entry.command}". Are you sure you want to continue?`,
        )
      ) return;
      const invocation = BrowserToolboxCommandInvocation.createV2(
        entry.command,
        entry.options || {},
        { type: "keyboard" },
        {
          sourceFrameId: globalThis.isVimiumUIComponent ? 0 : host.context.frameId,
          interactionEpoch: host.interactionEpoch,
        },
        count,
        {
          countProvided,
          confirmationGranted,
          identity: {
            documentId: host.context.documentId,
            runtimeEpoch: host.runtimeEpoch,
            incognito: host.context.incognito === true,
          },
        },
      );
      // 有副作用的调用只发一次；失败结果由统一协议返回，不从按键层补发。
      BrowserToolboxPageCommandExecutorInstance.invoke(invocation).catch(() => {});
    }
  }

  class PassNextKeyMode extends globalThis.Mode {
    constructor(count = 1) {
      super();
      this.remaining = count;
      this.pressed = new Set();
      this.seen = false;
      super.init({
        name: "pass-next-key",
        indicator: "Pass next key.",
        exitOnBlur: globalThis,
        keypress: () => this.passEventToPage,
        keydown: (event) => {
          this.seen = true;
          this.pressed.add(event.code || event.key);
          return this.passEventToPage;
        },
        keyup: (event) => {
          this.pressed.delete(event.code || event.key);
          if (this.seen && !this.pressed.size) {
            this.seen = false;
            if (--this.remaining <= 0) this.exit();
          }
          return this.passEventToPage;
        },
      });
    }
  }

  class InsertMode extends globalThis.Mode {
    constructor(options = {}) {
      super();
      this.permanent = options.permanent;
      this.global = options.global;
      this.passNextKeyKeys = options.passNextKeyKeys || [];
      const passNextKeyRevision = this.passNextKeyRevision = 0;
      super.init({
        ...options,
        name: "insert",
        indicator: Object.hasOwn(options, "indicator")
          ? options.indicator
          : !this.permanent && !Settings.get("hideHud")
          ? "Insert mode"
          : null,
        keydown: (event) => this.key(event),
        keypress: (event) => this.key(event),
      });
      if (!options.passNextKeyKeys) {
        chrome.storage.session.get("passNextKeyKeys").then((items) => {
          if (this.modeIsActive && this.passNextKeyRevision === passNextKeyRevision) {
            this.passNextKeyKeys = items.passNextKeyKeys || [];
          }
        }).catch(() => {});
      }
      const change = (changes, area) => {
        if (this.modeIsActive && area === "session" && changes.passNextKeyKeys) {
          // 删除和显式空列表也是新值，迟到首读不能恢复已经取消的放行键。
          this.passNextKeyRevision++;
          this.passNextKeyKeys = changes.passNextKeyKeys.newValue || [];
        }
      };
      chrome.storage.onChanged.addListener(change);
      this.onExit(() => {
        this.passNextKeyRevision++;
        chrome.storage.onChanged.removeListener(change);
      });
      if (this.permanent) {
        InsertMode.permanentInstance = this;
        globalThis.InsertMode.permanentInstance = this;
      }
    }
    activeElement() {
      let element = document.activeElement;
      while (element) {
        let root = element.shadowRoot;
        // 扩展 API 只返回页面创建的根；只沿焦点链判断按键归属，不进入原生控件内部。
        if (!root && globalThis.HTMLElement && element instanceof HTMLElement) {
          root = globalThis.chrome?.dom?.openOrClosedShadowRoot?.(element);
        }
        const inner = root?.activeElement;
        if (!inner) break;
        element = inner;
      }
      return element;
    }
    key(event) {
      // 未替换的 PostFind 通过公共兼容接口放行同一个事件，不能在 Insert 再次截获。
      if (event === globalThis.InsertMode?.suppressedEvent) return this.continueBubbling;
      const element = this.activeElement();
      if (!this.global && !DomUtils.isFocusable(element)) return this.continueBubbling;
      if (element === document.body && element.isContentEditable) return this.passEventToPage;
      if (this.passNextKeyKeys.includes(KeyboardUtils.getKeyCharString(event))) {
        if (event.type === "keydown") new PassNextKeyMode();
        return this.suppressEvent;
      }
      if (event.type === "keydown" && KeyboardUtils.isEscape(event)) {
        if (DomUtils.isFocusable(element)) element.blur();
        if (!this.permanent) this.exit();
        return this.suppressEvent;
      }
      return this.passEventToPage;
    }
  }

  const cloneSnapshot = (value) =>
    globalThis.BrowserToolboxValueUtils
      ? globalThis.BrowserToolboxValueUtils.clone(value)
      : structuredClone(value);

  class SessionSnapshotReader {
    constructor(api, resources) {
      this.api = api;
      this.keys = ["normalModeKeyStateMapping", "passNextKeyKeys", "findModeRawQueryList"];
      if (api.extension?.inIncognitoContext) this.keys.push("findModeRawQueryListIncognito");
      this.generation = this.revision = 0;
      this.listeners = new Set();
      this.sharedListeners = new Set();
      this.listener = (changes, area) => {
        if (this.closed || area !== "session" || !this.keys.some((key) => changes[key])) return;
        this.revision++;
        if (!this.snapshot) return;
        const nextSnapshot = { ...this.snapshot };
        for (const key of this.keys) {
          if (changes[key]) nextSnapshot[key] = changes[key].newValue;
        }
        this.snapshot = nextSnapshot;
        let cloned = null;
        for (const listener of this.listeners) {
          if (this.sharedListeners.has(listener)) {
            listener(this.snapshot);
          } else {
            cloned ??= cloneSnapshot(this.snapshot);
            listener(cloned);
          }
        }
      };
      api.storage.onChanged.addListener(this.listener);
      resources.add(() => this.destroy(), "subscription");
    }
    loadIntoCache() {
      if (this.closed) return Promise.reject(new Error("INPUT_SNAPSHOT_CLOSED"));
      if (this.snapshot) return Promise.resolve(this.snapshot);
      if (this.loading) return this.loading;
      const generation = this.generation;
      const loading = (async () => {
        for (;;) {
          const revision = this.revision;
          const values = await this.api.storage.session.get(this.keys);
          if (this.closed || generation !== this.generation) throw new Error("STALE_INPUT_SNAPSHOT");
          // 读取期间收到更新时重新读；不能用较早的回包覆盖最新映射或查询历史。
          if (revision !== this.revision) continue;
          const snapshot = {};
          for (const key of this.keys) snapshot[key] = values[key];
          this.snapshot = snapshot;
          return snapshot;
        }
      })().finally(() => { if (this.loading === loading) this.loading = null; });
      this.loading = loading;
      return loading;
    }
    preload() {
      // 文档启动阶段只需把 session 快照拉入缓存，避免未消费的防御性深克隆。
      return this.loadIntoCache().then(() => {});
    }
    read() {
      const loading = this.loadIntoCache();
      if (this.reading && this.readingSource === loading) return this.reading;
      const reading = loading.then((snapshot) => cloneSnapshot(snapshot));
      this.reading = reading;
      this.readingSource = loading;
      reading.finally(() => {
        if (this.reading === reading) {
          this.reading = null;
          this.readingSource = null;
        }
      }).catch(() => {});
      return reading;
    }
    readShared() {
      // 内部输入引擎仅只读检索映射表和放行列表，直接复用已缓存快照免除每次加载深克隆开销。
      return this.loadIntoCache();
    }
    subscribe(listener, { shared = false } = {}) {
      this.listeners.add(listener);
      if (shared) this.sharedListeners.add(listener);
      return () => {
        this.listeners.delete(listener);
        this.sharedListeners.delete(listener);
      };
    }
    invalidate() {
      this.generation++;
      this.snapshot = this.loading = this.reading = this.readingSource = null;
    }
    destroy() {
      if (this.closed) return;
      this.closed = true;
      this.invalidate();
      this.api.storage.onChanged.removeListener(this.listener);
      this.listeners.clear();
      this.sharedListeners.clear();
    }
  }

  class KeyboardEngine {
    constructor({ installModes, cleanup, applySettings, enabled, pageExecutor, plan, inputSnapshot }) {
      Object.assign(this, { installModes, cleanup, applySettings, enabled, pageExecutor, plan, inputSnapshot });
      this.version = plan?.moduleImplementations.ui === "browser-toolbox"
        ? "ui-canary.1"
        : plan?.moduleImplementations.marks === "browser-toolbox"
        ? "marks-canary.1"
        : plan?.moduleImplementations.vomnibar === "browser-toolbox"
        ? "vomnibar-canary.1"
        : plan?.moduleImplementations.hints === "browser-toolbox"
        ? "hints-canary.1"
        : plan?.moduleImplementations.visual === "browser-toolbox"
        ? "visual-canary.1"
        : plan?.moduleImplementations.find === "browser-toolbox" ? "find-canary.1"
        : "input-canary.1";
      this.active = false;
    }
    async initialize(context, resources) {
      this.context = context;
      this.resources = resources;
      // 已缓存的首读也异步交付；期间的通知优先，不能等输入设置存在后才接收更新。
      let snapshotUpdated = false;
      if (this.inputSnapshot) resources.add(this.inputSnapshot.subscribe((values) => {
        snapshotUpdated = true;
        this.inputSettings = values;
      }, { shared: true }));
      const snapshotReady = this.inputSnapshot ? this.inputSnapshot.readShared() : chrome.storage.session.get([
        "normalModeKeyStateMapping",
        "passNextKeyKeys",
      ]);
      const mappingReady = snapshotReady.then((values) => {
        if (!snapshotUpdated) this.inputSettings = values;
        if (this.inputSnapshot) return;
        const change = (changes, area) => {
          if (area !== "session") return;
          for (const key of ["normalModeKeyStateMapping", "passNextKeyKeys"]) {
            if (changes[key]) this.inputSettings[key] = changes[key].newValue;
          }
        };
        chrome.storage.onChanged.addListener(change);
        resources.add(() => chrome.storage.onChanged.removeListener(change));
      });
      let findReady;
      if (this.plan?.moduleImplementations.find === "browser-toolbox") {
        const history = new BrowserToolboxFindHistory();
        resources.add(() => history.destroy());
        findReady = (this.inputSnapshot ? snapshotReady.then((values) => history.init(values)) : history.init()).then(() => {
          this.find = new BrowserToolboxFindRuntime.Controller(resources, history);
        });
      }
      // 同一提示 Canary 中也保留已登记的输入/查找/选择方案，准备它们时须先安装包内旧提示。
      const compatibleHintsReady = this.plan?.moduleImplementations.hints === "browser-toolbox"
        ? undefined
        : globalThis.BrowserToolboxLoadCompatibleHints?.();
      await Promise.all([mappingReady, findReady, compatibleHintsReady]);
    }
    activate(context) {
      this.context = context;
      this.active = true;
      if (this.plan?.moduleImplementations.ui === "browser-toolbox") {
        this.ui = new BrowserToolboxUIRuntime.Controller(this.resources, context, this.enabled);
        globalThis.BrowserToolboxUIControllerInstance = this.ui;
      }
      this.scroll = new BrowserToolboxScrollController(this.resources);
      globalThis.BrowserToolboxScrollControllerInstance = this.scroll;
      if (this.find) {
        globalThis.BrowserToolboxFindControllerInstance = this.find;
        this.find.activate();
        this.resources.add(this.pageExecutor.registerImplementations(this.find.commands()));
      }
      if (this.plan?.moduleImplementations.visual === "browser-toolbox") {
        this.visual = new BrowserToolboxVisualRuntime.Controller(this.resources, context, this.enabled);
        globalThis.BrowserToolboxVisualControllerInstance = this.visual;
        this.resources.add(this.pageExecutor.registerImplementations(this.visual.commands()));
      }
      if (this.plan?.moduleImplementations.hints === "browser-toolbox") {
        this.hints = new BrowserToolboxHintsRuntime.Controller(this.resources, context, this.enabled);
        globalThis.BrowserToolboxHintsControllerInstance = this.hints;
        this.resources.add(this.pageExecutor.registerImplementations(this.hints.commands()));
      }
      if (this.plan?.moduleImplementations.vomnibar === "browser-toolbox") {
        this.vomnibar = new BrowserToolboxVomnibarRuntime.Controller(this.resources, context, this.enabled);
        globalThis.BrowserToolboxVomnibarControllerInstance = this.vomnibar;
        this.resources.add(this.pageExecutor.registerImplementations(this.vomnibar.commands()));
      }
      if (this.plan?.moduleImplementations.marks === "browser-toolbox") {
        this.marks = new BrowserToolboxMarksRuntime.Controller(this.resources, context, this.enabled);
        globalThis.BrowserToolboxMarksControllerInstance = this.marks;
        this.resources.add(this.pageExecutor.registerImplementations(this.marks.commands()));
      }
      const forcedNormal = (count) => {
        const mode = new NormalMode();
        mode.init({
          keyMapping: this.inputSettings.normalModeKeyStateMapping,
          indicator: "Normal mode (pass keys disabled)",
          exitOnEscape: true,
          singleton: "enterNormalMode",
          count,
        });
        return mode;
      };
      this.resources.add(this.pageExecutor.registerImplementations({
        ...this.scroll.commands(),
        enterInsertMode: () => new InsertMode({ global: true, exitOnFocus: true }),
        passNextKey: (count, request) =>
          request.registryEntry.options.normal ? forcedNormal(count) : new PassNextKeyMode(count),
      }));
      this.installModes(this.inputSettings);
    }
    setEffectiveSettings(snapshot, reason) {
      this.applySettings(snapshot, reason);
      if (!this.enabled()) {
        this.scroll?.destroy();
        this.visual?.cancelInteractions();
        this.hints?.cancelInteractions();
        this.vomnibar?.cancelInteractions();
        this.marks?.cancelInteractions();
        this.ui?.cancelInteractions();
      }
      else if (this.scroll?.closed) this.scroll.init();
    }
    handleKeyEvent(event) {
      // 候选输入优先于任何模式；Esc、CTRL-[ 和映射键都不能退出输入法候选状态。
      if (event.isComposing || event.keyCode === 229) return BrowserToolboxRuntime.PASS;
      this.scroll.track(event.type, event);
      return this.enabled()
        ? handlerStack.decideEvent(event.type, event)
        : BrowserToolboxRuntime.PASS;
    }
    handleEvent(type, event) {
      this.scroll.track(type, event);
      return this.enabled() ? handlerStack.decideEvent(type, event) : BrowserToolboxRuntime.PASS;
    }
    executeCommand(invocation) {
      return this.pageExecutor.execute(invocation);
    }
    destroy(reason) {
      if (!this.active) return;
      this.active = false;
      this.ui?.destroy();
      if (globalThis.BrowserToolboxUIControllerInstance === this.ui) {
        globalThis.BrowserToolboxUIControllerInstance = null;
      }
      this.marks?.destroy();
      if (globalThis.BrowserToolboxMarksControllerInstance === this.marks) {
        globalThis.BrowserToolboxMarksControllerInstance = null;
      }
      this.vomnibar?.destroy();
      if (globalThis.BrowserToolboxVomnibarControllerInstance === this.vomnibar) {
        globalThis.BrowserToolboxVomnibarControllerInstance = null;
      }
      this.hints?.destroy();
      if (globalThis.BrowserToolboxHintsControllerInstance === this.hints) {
        globalThis.BrowserToolboxHintsControllerInstance = null;
      }
      this.visual?.destroy();
      if (globalThis.BrowserToolboxVisualControllerInstance === this.visual) {
        globalThis.BrowserToolboxVisualControllerInstance = null;
      }
      this.cleanup(reason);
      this.scroll.destroy();
      this.find?.destroy();
      if (globalThis.BrowserToolboxFindControllerInstance === this.find) {
        globalThis.BrowserToolboxFindControllerInstance = null;
      }
      if (globalThis.BrowserToolboxScrollControllerInstance === this.scroll) {
        globalThis.BrowserToolboxScrollControllerInstance = null;
      }
      InsertMode.permanentInstance = null;
    }
  }
  globalThis.BrowserToolboxInputRuntime = Object.freeze({
    KeySequence,
    NormalMode,
    InsertMode,
    PassNextKeyMode,
    SessionSnapshotReader,
    KeyboardEngine,
  });
})();

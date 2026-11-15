//
// This content script must be run prior to domReady so that we perform some operations very early.
//

let isEnabledForUrl = true;
let vimiumEnabledForUrl = true;
let normalMode = null;
let runtimeMaintenancePaused = false;

// This is set by initializeFrame. We can only get this frame's ID from the background page.
globalThis.frameId = null;

// We track whther the current window has the focus or not.
let windowHasFocus = null;
function windowIsFocused() {
  const controller = globalThis.BrowserToolboxUIControllerInstance;
  if (controller?.valid()) return controller.focus.focused;
  return windowHasFocus;
}

function initWindowIsFocused() {
  DomUtils.documentReady().then(() => windowHasFocus = document.hasFocus());
}

// True if this window should be focusable by various Vim commands (e.g. "nextFrame").
function isWindowFocusable() {
  // Avoid focusing tiny frames. See #1317.
  return !DomUtils.windowIsTooSmall() && (document.body?.tagName.toLowerCase() != "frameset");
}

// If an input grabs the focus before the user has interacted with the page, then grab it back (if
// the grabBackFocus option is set).
class GrabBackFocus extends Mode {
  constructor() {
    super();
    let listener;
    const exitEventHandler = () => {
      return this.alwaysContinueBubbling(() => {
        this.exit();
        BrowserToolboxFrameRuntimeBridgeInstance.broadcastToTab({
          handler: "userIsInteractingWithThePage",
        }).catch(() => {});
      });
    };

    super.init({
      name: "grab-back-focus",
      keydown: exitEventHandler,
    });

    // True after we've grabbed back focus to the page and logged it via console.log , so web devs
    // using Vimium don't get confused.
    this.logged = false;

    this.push({
      _name: "grab-back-focus-mousedown",
      mousedown: exitEventHandler,
    });

    if (this.modeIsActive) {
      if (Settings.get("grabBackFocus")) {
        this.push({
          _name: "grab-back-focus-focus",
          focus: (event) => this.grabBackFocus(event.target),
        });
        // An input may already be focused. If so, grab back the focus.
        if (document.activeElement) {
          this.grabBackFocus(document.activeElement);
        }
      } else {
        this.exit();
      }
    }

    // This mode is active in all frames. A user might have begun interacting with one frame without
    // other frames detecting this. When one GrabBackFocus mode exits, we broadcast a message to
    // inform all GrabBackFocus modes that they should exit; see #2296.
    // 关闭抢回焦点时模式已经退出，不能再注册一个失去退出清理机会的监听器。
    if (this.modeIsActive) {
      chrome.runtime.onMessage.addListener(
        listener = ({ name }) => {
          if (name === "userIsInteractingWithThePage") {
            chrome.runtime.onMessage.removeListener(listener);
            if (this.modeIsActive) {
              this.exit();
            }
          }
          // We will not be calling sendResponse.
          return false;
        },
      );
      this.onExit(() => chrome.runtime.onMessage.removeListener(listener));
    }
  }

  grabBackFocus(element) {
    if (!DomUtils.isFocusable(element)) {
      return this.continueBubbling;
    }

    if (!this.logged && (element !== document.body)) {
      this.logged = true;
      if (!globalThis.vimiumDomTestsAreRunning) {
        console.log("An auto-focusing action on this page was blocked by Vimium.");
      }
    }
    element.blur();
    return this.suppressEvent;
  }
}

// Pages can load new content dynamically and change the displayed URL using history.pushState.
// Since this can often be indistinguishable from an actual new page load for the user, we should
// also re-start GrabBackFocus for these as well. This fixes issue #1622.
function installPushStateMonitor() {
  handlerStack.push({
    _name: "GrabBackFocus-pushState-monitor",
    click(event) {
      // If a focusable element is focused, the user must have clicked on it. Retain focus and bail.
      if (DomUtils.isFocusable(document.activeElement)) {
        return true;
      }

      let target = event.target;

      while (target) {
        // Often, a link which triggers a content load and url change with javascript will also have
        // the new url as it's href attribute.
        if (
          (target.tagName === "A") &&
          (target.origin === document.location.origin) &&
          // Clicking the link will change the url of this frame.
          ((target.pathName !== document.location.pathName) ||
            (target.search !== document.location.search)) &&
          (["", "_self"].includes(target.target) ||
            ((target.target === "_parent") && (globalThis.parent === window)) ||
            ((target.target === "_top") && (globalThis.top === window)))
        ) {
          return new GrabBackFocus();
        } else {
          target = target.parentElement;
        }
      }
      return true;
    },
  });
}

function installModes(plan = BrowserToolboxRuntime.COMPAT_PLAN, inputSettings = {}) {
  if (normalMode?.modeIsActive) return normalMode;
  installPushStateMonitor();
  // Install the permanent modes. The permanently-installed insert mode tracks focus/blur events,
  // and activates/deactivates itself accordingly.
  const independentInput = plan.moduleImplementations.input === "browser-toolbox";
  const input = independentInput ? BrowserToolboxInputRuntime : { NormalMode, InsertMode };
  normalMode = new input.NormalMode();
  normalMode.init(independentInput ? { keyMapping: inputSettings.normalModeKeyStateMapping } : undefined);
  normalMode.setPassKeys(globalThis.BrowserToolboxFrameRuntimeBridgeInstance?.session?.passKeys);
  // Initialize components upon which normal mode depends.
  Scroller.init();
  if (plan.moduleImplementations.find !== "browser-toolbox") FindModeHistory.init();
  new input.InsertMode({ permanent: true, ...(independentInput ? { passNextKeyKeys: inputSettings.passNextKeyKeys } : {}) });
  if (isEnabledForUrl) {
    new GrabBackFocus();
  }
  // Return the normalMode object (for the tests).
  return normalMode;
}

// document is null in our tests.
let previousUrl = globalThis.document?.location.href;

// When we're informed by the background page that a URL in this tab has changed, we check if we
// have the correct enabled state (but only if this frame has the focus).
const checkEnabledAfterURLChange = forTrusted(function (_request) {
  // The background page can't tell if the URL has actually changed after a client-side
  // history.pushState call. To limit log spam, ignore spurious URL change events where the URL
  // didn't actually change.
  if (previousUrl == document.location.href) {
    return;
  } else {
    previousUrl = document.location.href;
  }
  // The URL changing feels like navigation to the user, so reset the scroller (see #3119).
  Scroller.reset();
  if (windowIsFocused()) {
    checkIfEnabledForUrl();
  }
});

// If our extension gets uninstalled, reloaded, or updated, the content scripts for the old version
// become orphaned: they remain running but cannot communicate with the background page or invoke
// most extension APIs. There is no Chrome API to be notified of this event, so we test for it every
// time a keystroke is pressed before we act on that keystroke. https://stackoverflow.com/a/64407849
const extensionHasBeenUnloaded = () => chrome.runtime?.id == null;

async function initializeOnDomReady() {
  const host = BrowserToolboxRuntimeHostInstance;
  const epoch = host.runtimeEpoch;
  const ownNewTab = host.plan.moduleImplementations.newTab === "browser-toolbox";
  // Tell the background page we're in the domReady state.
  const ready = await BrowserToolboxFrameRuntimeBridgeInstance.ready();
  if (ownNewTab) {
    if (ready?.ok !== false && host.runtimeEpoch === epoch) {
      await BrowserToolboxNewTabRuntime.openOnReady(host, epoch);
    }
    return;
  }

  const isVimiumNewTabPage = document.location.href == Settings.vimiumNewTabPageUrl;
  if (!isVimiumNewTabPage) return;

  // Show the Vomnibar.
  await Settings.onLoaded();
  if (Settings.get("openVomnibarOnNewTabPage")) {
    await Utils.populateBrowserInfo();
    DomUtils.injectUserCss();
    Vomnibar.activate(0, {});
  }
}

function onUnload() {
  isEnabledForUrl = false;
  globalThis.BrowserToolboxRuntimeHostInstance?.dispose("context-lost");
}

function cleanupCompatRuntime() {
  HintCoordinator.exit({ isSuccess: false });
  for (const mode of [...Mode.modes].reverse()) mode.exit();
  // 某些旧模式退出时会生成保护模式；失去执行权后这些模式也必须退出。
  for (const mode of [...Mode.modes].reverse()) mode.exit();
  Mode.modes = [];
  Mode.singletons = {};
  handlerStack.reset();
  normalMode = null;
  Scroller.destroy();
  FindModeHistory.destroy();
  document.removeEventListener("selectionchange", FindMode.restoreDefaultSelectionHighlight, true);
  FindMode.restoreDefaultSelectionHighlight({ isTrusted: true });
  HUD.destroy();
  UIComponent.destroyAll();
  Vomnibar.vomnibarUI = null;
  HelpDialog.helpUI = null;
  HelpDialog.hiding = null;
  InsertMode.permanentInstance = null;
}

function setScrollPosition({ scrollX, scrollY }) {
  const controller = globalThis.BrowserToolboxMarksControllerInstance;
  if (controller?.valid()) return controller.restorePosition({ scrollX, scrollY });
  DomUtils.documentReady().then(() => {
    if (!DomUtils.isTopFrame()) return;
    Utils.nextTick(function () {
      globalThis.focus();
      document.body.focus();
      if ((scrollX > 0) || (scrollY > 0)) {
        Marks.setPreviousPosition();
        globalThis.scrollTo(scrollX, scrollY);
      }
    });
  });
}

const flashFrame = (() => {
  let highlightedFrameElement = null;
  return () => {
    if (highlightedFrameElement == null) {
      highlightedFrameElement = DomUtils.createElement("div");

      // Create a shadow DOM wrapping the frame so the page's styles don't interfere with ours.
      const shadowDOM = highlightedFrameElement.attachShadow({ mode: "open" });

      // Inject stylesheet.
      const styleEl = DomUtils.createElement("style");
      const vimiumCssUrl = chrome.runtime.getURL("content_scripts/vimium.css");
      styleEl.textContent = `@import url("${vimiumCssUrl}");`;
      shadowDOM.appendChild(styleEl);

      const frameEl = DomUtils.createElement("div");
      frameEl.className = "vimium-reset vimium-highlighted-frame";
      shadowDOM.appendChild(frameEl);
    }

    document.documentElement.appendChild(highlightedFrameElement);
    Utils.setTimeout(200, () => highlightedFrameElement.remove());
  };
})();

//
// Called from the backend in order to change frame focus.
//
function focusThisFrame(request) {
  const controller = globalThis.BrowserToolboxUIControllerInstance;
  if (controller?.valid()) return controller.focus.focus(request);
  // It should never be the case that we get a forceFocusThisFrame request on a window that isn't
  // focusable, because the background script checks that the window is focusable before sending the
  // focusFrame message.
  if (!request.forceFocusThisFrame && !isWindowFocusable()) return;

  const host = globalThis.BrowserToolboxRuntimeHostInstance;
  const epoch = host?.runtimeEpoch;
  return new Promise((resolve) => {
    // 引擎撤销会清除nextTick计时器，取消分支也必须结束Native消息回执的等待。
    const removeCancellation = host?.engineResources?.add(resolve);
    Utils.nextTick(function () {
      try {
        if (host && (host.disposed || host.suspended || host.runtimeEpoch !== epoch || host.state !== "active")) return;
        globalThis.focus();
        // On Firefox, window.focus doesn't always draw focus back from a child frame (bug 554039). We
        // blur the active element if it is an iframe, which gives the window back focus as intended.
        if (document.activeElement.tagName.toLowerCase() === "iframe") {
          document.activeElement.blur();
        }
        if (request.highlight) flashFrame();
      } finally {
        removeCancellation?.();
        resolve();
      }
    });
  });
}

// Used by the focusInput command.
let recentlyFocusedElement = null;
globalThis.lastFocusedInput = () => recentlyFocusedElement;

const messageHandlers = {
  "browserToolbox.runtimeDiagnostics"() {
    return globalThis.BrowserToolboxRuntimeHostInstance?.getDiagnostics();
  },
  async "browserToolbox.restoreCompatibleRuntime"() {
    const host = globalThis.BrowserToolboxRuntimeHostInstance;
    if (!host || host.disposed) return { initializationState: "refresh-required" };
    await host.deactivate("maintenance-restore");
    runtimeMaintenancePaused = false;
    host.maintenancePaused = false;
    await checkIfEnabledForUrl();
    return host.getDiagnostics();
  },
  async "browserToolbox.pauseRuntime"() {
    runtimeMaintenancePaused = true;
    BrowserToolboxRuntimeHostInstance.maintenancePaused = true;
    globalThis.BrowserToolboxMouseControllerInstance?.cancelAll("runtime-plan-change");
    frameInitializationGeneration++;
    frameInitialization = null;
    BrowserToolboxFrameRuntimeBridgeInstance.invalidateSession();
    await BrowserToolboxRuntimeHostInstance.deactivate("maintenance-pause");
    return BrowserToolboxRuntimeHostInstance.getDiagnostics();
  },
  getFocusStatus(_request, _sender) {
    const controller = globalThis.BrowserToolboxUIControllerInstance;
    if (controller?.valid()) return controller.focus.status();
    return {
      focused: windowIsFocused(),
      focusable: isWindowFocusable(),
    };
  },
  async focusFrame(request) {
    await focusThisFrame(request);
  },
  getScrollPosition(_ignoredA, _ignoredB) {
    if (DomUtils.isTopFrame()) {
      return { scrollX: globalThis.scrollX, scrollY: globalThis.scrollY };
    }
  },
  setScrollPosition,
  checkEnabledAfterURLChange,
  runInTopFrame({ sourceFrameId, registryEntry }) {
    // TODO(philc): it seems to me that we should be able to get rid of this runInTopFrame
    // command, and instead use chrome.tabs.sendMessage with a frameId 0 from the background page.
    if (DomUtils.isTopFrame()) {
      return BrowserToolboxPageCommandExecutorInstance.executeCompatibilityTopFrame(
        registryEntry,
        sourceFrameId,
      );
    }
  },
  linkHintsMessage(request, sender) {
    if (
      request.interactionId &&
      !["getHintDescriptors", "activateMode"].includes(request.messageType) &&
      request.interactionId !== HintCoordinator.runtimeInteractionId
    ) return;
    if (HintCoordinator.willHandleMessage(request.messageType)) {
      return HintCoordinator[request.messageType](request, sender);
    }
  },
  showMessage(request) {
    HUD.show(request.message, 2000);
  },
};

async function handleMessage(request, sender) {
  if (
    !Utils.isFirefox() &&
    (!BrowserToolboxMessageProtocol.isTrustedSender(sender, chrome.runtime.id) ||
      sender.documentId != null ||
      sender.url && sender.url !== chrome.runtime.getURL("background_scripts/main.js"))
  ) return;
  // Some requests are so frequent and noisy (like checkEnabledAfterURLChange on
  // docs.google.com) that we silence debug logging for just those requests so the rest remain
  // useful.
  if (!request.silenceLogging) {
    Utils.debugLog(
      "frontend.js: onMessage:%otype:%o",
      request.handler,
      request.messageType,
      // request // Often useful for debugging.
    );
  }
  request.isTrusted = true;
  // Some request are handled elsewhere in the code base; ignore them here.
  const shouldHandleMessage = request.handler !== "userIsInteractingWithThePage" &&
    (isEnabledForUrl ||
      [
        "checkEnabledAfterURLChange",
        "runInTopFrame",
        "browserToolbox.runtimeDiagnostics",
        "browserToolbox.restoreCompatibleRuntime",
        "browserToolbox.pauseRuntime",
      ].includes(request.handler));
  if (shouldHandleMessage) {
    const result = await messageHandlers[request.handler](request, sender);
    return result;
  }
}

//
// Complete initialization work that should be done prior to DOMReady.
//
async function initializePreDomReady() {
  BrowserToolboxRuntimeHostInstance.markInitializationStage("ui-authorization");
  await globalThis.BrowserToolboxUIAuthorization?.ready;
  BrowserToolboxRuntimeHostInstance.markInitializationStage("register-listeners");
  const remove = Utils.addChromeRuntimeOnMessageListener(
    Object.keys(messageHandlers),
    handleMessage,
  );
  BrowserToolboxDocumentResources.add(remove);
  // 页面命令入口属于文档承载层，与鼠标识别器的创建、销毁相互独立。
  const pageCommandListener = (message, sender, sendResponse) => {
    const protocol = globalThis.BrowserToolboxMessageProtocol;
    const v2 = message?.handler === "browserToolbox.message" && message.kind === "command" &&
      message.action === "execute" && protocol?.validateEnvelope(message);
    const lifecycle = message?.handler === "browserToolbox.message" &&
      message.kind === "lifecycle" &&
      ["relay", "hints"].includes(message.action) && protocol?.validateEnvelope(message);
    if (
      (!v2 && !lifecycle &&
        (message?.type !== "browserToolbox.executePageCommand" || !protocol?.validate(message))) ||
      !protocol.isTrustedSender(sender, chrome.runtime.id) ||
      !Utils.isFirefox() &&
        (sender.documentId != null ||
          sender.url && sender.url !== chrome.runtime.getURL("background_scripts/main.js"))
    ) return false;
    if (lifecycle) {
      const host = globalThis.BrowserToolboxRuntimeHostInstance;
      if (
        host?.state !== "active" || host.suspended ||
        message.identity?.documentId !== host.context.documentId ||
        message.identity.runtimeEpoch !== host.runtimeEpoch
      ) {
        sendResponse({ ok: false, code: "STALE_RUNTIME" });
        return false;
      }
      const request = message.payload.message;
      const handler = message.action === "hints"
        ? messageHandlers.linkHintsMessage
        : messageHandlers[request?.handler];
      if (request?.handler === "userIsInteractingWithThePage" && message.action === "relay") {
        Mode.modes.filter((mode) => mode.name === "grab-back-focus").forEach((mode) => mode.exit());
        sendResponse({ ok: true });
      } else if (
        handler &&
        !["runInTopFrame", "browserToolbox.restoreCompatibleRuntime"].includes(request?.handler)
      ) {
        // 同步动作在当前收件调用内回复；只有真正的异步动作才持有消息通道。
        // 无返回值表示已收件，不能当作命令成功；同步抛错也必须有明确失败结果。
        const deliver = (value) => sendResponse(value === undefined
          ? { ok: true, code: "LIFECYCLE_DELIVERED" } : value);
        try {
          const value = handler({ ...request, isTrusted: true }, sender);
          if (value && typeof value.then === "function") {
            Promise.resolve(value).then(deliver).catch(() =>
              sendResponse({ ok: false, code: "INTERACTION_UNAVAILABLE" }));
            return true;
          }
          deliver(value);
        } catch (_) {
          sendResponse({ ok: false, code: "INTERACTION_UNAVAILABLE" });
        }
      } else sendResponse({ ok: false, code: "INVALID_MESSAGE_ACTION" });
      return false;
    }
    const invocation = v2
      ? {
        ...message.payload.invocation,
        identity: message.identity,
        context: {
          ...message.payload.invocation.context,
          sourceDocumentId: message.payload.invocation.identity.documentId,
        },
      }
      : message.invocation;
    BrowserToolboxPageCommandExecutorInstance.execute(invocation).then(sendResponse).catch(
      () => {
        sendResponse(
          BrowserToolboxCommandInvocation.createResult(
            false,
            v2 ? "RESULT_UNKNOWN" : "COMMAND_FAILED",
          ),
        );
      },
    );
    return true;
  };
  chrome.runtime.onMessage.addListener(pageCommandListener);
  BrowserToolboxDocumentResources.add(() =>
    chrome.runtime.onMessage.removeListener(pageCommandListener)
  );
  await checkIfEnabledForUrl();
}

let frameInitialization = null;
let frameInitializationGeneration = 0;
let initialFrameContext = null;
async function checkIfEnabledForUrl() {
  const host = globalThis.BrowserToolboxRuntimeHostInstance;
  if (!host || host.disposed || host.suspended || runtimeMaintenancePaused) return;
  if (frameInitialization) return frameInitialization;
  const generation = frameInitializationGeneration;
  const current = () =>
    generation === frameInitializationGeneration && !host.disposed && !host.suspended;
  const loading = (async () => {
    let stage = "read-context";
    host.markInitializationStage(stage);
    try {
      let loaded;
      // 后台刚终止时首个读取可能被拒绝；只重试幂等握手/设置读取，不重放任何用户命令。
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!current()) return;
        try {
          const initial = initialFrameContext;
          initialFrameContext = null;
          loaded = await Promise.all([
            initial?.ready || BrowserToolboxFrameRuntimeBridgeInstance.initializeFrame(),
            initial ? initial.readSettings() : BrowserToolboxSettingsProviderInstance.load(),
          ]);
          break;
        } catch (error) {
          if (attempt === 2 || extensionHasBeenUnloaded()) throw error;
          await new Promise((resolve) => {
            let finish;
            const timer = setTimeout(() => finish(), 100 * (attempt + 1));
            finish = host.documentResources.add(() => {
              clearTimeout(timer);
              resolve();
            }, "timer");
          });
        }
      }
      const [response, snapshot] = loaded;
      if (!current()) return;
      vimiumEnabledForUrl = response.isEnabledForUrl;
      Utils._isFirefox = response.isFirefox;
      Utils._firefoxVersion = response.firefoxVersion;
      Utils._browserInfoLoaded = true;
      globalThis.frameId = response.frameId;
      if (!host.engine) {
        stage = "prepare-engine";
        host.markInitializationStage(stage);
        const prepared = await host.prepare(
          globalThis.BrowserToolboxRuntimePlans?.allowed.find((plan) =>
            plan.planVersion === (response.planVersion || 1)) || BrowserToolboxRuntime.COMPAT_PLAN,
          snapshot.revision,
          response,
        );
        stage = "activate-engine";
        host.markInitializationStage(stage);
        await host.activate(prepared);
      }
      stage = "apply-settings";
      host.markInitializationStage(stage);
      normalMode.setPassKeys(response.passKeys);
      await host.setEffectiveSettings(snapshot, "frame-handshake");
      host.lastFailureStage = null;
      host.markInitializationStage("ready");
    } catch (_) {
      if (!current()) return;
      await host.deactivate("initialization-failed");
      host.state = "failed";
      host.lastErrorCode = "FRAME_INITIALIZATION_FAILED";
      host.lastFailureStage = stage;
      isEnabledForUrl = false;
    }
  })();
  frameInitialization = loading;
  try {
    await loading;
  } finally {
    if (frameInitialization === loading) frameInitialization = null;
  }
}

function createCompatRuntimeHost() {
  if (globalThis.BrowserToolboxRuntimeHostInstance) {
    return globalThis.BrowserToolboxRuntimeHostInstance;
  }
  const compat = globalThis.BrowserToolboxCompatRuntime;
  const initial = globalThis.BrowserToolboxInitialRuntimeContext?.claim();
  globalThis.BrowserToolboxInitialRuntimeContext = null;
  initialFrameContext = initial?.ready ? initial : null;
  const provider = initial?.provider || new compat.SettingsProvider({
    legacy: globalThis.BrowserToolboxVimiumSettingsAdapterInstance,
    runtimeSettings: globalThis.BrowserToolboxSettingsRuntimeClientInstance,
    repository: globalThis.BrowserToolboxSettingsRepositoryInstance,
    url: () => document.location.href,
  });
  const bridge = initial?.bridge || new compat.FrameRuntimeBridge(chrome.runtime);
  // 只在隔离输入包预读既有 session 数据，默认兼容包不创建额外读取或订阅。
  const inputSnapshot = globalThis.BrowserToolboxRuntimePlans?.COMPILED_CANARY
    ? new BrowserToolboxInputRuntime.SessionSnapshotReader(chrome, BrowserToolboxDocumentResources)
    : null;
  (inputSnapshot?.preload ? inputSnapshot.preload() : inputSnapshot?.read())?.catch(() => {});
  globalThis.BrowserToolboxSettingsProviderInstance = provider;
  globalThis.BrowserToolboxFrameRuntimeBridgeInstance = bridge;
  const host = new BrowserToolboxRuntime.RuntimeHost({
    eventTarget: globalThis,
    documentTarget: document,
    documentResources: BrowserToolboxDocumentResources,
    allowedPlans: globalThis.BrowserToolboxRuntimePlans?.allowed || [BrowserToolboxRuntime.COMPAT_PLAN],
    authorizeContext: (context, epoch) => bridge.registerSession(context, epoch),
    isContextValid: () => !extensionHasBeenUnloaded(),
    applyDecision: (type, event, decision) =>
      handlerStack.applyEventDecision(type, event, decision),
    beforeEvent: (type, event) => {
      if (type === "focus") {
        if (event.target === window) {
          windowHasFocus = true;
          checkIfEnabledForUrl();
        }
        if (DomUtils.isEditable(event.target)) recentlyFocusedElement = event.target;
      } else if (type === "blur" && event.target === window) windowHasFocus = false;
    },
    onLifecycle: (type, event) => {
      if (type === "pagehide") {
        // 导航冻结尚未返回的握手；恢复必须新读身份，旧 Promise 不能占用新初始化入口。
        frameInitializationGeneration++;
        frameInitialization = null;
        initialFrameContext = null;
        bridge.invalidateSession();
        provider.invalidate();
        inputSnapshot?.invalidate();
        if (host.context.documentId) {
          chrome.runtime.sendMessage(
            BrowserToolboxMessageProtocol.envelope("lifecycle", "unregister", {}, {
              documentId: host.context.documentId,
              runtimeEpoch: host.runtimeEpoch,
              incognito: host.context.incognito === true,
            }),
          ).catch(() => {});
        }
        host.deactivate("pagehide");
      } else if (type === "hashchange") checkEnabledAfterURLChange({ isTrusted: true });
      else {
        if (type === "pageshow" && !event.persisted) return;
        host.suspended = false;
        globalThis.BrowserToolboxSettingsRuntimeClientInstance?.invalidate();
        checkIfEnabledForUrl().then(() => {
          if (DomUtils.isReady() && host.state === "active") return bridge.ready();
        }).catch(() => {});
      }
    },
    engineFactory: (plan) => {
      const Engine = plan.moduleImplementations.input === "browser-toolbox" ? BrowserToolboxInputRuntime.KeyboardEngine : compat.KeyboardEngine;
      return new Engine({
        handlerStack: {
          decideEvent: (type, event) =>
            isEnabledForUrl ? handlerStack.decideEvent(type, event) : BrowserToolboxRuntime.PASS,
        },
        installModes: (inputSettings) => installModes(plan, inputSettings),
        enabled: () => isEnabledForUrl,
        cleanup: cleanupCompatRuntime,
        applySettings: (snapshot) => {
          isEnabledForUrl = vimiumEnabledForUrl &&
            snapshot.effective?.effectiveModules?.keyboard !== false;
          if (!isEnabledForUrl) HUD.hide(true, false);
        },
        pageExecutor: BrowserToolboxPageCommandExecutorInstance,
        plan,
        inputSnapshot,
      });
    },
  });
  globalThis.BrowserToolboxRuntimeHostInstance = host;
  // 初次load的返回值会在引擎就绪后应用；避免为尚无引擎的空操作克隆整份配置。
  BrowserToolboxDocumentResources.add(provider.subscribe((snapshot) => {
    host.setEffectiveSettings(snapshot, "settings-change").catch(() => {});
  }, { when: () => Boolean(host.engine) }));
  BrowserToolboxDocumentResources.add(() => provider.destroy());
  BrowserToolboxDocumentResources.add(() => bridge.destroy());
  BrowserToolboxDocumentResources.add(() =>
    globalThis.BrowserToolboxSettingsRuntimeClientInstance?.destroy()
  );
  return host;
}

// 帮助页需要知道当前页面的有效模块状态，但不应自行读取或修改设置；这里沿用内容脚本
// 已经使用的只读运行时客户端，并只把可展示的摘要传给扩展页面。
async function getBrowserToolboxHelpContext() {
  const runtime = globalThis.BrowserToolboxSettingsRuntimeClientInstance;
  const repository = globalThis.BrowserToolboxSettingsRepositoryInstance;
  const moduleRegistry = globalThis.BrowserToolboxModuleRegistry;
  const matcher = globalThis.BrowserToolboxSiteRuleMatcher;
  let effective = null;
  try {
    if (runtime?.ensureLoaded) {
      effective = await runtime.ensureLoaded(document.location.href);
    } else if (repository) {
      await repository.ensureLoaded(globalThis.BrowserToolboxCommandRegistry);
      effective = repository.getEffectiveSettings(document.location.href);
    }
  } catch (_) {
    // 帮助页不是运行时开关的依赖；状态读取失败时仍显示静态使用说明。
  }

  const moduleIds = moduleRegistry?.ids?.({ siteRule: true }) || [
    "keyboard",
    "mouse",
    "superDrag",
    "wheel",
    "rocker",
    "cursor",
  ];
  const modules = effective?.effectiveModules || {};
  let matchedRule = null;
  if (Array.isArray(effective?.siteRules) && matcher?.explain) {
    const defaults = {
      enabled: effective.general?.enabled !== false,
      ...(moduleRegistry?.enabledDefaults?.(effective) || {}),
    };
    const explanation = matcher.explain(effective.siteRules, document.location.href, defaults);
    if (explanation.effectiveRule) {
      matchedRule = {
        matchType: explanation.effectiveRule.matchType || "glob",
        pattern: explanation.effectiveRule.pattern,
      };
    }
  }

  return {
    stateAvailable: Boolean(effective),
    disabledModules: moduleIds.filter((id) => modules[id] === false),
    matchedRule,
    vimiumExcluded: vimiumEnabledForUrl === false,
  };
}

// If this content script is running in the help dialog's iframe, then use the HelpDialogPage's
// methods to control the dialog. Otherwise, load the help dialog in a UIComponent iframe.
const HelpDialog = {
  helpUI: null,
  hiding: null,

  isShowing() {
    if (globalThis.isVimiumHelpDialogPage) return true;
    const help = globalThis.BrowserToolboxUIControllerInstance?.help;
    if (help) return help.showing;
    return this.helpUI && this.helpUI.showing;
  },

  abort() {
    if (globalThis.isVimiumHelpDialogPage) throw new Error("This should be impossible.");
    const help = globalThis.BrowserToolboxUIControllerInstance?.help;
    if (help) return help.abort(false);
    if (this.isShowing()) {
      return this.hiding = this.helpUI.hide(false);
    }
  },

  async toggle(request) {
    // If we're in the help dialog page already and the user has typed a key to show the help
    // dialog, then we should hide it.
    if (globalThis.isVimiumHelpDialogPage) return HelpDialogPage.hide();

    const ui = globalThis.BrowserToolboxUIControllerInstance;
    if (ui?.valid() && (
      ui.host.plan.moduleImplementations.help === "browser-toolbox" ||
      ui.host.plan === BrowserToolboxRuntimePlans.UI_CANARY_PLAN
    )) {
      ui.help ||= new BrowserToolboxHelpRuntime.Controller(ui, getBrowserToolboxHelpContext);
      return ui.help.toggle(request);
    }

    const host = globalThis.BrowserToolboxRuntimeHostInstance;
    const epoch = host?.runtimeEpoch;
    const stillActive = () =>
      !host || !host.disposed && !host.suspended &&
        host.runtimeEpoch === epoch && !["disabled", "deactivating", "failed"].includes(host.state);

    if (this.helpUI == null) {
      await DomUtils.documentComplete();
      if (!stillActive()) return;
      this.helpUI = new UIComponent();
      this.helpUI.load("pages/help_dialog_page.html", "vimium-help-dialog-frame");
    }
    if (this.isShowing()) {
      return this.hiding = this.helpUI.hide();
    } else {
      await this.hiding;
      if (!stillActive()) return;
      const browserToolbox = await getBrowserToolboxHelpContext();
      if (!stillActive()) return;
      return this.helpUI.show(
        { name: "show", browserToolbox },
        { focus: true, sourceFrameId: request.sourceFrameId },
      );
    }
  },
};

const testEnv = globalThis.window == null;
if (!testEnv) {
  createCompatRuntimeHost();
  initWindowIsFocused();
  const initialization = initializePreDomReady().catch(onUnload);
  DomUtils.documentReady().then(async () => {
    await initialization;
    if (BrowserToolboxRuntimeHostInstance.state === "active") await initializeOnDomReady();
  }).catch(() => {});
}

Object.assign(globalThis, {
  HelpDialog,
  // Exported only for tests and the help-dialog integration path.
  getBrowserToolboxHelpContext,
  handlerStack,
  windowIsFocused,
  // These are exported for normal mode and link-hints mode.
  focusThisFrame,
  // Exported only for tests.
  installModes,
  createCompatRuntimeHost,
  checkIfEnabledForUrl,
});

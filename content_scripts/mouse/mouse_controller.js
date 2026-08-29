// 鼠标输入总控制器。它只识别输入并生成 Invocation，不直接调用 tabs/windows API。
(function () {
  const invocationApi = globalThis.BrowserToolboxCommandInvocation;
  const protocol = globalThis.BrowserToolboxMessageProtocol;
  const repository = globalThis.BrowserToolboxSettingsRepositoryInstance;
  const runtimeSettings = globalThis.BrowserToolboxSettingsRuntimeClientInstance;
  const recognizer = globalThis.BrowserToolboxGestureRecognizer;
  const NATIVE_MENU_RETRY_MS = 600;
  const NATIVE_MENU_RETRY_DISTANCE_PX = 12;

  function trusted(event) {
    return globalThis.isUnitTests || event.isTrusted === true;
  }

  function localizedMessage(key, fallback) {
    const i18n = globalThis.BrowserToolboxI18n;
    return i18n?.hasMessage?.(key) ? i18n.message(key) : fallback;
  }

  function commandHudLabel(binding) {
    const commandName = binding?.commandName;
    if (typeof commandName !== "string" || commandName.length === 0) return "";
    const key = commandName === "reload" && binding.options?.hard === true
      ? "command_reloadHard"
      : `command_${commandName.replaceAll(".", "_")}`;
    return localizedMessage(key, commandName);
  }

  function pageContext(extra = {}) {
    return Object.assign({
      pageUrl: globalThis.location?.href || "",
      topFrame: globalThis.window?.top === globalThis.window,
    }, extra);
  }

  async function copyText(text) {
    if (typeof text !== "string" || text.length === 0) {
      return invocationApi.createResult(false, invocationApi.ERROR_CODES.NO_MATCHING_ELEMENT);
    }
    try {
      await navigator.clipboard.writeText(text);
      return invocationApi.createResult(true);
    } catch (_) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.documentElement.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand?.("copy") === true;
      textarea.remove();
      return ok
        ? invocationApi.createResult(true)
        : invocationApi.createResult(false, invocationApi.ERROR_CODES.CLIPBOARD_DENIED);
    }
  }

  async function executePageInvocation(invocation) {
    const entry = Object.assign({
      command: invocation.commandName,
      options: invocation.options || {},
    }, globalThis.BrowserToolboxCommandRegistry?.getCommand?.(invocation.commandName) || {});
    const count = invocation.count || 1;
    const command = globalThis.NormalModeCommands?.[invocation.commandName];
    if (typeof command === "function") {
      await command(count, { registryEntry: entry });
      return invocationApi.createResult(true);
    }
    const context = invocation.context || {};
    switch (invocation.commandName) {
      case "BrowserToolbox.copySelection":
        return copyText(globalThis.getSelection?.()?.toString() || context.selectedText || "");
      case "BrowserToolbox.copyLinkText":
        return copyText(context.linkText || "");
      case "BrowserToolbox.copyLinkUrl":
      case "BrowserToolbox.copyImageUrl":
        return copyText(context.linkUrl || context.imageUrl || "");
      case "BrowserToolbox.downloadImage": {
        const url = context.imageUrl;
        if (!invocationApi.isAllowedUrl(url)) {
          return invocationApi.createResult(
            false,
            invocationApi.ERROR_CODES.BLOCKED_URL_SCHEME,
            url,
          );
        }
        const link = document.createElement("a");
        link.href = url;
        link.download = "";
        link.rel = "noreferrer";
        link.style.display = "none";
        document.documentElement.appendChild(link);
        link.click();
        link.remove();
        return invocationApi.createResult(true);
      }
      default:
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.UNKNOWN_COMMAND);
    }
  }

  class MouseController {
    constructor(doc = globalThis.document) {
      this.document = doc;
      this.gesture = null;
      this.gestureRequestId = null;
      this.drag = null;
      this.settings = null;
      this.overlay = null;
      this.guard = null;
      this.wheel = null;
      this.rocker = null;
      this.bridge = null;
      this.cursor = null;
      this.settingsListener = null;
      this.nativeDragTarget = null;
      this.nativeDragAttribute = null;
      this.gestureTimeoutId = null;
      this.lastGestureMatch = null;
      this.pageshowListener = () => {
        if (!this.initialized || this.listeners.length === 0) this.init();
      };
      this.suppressClickUntil = 0;
      this.listeners = [];
      this.initialized = false;
      this.initializing = false;
      globalThis.addEventListener?.("pageshow", this.pageshowListener, true);
    }

    async init() {
      const currentDocument = globalThis.document;
      if (this.initializing) return;
      if (
        this.initialized && this.document === currentDocument && this.listeners.length > 0
      ) return;
      if (this.initialized) this.destroy();
      this.document = currentDocument;
      if ((!repository && !runtimeSettings) || !this.document?.addEventListener) return;
      this.initializing = true;
      this.initialized = true;
      try {
        await this.refreshSettings();
        this.overlay = new globalThis.BrowserToolboxGestureOverlay(this.document);
        this.guard = new globalThis.BrowserToolboxContextMenuGuard();
        this.wheel = new globalThis.BrowserToolboxWheelGestureController();
        this.rocker = new globalThis.BrowserToolboxRockerGestureController();
        this.cursor = new globalThis.BrowserToolboxCursorController(this.document);
        this.installListeners();
        this.settingsListener = (settings) => {
          this.settings = settings;
          this.drag?.updateSettings(this.settings.superDrag);
          this.applyCursor().catch(() => {});
        };
        if (runtimeSettings) runtimeSettings.addEventListener(this.settingsListener);
        else repository.addEventListener(this.settingsListener);
        this.applyCursor();
      } finally {
        this.initializing = false;
      }
    }

    async refreshSettings() {
      const url = globalThis.location?.href || "";
      if (runtimeSettings) this.settings = await runtimeSettings.ensureLoaded(url);
      else if (repository) {
        await repository.ensureLoaded();
        this.settings = repository.getEffectiveSettings(url);
      }
      this.drag?.updateSettings(this.settings?.superDrag);
      return this.settings;
    }

    effective(moduleName) {
      return this.settings?.effectiveModules?.[moduleName] !== false &&
        this.settings?.general?.enabled !== false;
    }

    showCommandHud() {
      return this.settings?.general?.showHud !== false &&
        this.settings?.mouse?.showCommandHud !== false;
    }

    updateGestureFeedback(result, point) {
      const match = recognizer.find(result.pattern, this.settings.mouse.bindings);
      if (match.exact) {
        this.lastGestureMatch = {
          pattern: match.pattern.slice(),
          binding: match.exact,
        };
      }
      const cancelHovered = this.overlay?.isCancelPoint(point) === true;
      this.overlay?.setCancelHover(cancelHovered);
      if (this.showCommandHud() && match.pattern.length > 0) {
        const displayMatch = cancelHovered && this.lastGestureMatch
          ? this.lastGestureMatch
          : { pattern: match.pattern, binding: match.exact };
        this.overlay.setGesture(
          displayMatch.pattern,
          commandHudLabel(displayMatch.binding),
          {
            cancelLabel: localizedMessage("cancel", "Cancel"),
            cancelHovered,
          },
        );
      }
      return { cancelHovered, match };
    }

    cancelFromTarget(event) {
      this.clearGestureTimeout();
      event.preventDefault();
      event.stopPropagation();
      this.gesture?.cancel("cancel-target");
      this.bridge?.cancel();
      this.bridge = null;
      this.gesture = null;
      this.gestureRequestId = null;
      this.lastGestureMatch = null;
      if (
        event.button === 2 &&
        this.settings.mouse.suppressContextMenuAfterActivation !== false
      ) {
        // 进入取消目标代表本次输入已经被手势层接管；抬键后的 contextmenu 仍需一次性拦截。
        this.guard.activate();
        this.guard.armForContextMenu();
        this.guard.deactivate();
      } else {
        this.guard.reset();
      }
      this.overlay.hide();
    }

    gestureButton() {
      const button = this.settings?.mouse?.triggerButton;
      return Number.isInteger(button) && [0, 1, 2].includes(button) ? button : 2;
    }

    installListeners() {
      const capture = { capture: true, passive: false };
      this.listen("pointerdown", (event) => this.onPointerDown(event), capture);
      this.listen("mousedown", (event) => this.onMouseDown(event), capture);
      this.listen("pointermove", (event) => this.onPointerMove(event), capture);
      this.listen("pointerup", (event) => this.onPointerUp(event), capture);
      this.listen("mouseup", (event) => this.onMouseUp(event), capture);
      this.listen("pointercancel", (event) => this.onPointerCancel(event), capture);
      this.listen("dragstart", (event) => this.onDragStart(event), capture);
      this.listen("click", (event) => this.onClick(event), capture);
      this.listen("contextmenu", (event) => this.onContextMenu(event), capture);
      this.listen("wheel", (event) => this.onWheel(event), { capture: true, passive: false });
      this.listen("keydown", (event) => this.onKeyDown(event), capture);
      this.listen("blur", () => {
        // Chrome 在超级拖拽起始阶段可能短暂触发页面失焦，保留已分类的拖拽会话。
        if (this.drag) return;
        this.cancelAll("blur");
      }, { capture: true, passive: true });
      this.listen("visibilitychange", () => {
        if (this.document.visibilityState !== "visible") this.cancelAll("hidden");
      }, { capture: true, passive: true });
    }

    listen(name, listener, options) {
      this.document.addEventListener(name, listener, options);
      this.listeners.push(() => this.document.removeEventListener(name, listener, options));
    }

    onPointerDown(event) {
      if (!trusted(event) || event.pointerType && event.pointerType !== "mouse") return;
      if (!this.gesture) {
        // 上一次已完成轨迹可能等待浏览器补发 contextmenu；新的鼠标输入开始时丢弃过期的一次性保护。
        this.guard?.clearPending();
      }
      const gestureButton = this.gestureButton();
      const isRightGesture = event.button === 2 && gestureButton === 2;
      const capturesEarlyContextMenu = isRightGesture &&
        this.settings.mouse.suppressContextMenuAfterActivation !== false;
      if (
        capturesEarlyContextMenu &&
        this.guard?.consumeNativeMenuRetry(
          { x: event.clientX, y: event.clientY },
          NATIVE_MENU_RETRY_DISTANCE_PX,
        )
      ) {
        // 第一次轻点已经证明用户没有画轨迹；近距离双击右键的第二次输入直接交给浏览器。
        return;
      }
      if (!isRightGesture) this.guard?.clearNativeMenuRetry();
      if (
        this.gesture?.isActive() &&
        (event.button === gestureButton || event.button === 0 || event.button === 2)
      ) {
        // ACTIVE 轨迹已经接管输入，避免第二个鼠标键再启动超级拖拽或其他组合。
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.button === gestureButton && this.effective("mouse")) {
        this.clearGestureTimeout();
        this.gesture = new globalThis.BrowserToolboxGestureSession(this.settings.mouse);
        this.gesture.start({ x: event.clientX, y: event.clientY }, event.timeStamp || Date.now());
        this.lastGestureMatch = null;
        // 取消目标是独立的手势控制，不属于方向 HUD；第一次按下即显示。
        // 快速第二次右键已在上方提前放行，不会创建会话，也不会闪现取消目标。
        this.overlay.showCancel({ label: localizedMessage("cancel", "Cancel") });
        if (capturesEarlyContextMenu) this.guard?.startPendingGesture();
        this.bridge = new globalThis.BrowserToolboxFrameGestureBridge();
        const invocation = invocationApi.createInvocation(
          "__gesture__",
          {},
          { type: "mouseGesture" },
          pageContext(),
          1,
        );
        this.gestureRequestId = invocation.requestId;
        this.bridge.start(invocation.requestId);
        this.scheduleGestureTimeout();
        return;
      }
      if (event.button === 0 && gestureButton !== 0 && this.effective("superDrag")) {
        const selection = this.document.defaultView?.getSelection?.()?.toString() || "";
        this.drag = new globalThis.BrowserToolboxSuperDragController(this.settings.superDrag);
        if (!this.drag.pointerDown(event, selection, event.dataTransfer)) {
          this.drag = null;
        } else {
          this.suppressNativeDrag(event.target, this.drag.context?.type);
          if (this.drag.context?.type === "IMAGE") {
            // Chrome 图片原生拖拽会在首个移动前触发失焦；图片已由超级拖拽接管，阻止默认拖拽。
            event.preventDefault();
            event.stopPropagation();
          }
        }
      }
    }

    onMouseDown(event) {
      if (!trusted(event)) return;
      const gestureButton = this.gestureButton();
      if (
        this.gesture?.isActive() &&
        (event.button === gestureButton || event.button === 0 || event.button === 2)
      ) {
        // ACTIVE 轨迹已经接管输入；此时第二个鼠标键不能再触发摇杆组合。
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!this.effective("rocker")) return;
      const sequence = this.rocker.pointerDown(event.button);
      if (!sequence) return;
      const binding = this.settings.rocker.bindings.find((item) =>
        item.enabled !== false && item.sequence === sequence
      );
      if (!binding) return;
      event.preventDefault();
      event.stopPropagation();
      this.dispatchBinding(
        binding,
        "rocker",
        pageContext({ pointer: { x: event.clientX, y: event.clientY } }),
      );
      this.cancelAll("rocker", { preserveRocker: true });
    }

    onPointerMove(event) {
      if (!trusted(event)) return;
      if (this.gesture) {
        const result = this.gesture.move(
          { x: event.clientX, y: event.clientY },
          event.timeStamp || Date.now(),
        );
        if (result.activated) {
          if (this.settings.mouse.suppressContextMenuAfterActivation !== false) {
            this.guard.activate();
          }
          if (this.settings.mouse.showTrail) this.overlay.show();
          event.preventDefault();
          event.stopPropagation();
        }
        if (this.gesture.isActive()) {
          event.preventDefault();
          event.stopPropagation();
          if (this.settings.mouse.showTrail) this.overlay.draw(result.points);
          // 激活距离和方向分段阈值不同；只有真正量化出方向后才展开 HUD。
          this.updateGestureFeedback(result, { x: event.clientX, y: event.clientY });
          this.bridge?.update(result.pattern.at(-1));
        }
      }
      if (this.drag) {
        const result = this.drag.pointerMove(event);
        if (this.drag.active) {
          event.preventDefault();
          event.stopPropagation();
          this.overlay.show();
          this.overlay.draw(result.points);
          if (result.pattern?.length && this.showCommandHud()) {
            this.overlay.setHud(recognizer.format(result.pattern), true);
          }
        }
      }
    }

    async onPointerUp(event) {
      if (!trusted(event)) return;
      this.wheel?.release(event.button);
      if (this.gesture && event.button === this.gestureButton()) {
        if (
          this.gesture.isActive() &&
          this.overlay?.isCancelPoint({ x: event.clientX, y: event.clientY })
        ) {
          this.cancelFromTarget(event);
          return;
        }
        this.clearGestureTimeout();
        const result = this.gesture.end(event.timeStamp || Date.now());
        const shouldArmNativeMenuRetry = result.state === "NATIVE_CONTEXT_MENU" &&
          event.button === 2 &&
          this.settings.mouse.suppressContextMenuAfterActivation !== false;
        if (
          result.state === "COMPLETED" &&
          this.settings.mouse.suppressContextMenuAfterActivation !== false
        ) {
          this.guard.armForContextMenu();
        } else {
          this.guard.reset();
        }
        if (result.state === "COMPLETED") {
          event.preventDefault();
          event.stopPropagation();
          const bridgeReady = this.bridge?.waitUntilReady
            ? await this.bridge.waitUntilReady()
            : true;
          const match = recognizer.find(result.pattern, this.settings.mouse.bindings);
          if (bridgeReady && match.exact) {
            await this.dispatchBinding(
              match.exact,
              "mouseGesture",
              pageContext({ pointer: { x: event.clientX, y: event.clientY } }),
              this.gestureRequestId,
            );
          } else if (!bridgeReady) {
            this.bridge?.cancel();
          } else {
            if (this.showCommandHud()) {
              this.overlay.setHud(
                globalThis.BrowserToolboxI18n?.message("gestureUnrecognized") ||
                  "Gesture not recognized",
                true,
              );
            }
          }
          this.bridge?.finish(result.pattern);
        } else {
          this.bridge?.cancel();
        }
        this.bridge = null;
        this.gesture = null;
        this.gestureRequestId = null;
        this.lastGestureMatch = null;
        if (result.state === "COMPLETED") this.guard.deactivate();
        else if (shouldArmNativeMenuRetry) {
          // 首次右键轻点不伪造菜单，只给下一次近距离右键保留一个短暂的原生菜单入口。
          this.guard.armNativeMenuRetry(
            { x: event.clientX, y: event.clientY },
            NATIVE_MENU_RETRY_MS,
          );
        }
        this.overlay.hide();
      }
      if (this.drag && event.button === 0) {
        const result = this.drag.pointerUp(event.timeStamp || Date.now());
        if (result.active) {
          event.preventDefault();
          event.stopPropagation();
          this.suppressClickUntil = Date.now() + 500;
          if (result.binding) {
            this.dispatchBinding(result.binding, "superDrag", pageContext(result.context));
          }
        }
        this.restoreNativeDrag();
        this.drag = null;
        this.overlay.hide();
      }
      if (this.rocker?.pointerUp(event.button)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    onMouseUp(event) {
      this.wheel?.release(event.button);
      if (!trusted(event) || !this.rocker?.pointerUp(event.button)) return;
      event.preventDefault();
      event.stopPropagation();
    }

    onContextMenu(event) {
      if (this.guard?.shouldSuppress()) {
        if (
          this.guard.provisional &&
          this.gesture?.state === "PENDING" &&
          this.gestureButton() === 2
        ) {
          // contextmenu 自带的可信坐标可能已经越过阈值，先补采样再决定是否进入 ACTIVE。
          const result = this.gesture.move(
            { x: event.clientX, y: event.clientY },
            event.timeStamp || Date.now(),
          );
          if (result.activated) {
            this.guard.activate();
            if (this.settings.mouse.showTrail) {
              this.overlay.show();
              this.overlay.draw(result.points);
            }
            this.updateGestureFeedback(result, { x: event.clientX, y: event.clientY });
            this.bridge?.update(result.pattern.at(-1));
          }
        }
        event.preventDefault();
        event.stopPropagation();
        this.guard.consume();
        return;
      }
      if (
        trusted(event) &&
        !event.defaultPrevented &&
        event.button === 2 &&
        this.gesture &&
        this.gesture.state === "PENDING" &&
        this.gestureButton() === 2
      ) {
        const result = this.gesture.contextMenu(
          { x: event.clientX, y: event.clientY },
          event.timeStamp || Date.now(),
        );
        if (result.state === "ACTIVE") {
          // 浏览器可能先送达已位移坐标的 contextmenu；此时轨迹已经越过阈值，按 ACTIVE 处理。
          if (this.settings.mouse.suppressContextMenuAfterActivation !== false) {
            this.guard.activate();
            event.preventDefault();
            event.stopPropagation();
            this.guard.consume();
          }
          if (this.settings.mouse.showTrail) {
            this.overlay.show();
            this.overlay.draw(result.points);
          }
          this.updateGestureFeedback(result, { x: event.clientX, y: event.clientY });
          this.bridge?.update(result.pattern.at(-1));
          return;
        }
        if (result.state === "NATIVE_CONTEXT_MENU") {
          // 未越过阈值的菜单进入终态；先保留状态转换，再清理候选，后续移动不能延迟激活。
          this.gesture = null;
          this.cancelAll("native-context-menu", { preserveRocker: this.rocker?.held === 2 });
        } else if (result.state === "CANCELLED") {
          this.cancelAll("timeout", { preserveRocker: this.rocker?.held === 2 });
        }
      }
    }

    onDragStart(event) {
      // 只有已越过超级拖拽阈值才接管，避免破坏文件上传和普通原生拖拽。
      if (!this.drag?.active) return;
      event.preventDefault();
      event.stopPropagation();
    }

    onPointerCancel(event) {
      // Chrome 在原生拖拽开始前可能先发 pointercancel；超级拖拽仍需让 dragstart 进入接管逻辑。
      if (this.drag && ["LINK", "IMAGE"].includes(this.drag.context?.type)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.cancelAll("pointercancel");
    }

    onClick(event) {
      // pointerup 后浏览器仍可能为链接生成 click；只抑制本次已接管的超级拖拽。
      if (Date.now() > this.suppressClickUntil) {
        this.suppressClickUntil = 0;
        return;
      }
      this.suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    }

    onWheel(event) {
      if (!trusted(event) || !this.effective("wheel")) return;
      const result = this.wheel.handle({
        buttons: event.buttons,
        deltaY: event.deltaY,
        now: Date.now(),
        settings: this.settings.wheel,
      });
      if (!result) return;
      const binding = this.settings.wheel.bindings.find((item) =>
        item.enabled !== false && item.button === result.button &&
        item.direction === result.direction
      );
      if (!binding) return;
      event.preventDefault();
      event.stopPropagation();
      this.dispatchBinding(
        binding,
        "wheel",
        pageContext({ pointer: { x: event.clientX, y: event.clientY } }),
      );
    }

    onKeyDown(event) {
      if (event.key === "Escape" && (this.gesture?.isActive() || this.drag?.active)) {
        event.preventDefault();
        this.cancelAll("escape");
      }
    }

    cancelAll(reason, { preserveRocker = false } = {}) {
      this.clearGestureTimeout();
      this.gesture?.cancel(reason);
      this.drag?.cancel();
      this.restoreNativeDrag();
      this.bridge?.cancel();
      this.bridge = null;
      this.gesture = null;
      this.gestureRequestId = null;
      this.lastGestureMatch = null;
      this.drag = null;
      this.suppressClickUntil = 0;
      this.guard?.reset();
      if (!preserveRocker) this.rocker?.cancel();
      this.wheel?.reset();
      this.overlay?.hide();
    }

    scheduleGestureTimeout() {
      this.clearGestureTimeout();
      const maxDurationMs = this.settings?.mouse?.maxDurationMs;
      if (!Number.isFinite(maxDurationMs) || typeof globalThis.setTimeout !== "function") return;
      this.gestureTimeoutId = globalThis.setTimeout(() => {
        this.gestureTimeoutId = null;
        if (this.gesture) this.cancelAll("timeout");
      }, maxDurationMs);
    }

    clearGestureTimeout() {
      if (this.gestureTimeoutId == null) return;
      globalThis.clearTimeout?.(this.gestureTimeoutId);
      this.gestureTimeoutId = null;
    }

    async dispatchBinding(binding, sourceType, context, requestId = null) {
      const invocation = invocationApi.createInvocation(
        binding.commandName,
        binding.options || {},
        { type: sourceType, bindingId: binding.id, pattern: recognizer.format(binding.pattern) },
        context,
        1,
      );
      if (requestId) invocation.requestId = requestId;
      try {
        return await chrome.runtime.sendMessage({ handler: "browserToolbox.invoke", invocation });
      } catch (_) {
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.EXTENSION_CONTEXT_LOST);
      }
    }

    suppressNativeDrag(target, contextType) {
      if (!target || !["LINK", "IMAGE"].includes(contextType)) return;
      const selector = contextType === "IMAGE" ? "img[src], picture img" : "a[href], area[href]";
      const element = target.closest?.(selector);
      if (!element) return;
      this.nativeDragTarget = element;
      this.nativeDragAttribute = element.getAttribute("draggable");
      element.setAttribute("draggable", "false");
    }

    restoreNativeDrag() {
      if (!this.nativeDragTarget) return;
      if (this.nativeDragAttribute == null) this.nativeDragTarget.removeAttribute("draggable");
      else this.nativeDragTarget.setAttribute("draggable", this.nativeDragAttribute);
      this.nativeDragTarget = null;
      this.nativeDragAttribute = null;
    }

    async applyCursor() {
      this.cursor?.clear();
      if (!repository || !this.settings?.cursor?.enabled || !this.settings.cursor.localAssetId) {
        return false;
      }
      try {
        const asset = await repository.readLocalAsset(this.settings.cursor.localAssetId);
        return this.cursor?.apply(this.settings.cursor, asset) || false;
      } catch (_) {
        return false;
      }
    }

    destroy() {
      this.cancelAll("destroy");
      for (const remove of this.listeners) remove();
      this.listeners = [];
      if (runtimeSettings) runtimeSettings.removeEventListener(this.settingsListener);
      else repository?.removeEventListener?.(this.settingsListener);
      this.settingsListener = null;
      this.overlay?.destroy();
      this.initialized = false;
    }
  }

  globalThis.BrowserToolboxPageExecutor = executePageInvocation;
  globalThis.BrowserToolboxMouseController = MouseController;

  if (chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "browserToolbox.executePageCommand" || !protocol.validate(message)) {
        return false;
      }
      executePageInvocation(message.invocation).then(sendResponse).catch((error) => {
        sendResponse(
          invocationApi.createResult(
            false,
            invocationApi.ERROR_CODES.COMMAND_FAILED,
            error.message,
          ),
        );
      });
      return true;
    });
  }

  if (
    !globalThis.vimiumDomTestsAreRunning && !globalThis.location?.search?.includes("dom_tests=true")
  ) {
    globalThis.BrowserToolboxMouseControllerInstance ||= new MouseController();
    globalThis.BrowserToolboxMouseControllerInstance.init();
  }
})();

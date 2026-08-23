// 鼠标输入总控制器。它只识别输入并生成 Invocation，不直接调用 tabs/windows API。
(function () {
  const invocationApi = globalThis.OpenKeyMouseCommandInvocation;
  const protocol = globalThis.OpenKeyMouseMessageProtocol;
  const schema = globalThis.OpenKeyMouseSettingsSchema;
  const repository = globalThis.OpenKeyMouseSettingsRepositoryInstance;
  const recognizer = globalThis.OpenKeyMouseGestureRecognizer;

  function trusted(event) {
    return globalThis.isUnitTests || event.isTrusted === true;
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
    }, globalThis.OpenKeyMouseCommandRegistry?.getCommand?.(invocation.commandName) || {});
    const count = invocation.count || 1;
    const command = globalThis.NormalModeCommands?.[invocation.commandName];
    if (typeof command === "function") {
      await command(count, { registryEntry: entry });
      return invocationApi.createResult(true);
    }
    const context = invocation.context || {};
    switch (invocation.commandName) {
      case "OpenKeyMouse.copySelection":
        return copyText(globalThis.getSelection?.()?.toString() || context.selectedText || "");
      case "OpenKeyMouse.copyLinkText":
        return copyText(context.linkText || "");
      case "OpenKeyMouse.copyLinkUrl":
      case "OpenKeyMouse.copyImageUrl":
        return copyText(context.linkUrl || context.imageUrl || "");
      case "OpenKeyMouse.downloadImage": {
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
      this.repositoryListener = null;
      this.nativeDragTarget = null;
      this.nativeDragAttribute = null;
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
      if (!repository || !this.document?.addEventListener) return;
      this.initializing = true;
      this.initialized = true;
      try {
        await repository.ensureLoaded();
        await this.refreshSettings();
        this.overlay = new globalThis.OpenKeyMouseGestureOverlay(this.document);
        this.guard = new globalThis.OpenKeyMouseContextMenuGuard();
        this.wheel = new globalThis.OpenKeyMouseWheelGestureController();
        this.rocker = new globalThis.OpenKeyMouseRockerGestureController();
        this.cursor = new globalThis.OpenKeyMouseCursorController(this.document);
        this.installListeners();
        this.repositoryListener = () => {
          this.refreshSettings().then(() => this.applyCursor()).catch(() => {});
        };
        repository.addEventListener(this.repositoryListener);
        this.applyCursor();
      } finally {
        this.initializing = false;
      }
    }

    async refreshSettings() {
      const url = globalThis.location?.href || "";
      this.settings = repository.getEffectiveSettings(url);
      this.drag?.updateSettings(this.settings.superDrag);
      try {
        const remote = await Promise.race([
          chrome.runtime.sendMessage({ handler: "openKeyMouse.effectiveSettings" }),
          new Promise((resolve) => setTimeout(() => resolve(null), 500)),
        ]);
        if (remote?.effectiveModules) {
          this.settings = remote;
          this.drag?.updateSettings(this.settings.superDrag);
        }
      } catch (_) {
        // 单元测试和浏览器受限页面可能没有可用的 Service Worker，保留本地配置。
      }
      return this.settings;
    }

    effective(moduleName) {
      return this.settings?.effectiveModules?.[moduleName] !== false &&
        this.settings?.general?.enabled !== false;
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
      if (event.button === 2 && this.effective("mouse")) {
        this.gesture = new globalThis.OpenKeyMouseGestureSession(this.settings.mouse);
        this.gesture.start({ x: event.clientX, y: event.clientY }, event.timeStamp || Date.now());
        if (this.settings.mouse.showTrail) this.overlay.show();
        this.bridge = new globalThis.OpenKeyMouseFrameGestureBridge();
        const invocation = invocationApi.createInvocation(
          "__gesture__",
          {},
          { type: "mouseGesture" },
          pageContext(),
          1,
        );
        this.gestureRequestId = invocation.requestId;
        this.bridge.start(invocation.requestId);
        return;
      }
      if (event.button === 0 && this.effective("superDrag")) {
        const selection = this.document.defaultView?.getSelection?.()?.toString() || "";
        this.drag = new globalThis.OpenKeyMouseSuperDragController(this.settings.superDrag);
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
      if (!trusted(event) || !this.effective("rocker")) return;
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
          this.guard.activate();
          event.preventDefault();
          event.stopPropagation();
        }
        if (this.gesture.isActive()) {
          event.preventDefault();
          event.stopPropagation();
          if (this.settings.mouse.showTrail) this.overlay.draw(result.points);
          const text = recognizer.format(result.pattern) || "…";
          if (this.settings.mouse.showCommandHud) this.overlay.setHud(text, true);
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
          if (result.pattern?.length) this.overlay.setHud(recognizer.format(result.pattern), true);
        }
      }
    }

    async onPointerUp(event) {
      if (!trusted(event)) return;
      if (this.gesture && event.button === 2) {
        const result = this.gesture.end();
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
            this.overlay.setHud(
              globalThis.OpenKeyMouseI18n?.message("gestureUnrecognized") ||
                "Gesture not recognized",
              true,
            );
          }
          this.bridge?.finish(result.pattern);
        } else {
          this.bridge?.cancel();
        }
        this.gesture = null;
        this.gestureRequestId = null;
        this.guard.deactivate();
        this.overlay.hide();
      }
      if (this.drag && event.button === 0) {
        const result = this.drag.pointerUp();
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
      if (!trusted(event) || !this.rocker?.pointerUp(event.button)) return;
      event.preventDefault();
      event.stopPropagation();
    }

    onContextMenu(event) {
      if (this.guard?.shouldSuppress()) {
        event.preventDefault();
        event.stopPropagation();
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
      this.gesture?.cancel(reason);
      this.drag?.cancel();
      this.restoreNativeDrag();
      this.bridge?.cancel();
      this.gesture = null;
      this.gestureRequestId = null;
      this.drag = null;
      this.suppressClickUntil = 0;
      this.guard?.deactivate();
      if (!preserveRocker) this.rocker?.cancel();
      this.wheel?.reset();
      this.overlay?.hide();
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
        return await chrome.runtime.sendMessage({ handler: "openKeyMouse.invoke", invocation });
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
      if (!this.settings?.cursor?.enabled || !this.settings.cursor.localAssetId) return false;
      try {
        const items = await chrome.storage.local.get(this.settings.cursor.localAssetId);
        const asset = items[this.settings.cursor.localAssetId];
        return this.cursor?.apply(this.settings.cursor, asset) || false;
      } catch (_) {
        return false;
      }
    }

    destroy() {
      this.cancelAll("destroy");
      for (const remove of this.listeners) remove();
      this.listeners = [];
      repository?.removeEventListener?.(this.repositoryListener);
      this.repositoryListener = null;
      this.overlay?.destroy();
      this.initialized = false;
    }
  }

  globalThis.OpenKeyMousePageExecutor = executePageInvocation;
  globalThis.OpenKeyMouseMouseController = MouseController;

  if (chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "openKeyMouse.executePageCommand" || !protocol.validate(message)) {
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
    globalThis.OpenKeyMouseMouseControllerInstance ||= new MouseController();
    globalThis.OpenKeyMouseMouseControllerInstance.init();
  }
})();

//
// A heads-up-display (HUD) for showing Vimium page operations.
// Note: you cannot interact with the HUD until document.body is available.
//
const HUD = {
  tween: null,
  hudUI: null,
  findMode: null,
  generation: 0,
  displayRevision: 0,
  displayWanted: false,
  clipboardRequests: new Map(),
  clipboardFocusOwner: null,
  pendingFindExit: null,
  destroy() {
    this.generation++;
    this.displayRevision++;
    this.displayWanted = false;
    this.clipboardFocusOwner = null;
    clearTimeout(this._showForDurationTimerId);
    for (const request of this.clipboardRequests.values()) {
      clearTimeout(request.timer);
      request.clearFocus?.();
    }
    this.clipboardRequests.clear();
    this.pendingFindExit?.cancel();
    this.tween?.stop();
    this.tween?.styleElement?.remove();
    this.hudUI?.destroy();
    this.hudUI =
      this.tween =
      this.findMode =
      this.pasteListener =
        null;
  },
  abandon() {
    this.hide(true, false);
  },

  releaseIfIdle() {
    // 隐藏组件仍会阻止 BFCache；剪贴板借用结束后才能拆除可聚焦的 iframe。
    if (!this.displayWanted && !this.clipboardRequests.size && !this.pendingFindExit) this.destroy();
  },

  deferFindRelease(key, sessionId) {
    if (!this.hudUI || !["Escape", "Enter", "Backspace"].includes(key)) return;
    this.pendingFindExit?.cancel();
    const pending = { key, sessionId };
    this.pendingFindExit = pending;
    pending.cancel = () => {
      clearTimeout(pending.timer);
      clearTimeout(pending.releaseTimer);
      pending.remove?.();
      if (this.pendingFindExit === pending) this.pendingFindExit = null;
    };
    pending.release = () => {
      if (pending.scheduled) return;
      pending.scheduled = true;
      pending.remove?.();
      // Find退出键来自HUD的渲染进程；keyup回调返回后再拆组件，避免中断原生按键回执。
      pending.releaseTimer = setTimeout(() => {
        if (this.pendingFindExit !== pending) return;
        pending.cancel();
        this.releaseIfIdle();
      }, 0);
    };
    pending.remove = globalThis.BrowserToolboxRuntimeHostInstance?.observe("keyup", (event) => {
      if (event.key === key) pending.release();
    });
    // 焦点已离开文档时可能不再收到keyup，仍须有界释放。
    pending.timer = setTimeout(pending.release, 1000);
  },

  clipboardFocusElement() {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  },

  retainClipboard(id = crypto.randomUUID()) {
    const host = globalThis.BrowserToolboxRuntimeHostInstance;
    // 记录发起复制时的焦点快照、交互代次与其他组件版本；等待期间若有新交互或新UI抢焦则撤销授焦资格。
    const request = {
      id,
      generation: this.generation,
      interactionEpoch: host?.interactionEpoch,
      focused: this.clipboardFocusElement(),
      components: new Map([...(UIComponent.instances || [])].map((ui) => [ui, ui.revision])),
      focusAllowed: true,
    };
    const removers = host?.observe
      ? ["keydown", "mousedown", "focus"].map((name) =>
        host.observe(name, () => request.focusAllowed = false)
      )
      : [];
    request.clearFocus = () => {
      for (const remove of removers.splice(0)) remove?.();
      request.components.clear();
      request.focused = null;
    };
    request.release = () => {
      if (this.clipboardRequests.get(id) !== request) return;
      clearTimeout(request.timer);
      request.clearFocus();
      if (this.clipboardFocusOwner === request) this.clipboardFocusOwner = null;
      this.clipboardRequests.delete(id);
      this.releaseIfIdle();
    };
    this.clipboardRequests.set(id, request);
    return request;
  },

  async focusClipboard({ clipboardRequestId }) {
    const ui = this.hudUI;
    if (!ui || ui.disposed) return;
    // 冷启动时外层 shadow style 默认隐藏 iframe；先等样式表替换完成，避免聚焦被浏览器忽略。
    await ui.cssReady;
    if (this.hudUI !== ui || ui.disposed) return;
    const request = this.clipboardRequests.get(clipboardRequestId);
    const host = globalThis.BrowserToolboxRuntimeHostInstance;
    const hostValid = !host || (
      host.state === "active" && !host.disposed && !host.suspended &&
      request?.interactionEpoch === host.interactionEpoch
    );
    // Find 退出后提示仍可能复用 HUD；只有活动中的查找模式需要阻止授焦。
    const allowed = Boolean(
      request && request.focusAllowed && hostValid &&
        request.generation === this.generation && !this.findMode?.modeIsActive &&
        request.focused === this.clipboardFocusElement() &&
        (!document.hasFocus || document.hasFocus()) &&
        [...(UIComponent.instances || [])].every((other) =>
          other === ui || other.disposed ||
          request.components.has(other) && request.components.get(other) === other.revision &&
            !(other.showing && other.focusOptions?.focus)
        ),
    );
    if (request) {
      request.focusAllowed = false;
      request.clearFocus();
    }
    let ok = false;
    if (allowed) {
      ui.setIframeVisible(true);
      getComputedStyle(ui.iframeElement).display;
      ui.iframeElement.focus();
      ok = ui.shadowDOM?.activeElement === ui.iframeElement;
      if (ok) this.clipboardFocusOwner = request;
    }
    await ui.postMessage({ name: "clipboardFocusResult", clipboardRequestId, ok });
  },

  // Set by @pasteFromClipboard to handle the value returned by pasteResponse
  pasteListener: null,

  // This HUD is styled to precisely mimick the chrome HUD on Mac. Use the
  // "has_popup_and_link_hud.html" test harness to tweak these styles to match Chrome's. One
  // limitation of our HUD display is that it doesn't sit on top of horizontal scrollbars like
  // Chrome's HUD does.

  handleUIComponentMessage({ data }) {
    if (!data || typeof data !== "object") return;
    const handlers = {
      hideFindMode: this.hideFindMode,
      search: this.search,
      clipboardFocus: this.focusClipboard,
      unfocusIfFocused: (message) => {
        if (
          message?.clipboardRequestId != null &&
          this.clipboardFocusOwner !== this.clipboardRequests.get(message.clipboardRequestId)
        ) return;
        return this.unfocusIfFocused();
      },
      pasteResponse: this.pasteResponse,
      showClipboardUnavailableMessage: this.showClipboardUnavailableMessage,
      clipboardComplete: (message) =>
        this.clipboardRequests.get(message.clipboardRequestId)?.release(),
      findKeyReleased: (message) => {
        const pending = this.pendingFindExit;
        if (pending?.key === message.key && pending.sessionId === message.findSessionId) {
          pending.release();
        }
      },
      copyToClipboardResult: (message) =>
        globalThis.BrowserToolboxVisualControllerInstance?.completeCopy(message),
    };
    const handler = handlers[data.name];
    if (handler) {
      return handler.bind(this)(data);
    }
  },

  async init(focusable) {
    const generation = this.generation;
    const host = globalThis.BrowserToolboxRuntimeHostInstance;
    const epoch = host?.runtimeEpoch;
    await Settings.onLoaded();
    if (
      generation !== this.generation || host &&
        (host.runtimeEpoch !== epoch || host.disposed || host.suspended ||
          ["deactivating", "disabled", "failed"].includes(host.state))
    ) return false;
    if (focusable == null) {
      focusable = true;
    }
    if (this.hudUI == null) {
      const queryString = globalThis.vimiumDomTestsAreRunning ? "?dom_tests=true" : "";
      const component = this.hudUI = new UIComponent();
      component.load(
        `pages/hud_page.html${queryString}`,
        "vimium-hud-frame",
        (event) => {
          // 已释放组件的回包不能操作后一次打开的提示或查找栏。
          if (this.hudUI === component && !component.disposed) {
            return this.handleUIComponentMessage(event);
          }
        },
      );
    }
    // this[data.name]? data
    if (this.tween == null) {
      this.tween = new Tween(
        "iframe.vimium-hud-frame.vimium-ui-component-visible",
        this.hudUI.shadowDOM,
      );
    }
    const classList = this.hudUI.iframeElement.classList;
    if (focusable) {
      classList.remove("vimium-non-clickable");
      classList.add("vimium-clickable");
      // Note(gdh1995): Chrome 74 only acknowledges text selection when a frame has been visible.
      // See more in #3277.
      // Note(mrmr1993): Show the HUD frame, so Firefox will actually perform the paste.
      this.hudUI.setIframeVisible(true);
      // Force the re-computation of styles, so Chrome sends a visibility change message to the
      // child frame. See https://github.com/philc/vimium/pull/3277#issuecomment-487363284
      getComputedStyle(this.hudUI.iframeElement).display;
    } else {
      classList.remove("vimium-non-clickable");
      classList.add("vimium-clickable");
    }
    return true;
  },

  // duration - if omitted, the message will show until dismissed.
  async show(text, duration) {
    const revision = ++this.displayRevision;
    this.displayWanted = true;
    const host = globalThis.BrowserToolboxRuntimeHostInstance;
    const epoch = host?.runtimeEpoch;
    await DomUtils.documentComplete();
    if (
      revision !== this.displayRevision || host &&
      (host.runtimeEpoch !== epoch || ["deactivating", "disabled", "failed"].includes(host.state) ||
        host.disposed || host.suspended)
    ) return;
    clearTimeout(this._showForDurationTimerId);
    // @hudUI.activate will take charge of making it visible
    if (!await this.init(false) || revision !== this.displayRevision) return;
    const component = this.hudUI;
    await component.show({ name: "show", text });
    if (revision !== this.displayRevision || this.hudUI !== component) return;
    this.tween.fade(1.0, 150);

    if (duration != null) {
      this._showForDurationTimerId = setTimeout(() => this.hide(), duration);
    }
  },

  async showFindMode(findMode = null) {
    const generation = this.generation;
    const revision = ++this.displayRevision;
    this.displayWanted = true;
    this.findMode = findMode;
    await DomUtils.documentComplete();
    if (generation !== this.generation || revision !== this.displayRevision ||
      !await this.init() || revision !== this.displayRevision || findMode &&
      (this.findMode !== findMode || !findMode.modeIsActive)) return false;
    const component = this.hudUI;
    const opened = await component.show({ name: "showFindMode", findSessionId: findMode?.sessionId });
    if (revision !== this.displayRevision || this.hudUI !== component ||
      findMode && (!findMode.modeIsActive || this.findMode !== findMode)) return false;
    this.tween.fade(1.0, 150);
    return opened;
  },

  search(data) {
    if (!this.findMode?.modeIsActive || this.findMode.sessionId && data.findSessionId !== this.findMode.sessionId) return;
    // NOTE(mrmr1993): On Firefox, window.find moves the window focus away from the HUD. We use
    // postFindFocus to put it back, so the user can continue typing.
    this.findMode.findInPlace(data.query, {
      "postFindFocus": this.hudUI.iframeElement.contentWindow,
    });

    // Show the number of matches in the HUD UI.
    const matchCount = FindMode.query.parsedQuery.length > 0 ? FindMode.query.matchCount : 0;
    const showMatchText = FindMode.query.rawQuery.length > 0;
    this.hudUI.postMessage({ name: "updateMatchesCount", matchCount, showMatchText });
  },

  // Hide the HUD.
  // If :immediate is falsy, then the HUD is faded out smoothly (otherwise it is hidden
  // immediately).
  // If :updateIndicator is truthy, then we also refresh the mode indicator. The only time we don't
  // update the mode indicator, is when hide() is called for the mode indicator itself.
  hide(immediate, updateIndicator) {
    const revision = ++this.displayRevision;
    if (immediate == null) {
      immediate = false;
    }
    if (updateIndicator == null) {
      updateIndicator = true;
    }
    clearTimeout(this._showForDurationTimerId);
    this.tween?.stop();
    if (immediate || !this.hudUI || !this.tween) {
      if (updateIndicator) {
        Mode.setIndicator();
      } else {
        this.displayWanted = false;
        if (this.clipboardRequests.size) {
          this.tween?.updateStyle(0);
        } else {
          this.unfocusIfFocused();
          this.hudUI?.hide(false);
          this.releaseIfIdle();
        }
      }
    } else {
      this.tween.fade(0, 150, () => {
        if (revision === this.displayRevision) this.hide(true, updateIndicator);
      });
    }
  },

  // These parameters describe the reason find mode is exiting, and come from the HUD UI component.
  hideFindMode({ exitEventIsEnter, exitEventIsEscape, findSessionId, exitKey }) {
    if (!this.findMode?.modeIsActive || this.findMode.sessionId && findSessionId !== this.findMode.sessionId) return;
    this.deferFindRelease(exitKey, findSessionId);
    if (this.findMode.controller) {
      const mode = this.findMode;
      const controller = mode.controller;
      mode.checkReturnToViewPort();
      globalThis.focus();
      const focusNode = DomUtils.getSelectionFocusElement();
      document.activeElement?.blur();
      focusNode?.focus?.();
      if (exitEventIsEnter) controller.handleEnter().catch(() => {});
      mode.exit();
      if (exitEventIsEnter && controller.query.hasResults) controller.postFind();
      else if (exitEventIsEscape) controller.handleEscape();
      return;
    }
    let postExit;
    this.findMode.checkReturnToViewPort();

    // An element won't receive a focus event if the search landed on it while we were in the HUD
    // iframe. To end up with the correct modes active, we create a focus/blur event manually after
    // refocusing this window.
    globalThis.focus();

    const focusNode = DomUtils.getSelectionFocusElement();
    if (document.activeElement != null) {
      document.activeElement.blur();
    }

    if (focusNode && focusNode.focus) {
      focusNode.focus();
    }

    if (exitEventIsEnter) {
      FindMode.handleEnter();
      if (FindMode.query.hasResults) {
        postExit = () => newPostFindMode();
      }
    } else if (exitEventIsEscape) {
      // We don't want FindMode to handle the click events that FindMode.handleEscape can generate,
      // so we wait until the mode is closed before running it.
      postExit = FindMode.handleEscape;
    }

    this.findMode.exit();
    if (postExit) {
      postExit();
    }
  },

  // These commands manage copying and pasting from the clipboard in the HUD frame.
  // NOTE(mrmr1993): We need this to copy and paste on Firefox:
  // * an element can't be focused in the background page, so copying/pasting doesn't work
  // * we don't want to disrupt the focus in the page, in case the page is listening for focus/blur
  // * events.
  // * the HUD shouldn't be active for this frame while any of the copy/paste commands are running.
  async copyToClipboard(text) {
    const generation = this.generation;
    const request = this.retainClipboard();
    // 兼容复制也需要完成回执；拒绝或失联时有界释放，避免留下隐藏组件。
    request.timer = setTimeout(request.release, 3000);
    try {
      await DomUtils.documentComplete();
      if (generation !== this.generation || !await this.init()) return request.release();
      const ui = this.hudUI;
      await ui.cssReady;
      if (generation !== this.generation || this.hudUI !== ui || ui.disposed) return request.release();
      await ui.postMessage({
        name: "copyToClipboard", data: text, clipboardRequestId: request.id,
      });
    } catch (_) { request.release(); }
  },

  async pasteFromClipboard(pasteListener) {
    const generation = this.generation;
    this.pasteListener = pasteListener;
    const request = this.retainClipboard();
    request.listener = pasteListener;
    request.timer = setTimeout(request.release, 3000);
    try {
      await DomUtils.documentComplete();
      if (generation !== this.generation || !await this.init()) return request.release();
      const ui = this.hudUI;
      this.tween.updateStyle(0);
      await ui.cssReady;
      if (generation !== this.generation || this.hudUI !== ui || ui.disposed) return request.release();
      await ui.postMessage({ name: "pasteFromClipboard", clipboardRequestId: request.id });
    } catch (_) { request.release(); }
  },

  pasteResponse({ data, clipboardRequestId }) {
    const request = this.clipboardRequests.get(clipboardRequestId);
    if (!request?.listener) return;
    const listener = request.listener;
    request.listener = null;
    this.unfocusIfFocused();
    if (this.pasteListener === listener) this.pasteListener = null;
    try { listener(data); }
    finally { request.release(); }
  },

  unfocusIfFocused() {
    // On Firefox, if an <iframe> disappears when it's focused, then it will keep "focused", which
    // means keyboard events will always be dispatched to the HUD iframe
    this.clipboardFocusOwner = null;
    if (
      this.hudUI && (!document.hasFocus || document.hasFocus()) &&
      this.hudUI.shadowDOM?.activeElement === this.hudUI.iframeElement
    ) {
      this.hudUI.iframeElement.blur();
      globalThis.focus();
    }
  },

  // Navigator.clipboard is only available in secure contexts. Show a warning when clipboard actions
  // fail on non-HTTPS sites. See #4572.
  async showClipboardUnavailableMessage() {
    // Since the message is long and surprising, show it for longer to allow more time to reading.
    return this.show("Clipboard actions available only on HTTPS sites", 4000);
  },
};

class Tween {
  constructor(cssSelector, insertionPoint) {
    this.opacity = 0;
    this.intervalId = -1;
    this.styleElement = null;
    this.cssSelector = cssSelector;
    if (insertionPoint == null) insertionPoint = document.documentElement;
    this.styleElement = DomUtils.createElement("style");

    if (!this.styleElement.style) {
      // We're in an XML document, so we shouldn't inject any elements. See the comment in
      // UIComponent.
      Tween.prototype.fade = Tween.prototype.stop = Tween.prototype.updateStyle = function () {};
      return;
    }

    this.styleElement.type = "text/css";
    this.styleElement.innerHTML = "";
    insertionPoint.appendChild(this.styleElement);
  }

  fade(toAlpha, duration, onComplete) {
    clearInterval(this.intervalId);
    const startTime = (new Date()).getTime();
    const fromAlpha = this.opacity;
    const alphaStep = toAlpha - fromAlpha;

    const performStep = () => {
      const elapsed = (new Date()).getTime() - startTime;
      if (elapsed >= duration) {
        clearInterval(this.intervalId);
        this.updateStyle(toAlpha);
        if (onComplete) {
          onComplete();
        }
      } else {
        const value = ((elapsed / duration) * alphaStep) + fromAlpha;
        this.updateStyle(value);
      }
    };

    this.updateStyle(this.opacity);
    this.intervalId = setInterval(performStep, 50);
  }

  stop() {
    clearInterval(this.intervalId);
  }

  updateStyle(opacity) {
    this.opacity = opacity;
    this.styleElement.innerHTML = `\
${this.cssSelector} {
  opacity: ${this.opacity};
}\
`;
  }
}

globalThis.HUD = HUD;

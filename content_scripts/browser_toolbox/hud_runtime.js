// SPDX-License-Identifier: GPL-3.0-or-later
// 提示显示、查找退出与剪贴板各自持有租约；最后一个租约结束后同步移除 iframe。
(function () {
  class Fade {
    constructor(shadow) {
      this.styleElement = shadow.ownerDocument.createElement("style");
      shadow.append(this.styleElement);
      this.opacity = 0;
      this.updateStyle(0);
    }
    updateStyle(opacity, duration = 0) {
      this.opacity = opacity;
      this.styleElement.textContent =
        `iframe.vimium-hud-frame.vimium-ui-component-visible {opacity:${opacity};transition:opacity ${duration}ms linear;}`;
    }
    fade(opacity, duration, complete) {
      this.stop();
      this.updateStyle(opacity, duration);
      if (complete) {
        this.timer = setTimeout(() => {
          this.timer = null;
          complete();
        }, duration);
      }
    }
    stop() {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
  class Hud {
    constructor(controller, generation = 0) {
      this.controller = controller;
      this.generation = generation;
      this.displayRevision = generation;
      this.displayWanted = false;
      this.clipboardRequests = new Map();
      this.clipboardFocusOwner = null;
      this.pendingFindExit =
        this.hudUI =
        this.tween =
        this.findMode =
        this.pasteListener =
          null;
    }
    destroy() {
      this.generation++;
      this.displayRevision++;
      this.displayWanted = false;
      clearTimeout(this._showForDurationTimerId);
      for (const request of this.clipboardRequests.values()) {
        clearTimeout(request.timer);
        request.clearFocus();
      }
      this.clipboardFocusOwner = null;
      this.clipboardRequests.clear();
      this.pendingFindExit?.cancel();
      this.tween?.stop();
      this.tween?.styleElement.remove();
      this.hudUI?.destroy();
      this.hudUI =
        this.tween =
        this.findMode =
        this.pasteListener =
          null;
    }
    abandon() {
      this.hide(true, false);
    }
    releaseIfIdle() {
      if (!this.displayWanted && !this.clipboardRequests.size && !this.pendingFindExit) {
        this.destroy();
      }
    }
    deferFindRelease(key, sessionId) {
      if (!this.hudUI || !["Escape", "Enter", "Backspace"].includes(key)) return;
      this.pendingFindExit?.cancel();
      const pending = this.pendingFindExit = { key, sessionId };
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
        // 渲染进程按键回执结束后才销毁，保留 Enter/Esc 的完整原生按键序列。
        pending.releaseTimer = setTimeout(() => {
          if (this.pendingFindExit !== pending) return;
          pending.cancel();
          this.releaseIfIdle();
        }, 0);
      };
      pending.remove = this.controller.host.observe("keyup", (event) => {
        if (event.key === key) pending.release();
      });
      pending.timer = setTimeout(pending.release, 1000);
    }
    clipboardFocusElement() {
      let element = this.controller.page.document.activeElement;
      while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
      return element;
    }
    retainClipboard(id = crypto.randomUUID()) {
      const request = {
        id,
        generation: this.generation,
        interactionEpoch: this.controller.host.interactionEpoch,
        focused: this.clipboardFocusElement(),
        components: new Map([...this.controller.components].map((ui) => [ui, ui.revision])),
        focusAllowed: true,
      };
      const removers = ["keydown", "mousedown", "focus"].map((name) =>
        this.controller.host.observe(name, () => request.focusAllowed = false)
      );
      request.clearFocus = () => {
        for (const remove of removers.splice(0)) remove();
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
    }
    async focusClipboard({ clipboardRequestId }) {
      const request = this.clipboardRequests.get(clipboardRequestId), ui = this.hudUI;
      if (!ui || ui.disposed) return;
      // 等待期间的新交互、其他组件在途显示和焦点变化都撤销旧任务的授焦资格。
      const allowed = request && request.focusAllowed && this.controller.valid() &&
        request.generation === this.generation &&
        request.interactionEpoch === this.controller.host.interactionEpoch &&
        request.focused === this.clipboardFocusElement() &&
        this.controller.page.document.hasFocus() &&
        [...this.controller.components].every((other) =>
          other === ui || other.disposed ||
          request.components.has(other) && request.components.get(other) === other.revision &&
            !(other.showing && other.focusOptions.focus)
        );
      if (request) {
        request.focusAllowed = false;
        request.clearFocus();
      }
      let ok = false;
      if (allowed) {
        ui.iframeElement.focus();
        ok = ui.shadowDOM.activeElement === ui.iframeElement;
        if (ok) this.clipboardFocusOwner = request;
      }
      await ui.postMessage({ name: "clipboardFocusResult", clipboardRequestId, ok });
    }
    handleUIComponentMessage({ data }) {
      if (!this.controller.valid() || !data || typeof data !== "object") return;
      switch (data.name) {
        case "hideFindMode":
          return this.hideFindMode(data);
        case "search":
          return this.search(data);
        case "clipboardFocus":
          return this.focusClipboard(data);
        case "unfocusIfFocused":
          if (
            data.clipboardRequestId != null &&
            this.clipboardFocusOwner !== this.clipboardRequests.get(data.clipboardRequestId)
          ) return;
          return this.unfocusIfFocused();
        case "pasteResponse":
          return this.pasteResponse(data);
        case "showClipboardUnavailableMessage":
          return this.showClipboardUnavailableMessage();
        case "clipboardComplete":
          return this.clipboardRequests.get(data.clipboardRequestId)?.release();
        case "copyToClipboardResult":
          return globalThis.BrowserToolboxVisualControllerInstance?.completeCopy(data);
        case "findKeyReleased": {
          const pending = this.pendingFindExit;
          if (pending?.key === data.key && pending.sessionId === data.findSessionId) {
            pending.release();
          }
          break;
        }
      }
    }
    async init(focusable = true) {
      const generation = this.generation;
      await DomUtils.documentReady();
      if (generation !== this.generation || !this.controller.valid()) return false;
      if (!this.hudUI || this.hudUI.disposed) {
        const ui = this.hudUI = this.controller.createComponent();
        ui.load("pages/hud_page.html", "vimium-hud-frame", (event) => {
          if (this.hudUI === ui && !ui.disposed) this.handleUIComponentMessage(event);
        });
        this.tween = new Fade(ui.shadowDOM);
      }
      const classes = this.hudUI.iframeElement.classList;
      classes.toggle("vimium-clickable", focusable);
      classes.toggle("vimium-non-clickable", !focusable);
      if (focusable) {
        this.hudUI.setIframeVisible(true);
        this.controller.page.getComputedStyle(this.hudUI.iframeElement).display;
      }
      return true;
    }
    async show(text, duration) {
      const revision = ++this.displayRevision;
      this.displayWanted = true;
      await DomUtils.documentComplete();
      if (revision !== this.displayRevision || !this.controller.valid()) return;
      clearTimeout(this._showForDurationTimerId);
      if (!await this.init(false) || revision !== this.displayRevision) return;
      const ui = this.hudUI;
      if (
        !await ui.show({ name: "show", text }) || revision !== this.displayRevision ||
        this.hudUI !== ui
      ) return;
      this.tween.fade(1, 150);
      if (duration != null) this._showForDurationTimerId = setTimeout(() => this.hide(), duration);
    }
    async showFindMode(mode) {
      const generation = this.generation;
      const revision = ++this.displayRevision;
      this.displayWanted = true;
      this.findMode = mode;
      await DomUtils.documentComplete();
      if (
        generation !== this.generation || revision !== this.displayRevision ||
        !mode?.modeIsActive || !await this.init() || revision !== this.displayRevision
      ) return false;
      const ui = this.hudUI;
      const opened = await ui.show({ name: "showFindMode", findSessionId: mode.sessionId }, {
        focus: true,
        sourceFrameId: this.controller.context.frameId,
      });
      if (
        revision !== this.displayRevision || this.hudUI !== ui || !mode.modeIsActive ||
        this.findMode !== mode
      ) return false;
      this.tween.fade(1, 150);
      return opened;
    }
    search(data) {
      const mode = this.findMode;
      if (
        !mode?.modeIsActive || data.findSessionId !== mode.sessionId ||
        typeof data.query !== "string"
      ) return;
      mode.findInPlace(data.query, { postFindFocus: this.hudUI.iframeElement.contentWindow });
      const query = mode.controller.query;
      this.hudUI.postMessage({
        name: "updateMatchesCount",
        matchCount: query.parsedQuery.length ? query.matchCount : 0,
        showMatchText: query.rawQuery.length > 0,
      });
    }
    hide(immediate = false, updateIndicator = true) {
      const revision = ++this.displayRevision;
      clearTimeout(this._showForDurationTimerId);
      this.tween?.stop();
      if (!immediate && this.hudUI && this.tween) {
        this.tween.fade(0, 150, () => {
          if (revision === this.displayRevision) this.hide(true, updateIndicator);
        });
        return;
      }
      if (updateIndicator) {
        Mode.setIndicator();
        return;
      }
      this.displayWanted = false;
      if (this.clipboardRequests.size) this.tween?.updateStyle(0);
      else {
        this.unfocusIfFocused();
        this.hudUI?.hide(false);
        this.releaseIfIdle();
      }
    }
    hideFindMode({ exitEventIsEnter, exitEventIsEscape, findSessionId, exitKey }) {
      const mode = this.findMode;
      if (!mode?.modeIsActive || mode.sessionId !== findSessionId || !mode.controller) return;
      this.deferFindRelease(exitKey, findSessionId);
      mode.checkReturnToViewPort();
      this.controller.page.focus();
      const node = DomUtils.getSelectionFocusElement();
      this.controller.page.document.activeElement?.blur();
      node?.focus?.();
      if (exitEventIsEnter) mode.controller.handleEnter().catch(() => {});
      mode.exit();
      if (exitEventIsEnter && mode.controller.query.hasResults) mode.controller.postFind();
      else if (exitEventIsEscape) mode.controller.handleEscape();
    }
    async copyToClipboard(text) {
      return this.clipboard("copyToClipboard", text);
    }
    async pasteFromClipboard(listener) {
      this.pasteListener = listener;
      return this.clipboard("pasteFromClipboard", undefined, listener);
    }
    async clipboard(name, data, listener) {
      const generation = this.generation;
      const request = this.retainClipboard();
      request.listener = listener;
      request.timer = setTimeout(request.release, 3000);
      try {
        await DomUtils.documentComplete();
        if (generation !== this.generation || !await this.init()) return request.release();
        if (listener) this.tween.updateStyle(0);
        await this.hudUI.postMessage({
          name,
          ...(data === undefined ? {} : { data }),
          clipboardRequestId: request.id,
        });
      } catch (_) {
        request.release();
      }
    }
    pasteResponse({ data, clipboardRequestId }) {
      const request = this.clipboardRequests.get(clipboardRequestId);
      if (!request?.listener) return;
      const listener = request.listener;
      request.listener = null;
      this.unfocusIfFocused();
      if (this.pasteListener === listener) this.pasteListener = null;
      try {
        listener(data);
      } finally {
        request.release();
      }
    }
    unfocusIfFocused() {
      const ui = this.hudUI;
      if (
        ui && this.controller.page.document.hasFocus() &&
        ui.shadowDOM?.activeElement === ui.iframeElement
      ) {
        ui.iframeElement.blur();
        if (this.controller.valid()) this.controller.page.focus();
      }
    }
    showClipboardUnavailableMessage() {
      return this.show("Clipboard actions available only on HTTPS sites", 4000);
    }
  }
  globalThis.BrowserToolboxHudRuntime = Object.freeze({ Hud, Fade });
})();

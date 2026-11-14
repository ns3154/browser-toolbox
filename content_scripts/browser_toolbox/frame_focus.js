// SPDX-License-Identifier: GPL-3.0-or-later
// 焦点异步交付前复核同一文档代次；高亮只占用一个有界计时器。
(function () {
  class FrameFocus {
    constructor(controller) {
      this.controller = controller;
      this.page = controller.page;
      this.focused = this.page.document.hasFocus();
      this.removers = [
        controller.host.observe("focus", (event) => {
          if (event.isTrusted && event.target === this.page) this.focused = true;
        }),
        controller.host.observe("blur", (event) => {
          if (event.isTrusted && event.target === this.page) this.focused = false;
        }),
      ];
    }
    status() {
      return {
        focused: this.controller.valid() && this.focused,
        focusable: this.controller.valid() && !DomUtils.windowIsTooSmall() &&
          this.page.document.body?.tagName?.toLowerCase() !== "frameset",
      };
    }
    async focus(request = {}) {
      const revision = this.controller.host.interactionEpoch;
      if (!this.controller.valid() || !request.forceFocusThisFrame && !this.status().focusable) {
        return false;
      }
      await Promise.resolve();
      if (!this.controller.valid() || revision !== this.controller.host.interactionEpoch) {
        return false;
      }
      this.page.focus();
      const active = this.page.document.activeElement;
      if (active?.tagName?.toLowerCase() === "iframe") active.blur();
      if (request.highlight) this.highlight();
      return true;
    }
    highlight() {
      if (!this.controller.valid()) return;
      this.clearHighlight();
      const document = this.page.document;
      const wrapper = this.highlightElement = document.createElement("div");
      const shadow = wrapper.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = `@import url("${chrome.runtime.getURL("content_scripts/vimium.css")}");`;
      const frame = document.createElement("div");
      frame.className = "vimium-reset vimium-highlighted-frame";
      shadow.append(style, frame);
      document.documentElement.append(wrapper);
      this.timer = setTimeout(() => this.clearHighlight(), 200);
    }
    clearHighlight() {
      clearTimeout(this.timer);
      this.timer = null;
      this.highlightElement?.remove();
      this.highlightElement = null;
    }
    destroy() {
      for (const remove of this.removers.splice(0)) remove();
      this.clearHighlight();
    }
  }
  globalThis.BrowserToolboxFrameFocus = FrameFocus;
})();

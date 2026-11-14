// SPDX-License-Identifier: GPL-3.0-or-later
// 页面入口由独立控制器拥有；现有组件只负责认证、显示及源frame焦点归还。
(function () {
  class Controller {
    constructor(
      resources,
      context,
      enabled,
      send = (message) => chrome.runtime.sendMessage(message),
    ) {
      Object.assign(this, { resources, context, enabled, send });
      this.epoch = BrowserToolboxRuntimeHostInstance.runtimeEpoch;
      resources.add(() => this.destroy());
    }
    commands() {
      const open = (defaults, entry = {}) => ({ ...entry.options, ...defaults });
      return {
        "Vomnibar.activate": (frame, entry) => this.open(frame, open({ completer: "omni" }, entry)),
        "Vomnibar.activateInNewTab": (frame, entry) =>
          this.open(frame, open({ completer: "omni", newTab: true }, entry)),
        "Vomnibar.activateTabSelection": (frame) =>
          this.open(frame, { completer: "tabs", selectFirst: true }),
        "Vomnibar.activateBookmarks": (frame, entry) =>
          this.open(frame, open({ completer: "bookmarks", selectFirst: true }, entry)),
        "Vomnibar.activateBookmarksInNewTab": (frame, entry) =>
          this.open(
            frame,
            open({ completer: "bookmarks", selectFirst: true, newTab: true }, entry),
          ),
        "Vomnibar.activateEditUrl": (frame) =>
          this.open(frame, { completer: "omni", selectFirst: false, query: location.href }),
        "Vomnibar.activateEditUrlInNewTab": (frame) =>
          this.open(frame, {
            completer: "omni",
            selectFirst: false,
            query: location.href,
            newTab: true,
          }),
      };
    }
    valid() {
      const host = globalThis.BrowserToolboxRuntimeHostInstance;
      return !this.closed && this.enabled() && host?.state === "active" && !host.suspended &&
        !host.maintenancePaused &&
        host.context.documentId === this.context.documentId && host.runtimeEpoch === this.epoch &&
        host.plan.moduleImplementations.vomnibar === "browser-toolbox";
    }
    async open(sourceFrameId, options, canShow) {
      if (!this.valid() || canShow && !canShow()) return false;
      Utils.assertType(VomnibarShowOptions, options);
      HelpDialog.abort();
      if (!this.ui) {
        const component = this.ui = new UIComponent();
        component.load(
          "pages/vomnibar_page.html",
          "vomnibar-frame",
          (event) => this.finish(component, event.data),
        );
        // 诊断门面公开当前组件，但独立命令不调用旧Vomnibar初始化或选中算法。
        Vomnibar.vomnibarUI = this.ui;
      }
      const component = this.ui;
      const interactionId = this.interactionId = crypto.randomUUID();
      const shown = await component.show({ ...options, interactionId, name: "activate" }, {
        sourceFrameId,
        focus: true,
      }, canShow);
      // 准备期间Esc已经撤销交互，尚未显示的扩展iframe也必须释放，不能留到导航时阻止BFCache。
      if (!shown && interactionId === this.interactionId) this.releaseUi(component);
      return shown;
    }
    finish(component, message) {
      if (
        this.ui !== component || message?.name !== "vomnibarInteractionFinished" ||
        message.interactionId !== this.interactionId ||
        message.interactionId !== component.interactionId || component.showing
      ) return;
      const submission = message.submission;
      const allowed = this.valid() &&
        BrowserToolboxMessageProtocol.validateVomnibarSubmission(submission);
      const identity = {
        documentId: this.context.documentId,
        runtimeEpoch: this.epoch,
        incognito: this.context.incognito === true,
      };
      // 销毁是同步的；随后仅用父文档身份提交一次，后台仍在每个副作用前核验Native文档。
      this.releaseUi(component);
      if (!allowed) return;
      Promise.resolve().then(() => {
        if (!this.valid() || this.interactionId !== message.interactionId) return;
        return this.send(
          BrowserToolboxMessageProtocol.envelope("ui", "submitVomnibar", { submission }, identity),
        );
      }).then((result) => {
        if (result?.ok === false) this.lastErrorCode = result.code;
      }).catch(() => {
        this.lastErrorCode = "RESULT_UNKNOWN";
      });
    }
    releaseUi(component = this.ui) {
      if (!component || this.ui !== component) return;
      if (Vomnibar.vomnibarUI === component) Vomnibar.vomnibarUI = null;
      this.ui = null;
      component.destroy();
    }
    cancelInteractions() {
      this.ui?.hide(false);
    }
    destroy() {
      if (this.closed) return;
      this.closed = true;
      this.releaseUi();
    }
  }
  globalThis.BrowserToolboxVomnibarRuntime = Object.freeze({ Controller });
})();

// SPDX-License-Identifier: GPL-3.0-or-later
// 帮助会话属于宿主代次；再次切换或取消后，迟到的摘要不能重新打开组件。
(function () {
  class Controller {
    constructor(ui, summary) {
      this.ui = ui;
      this.summary = summary;
      this.revision = 0;
      this.wanted = false;
    }
    get showing() {
      return this.wanted || Boolean(this.component?.showing);
    }
    async toggle(request = {}) {
      if (this.showing) return this.abort(true);
      if (this.closed || !this.ui.valid()) return false;
      this.wanted = true;
      const revision = ++this.revision;
      if (!this.component || this.component.disposed) {
        this.component = this.ui.createComponent();
        this.component.load("pages/help_dialog_page.html", "vimium-help-dialog-frame");
      }
      const browserToolbox = await Promise.resolve().then(() => this.summary())
        .catch(() => ({ stateAvailable: false }));
      if (this.closed || revision !== this.revision || !this.wanted || !this.ui.valid()) {
        return false;
      }
      const shown = await this.component.show(
        { name: "show", browserToolbox, interactionId: crypto.randomUUID() },
        { focus: true, sourceFrameId: request.sourceFrameId ?? this.ui.context.frameId },
      );
      if (revision === this.revision) this.wanted = false;
      return shown;
    }
    abort(refocus = false) {
      this.revision++;
      this.wanted = false;
      return this.component?.hide(refocus) ?? false;
    }
    destroy() {
      this.closed = true;
      this.abort(false);
      this.component?.destroy();
      this.component = null;
    }
  }
  globalThis.BrowserToolboxHelpRuntime = Object.freeze({ Controller });
})();

// SPDX-License-Identifier: GPL-3.0-or-later
// 私有端口在 Native 授权完成后才创建会话；关闭文档后不再交付消息或就绪通知。
export class UiSession {
  constructor({ port, page = globalThis, handler, onClose = () => {} }) {
    Object.assign(this, { port, page, handler, onClose });
    this.closed = this.ready = false;
    this.onDom = () => this.notifyReady();
    this.onPageHide = () => this.destroy();
    page.addEventListener("pagehide", this.onPageHide, { once: true });
    port.onmessage = (event) => {
      if (this.closed) return;
      try {
        Promise.resolve(this.handler(event)).catch(() => this.lastErrorCode = "UI_MESSAGE_FAILED");
      } catch (_) {
        this.lastErrorCode = "UI_MESSAGE_FAILED";
      }
    };
    if (page.document.readyState === "loading") {
      page.document.addEventListener("DOMContentLoaded", this.onDom, { once: true });
    } else this.notifyReady();
  }
  notifyReady() {
    if (this.closed || this.ready) return;
    this.ready = true;
    if (this.page.frameId != null) {
      this.post({ name: "setIframeFrameId", iframeFrameId: this.page.frameId });
    }
    this.post({ name: "uiComponentIsReady" });
  }
  post(data) {
    if (!this.closed) this.port.postMessage(data);
  }
  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.page.document.removeEventListener("DOMContentLoaded", this.onDom);
    this.page.removeEventListener("pagehide", this.onPageHide);
    this.port.onmessage = null;
    this.port.close();
    this.onClose();
  }
}

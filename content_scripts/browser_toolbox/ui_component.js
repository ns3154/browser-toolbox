// SPDX-License-Identifier: GPL-3.0-or-later
// 每次组件握手和显示均属于创建它的文档代次，隐藏首先取消在途显示，再归还焦点。
(function () {
  const pages = Object.freeze({
    "pages/hud_page.html": "hud",
    "pages/vomnibar_page.html": "vomnibar",
    "pages/help_dialog_page.html": "help",
  });
  class Component {
    constructor(controller) {
      this.controller = controller;
      this.resources = new BrowserToolboxRuntime.ResourceScope();
      this.disposed = this.showing = this.loaded = false;
      this.focusOptions = {};
      this.revision = 0;
      this.iframePort = new Promise((resolve) => this.resolvePort = resolve);
      this.cssReady = Promise.resolve();
      this.ownerIdentity = controller.identity();
      controller.components.add(this);
      controller.registry.add(this);
    }
    live() {
      return !this.disposed && this.controller.valid(true);
    }
    releaseAuthorization() {
      const authorization = this.authorization;
      this.authorization = null;
      if (!authorization) return;
      this.controller.send(BrowserToolboxMessageProtocol.envelope("ui", "release", {
        componentId: authorization.componentId,
      }, this.ownerIdentity)).catch(() => {});
    }
    async load(url, className, messageHandler) {
      if (this.loaded) throw new Error("UI_COMPONENT_ALREADY_LOADED");
      this.loaded = true;
      const component = pages[url];
      try {
        if (!component || !this.live()) throw new Error("UI_COMPONENT_UNAVAILABLE");
        this.messageHandler = messageHandler;
        const page = this.controller.page;
        const document = page.document;
        this.iframeElement = document.createElement("iframe");
        this.iframeElement.className = className;
        this.iframeElement.allow = "clipboard-read; clipboard-write";
        const wrapper = document.createElement("div");
        wrapper.className = "vimium-reset";
        this.shadowDOM = wrapper.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = "iframe {display:none;}";
        this.shadowDOM.append(style, this.iframeElement);
        this.setIframeVisible(false);
        this.cssReady = this.controller.css().then((css) => {
          if (this.live() && css) style.textContent = css;
        });
        await DomUtils.documentReady();
        if (!this.live()) return this.destroy();
        const response = await this.controller.send(BrowserToolboxMessageProtocol.envelope(
          "ui",
          "authorize",
          { component, componentId: crypto.randomUUID() },
          this.ownerIdentity,
        ));
        if (!response?.ok || !response.grant) {
          throw new Error(response?.code || "UI_AUTHORIZATION_FAILED");
        }
        this.authorization = {
          componentId: response.grant.componentId,
          grantId: response.grant.grantId,
        };
        if (!this.live()) {
          this.releaseAuthorization();
          return this.destroy();
        }
        const { port1, port2 } = this.controller.channel();
        this.messageChannelPorts = [port1, port2];
        port1.onmessage = (event) => this.receive(event, port1);
        let sent = false;
        this.resources.listen(this.iframeElement, "load", () => {
          if (sent || !this.live()) return;
          sent = true;
          this.iframeElement.contentWindow.postMessage(response.grant, chrome.runtime.getURL(""), [
            port2,
          ]);
        }, false);
        this.handshakeTimer = this.resources.timeout(() => {
          this.controller.lastErrorCode = "UI_HANDSHAKE_TIMEOUT";
          this.destroy();
        }, 10000);
        this.watchTheme();
        this.iframeElement.src = chrome.runtime.getURL(url);
        document.documentElement.append(wrapper);
        return true;
      } catch (error) {
        this.controller.lastErrorCode = error?.code || error?.message || "UI_COMPONENT_FAILED";
        this.destroy();
        return false;
      }
    }
    receive(event, port) {
      if (!this.live()) return;
      const data = event.data;
      const name = typeof data === "string" ? data : data?.name;
      if (name === "uiAuthorizationProof") {
        const proof = data.proof;
        if (
          !this.authorization || proof?.grantId !== this.authorization.grantId ||
          proof.componentId !== this.authorization.componentId || this.attesting
        ) return;
        this.attesting = true;
        this.controller.send(BrowserToolboxMessageProtocol.envelope(
          "ui",
          "attest",
          proof,
          this.ownerIdentity,
        )).then((result) => {
          if (!this.live()) return;
          this.attested = result?.ok === true;
          port.postMessage({
            name: "uiAuthorizationComplete",
            proofId: proof.proofId,
            ok: this.attested,
          });
          if (!this.attested) this.destroy();
        }).catch(() => this.destroy());
        return;
      }
      if (!this.attested) return;
      if (name === "uiComponentIsReady") {
        if (this.ready) return;
        this.ready = true;
        clearTimeout(this.handshakeTimer);
        this.removeFocusListener = this.controller.host.observe("focus", (event) => {
          if (
            event.isTrusted && event.target === this.controller.page && this.focusOptions.focus &&
            !this.focusingIframe && this.shadowDOM.activeElement !== this.iframeElement
          ) {
            this.hide(false);
          }
          return true;
        });
        this.resources.add(() => this.removeFocusListener?.());
        this.resolvePort(port);
      } else if (name === "setIframeFrameId") this.iframeFrameId = data.iframeFrameId;
      else if (name === "hide") this.hide(undefined, data?.interactionId);
      else if (this.ready) {
        try {
          Promise.resolve(this.messageHandler?.(event)).catch(() => {
            this.controller.lastErrorCode = "UI_MESSAGE_FAILED";
          });
        } catch (_) {
          this.controller.lastErrorCode = "UI_MESSAGE_FAILED";
        }
      }
    }
    watchTheme() {
      const document = this.controller.page.document;
      const update = () => {
        const dark = document.getElementById("dark-reader-style")?.textContent?.includes("filter");
        this.iframeElement.classList.toggle("vimium-reverse-dark-reader-filter", Boolean(dark));
      };
      update();
      this.observer = new MutationObserver(update);
      if (document.head) {
        this.observer.observe(document.head, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
      this.resources.add(() => this.observer.disconnect(), "observer");
    }
    setIframeVisible(visible) {
      this.iframeElement?.classList.toggle("vimium-ui-component-visible", visible);
      this.iframeElement?.classList.toggle("vimium-ui-component-hidden", !visible);
    }
    async show(data = {}, options = {}, canShow) {
      Utils.assertType({ focus: "boolean", sourceFrameId: "number" }, options);
      const revision = ++this.revision;
      const interactionEpoch = this.controller.host.interactionEpoch;
      // 焦点归还对象在显示前捕获，不能在关闭时用可复用的 frameId 重新选择文档。
      const source = options.focus && options.sourceFrameId != null
        ? this.controller.send(BrowserToolboxMessageProtocol.envelope("ui", "captureFocus", {
          frameId: options.sourceFrameId,
        }, this.ownerIdentity)).catch(() => null)
        : null;
      const [, port, captured] = await Promise.all([this.cssReady, this.iframePort, source]);
      if (
        !this.live() || !port || revision !== this.revision ||
        !this.controller.valid() || interactionEpoch !== this.controller.host.interactionEpoch ||
        source && !captured?.ok || canShow && !canShow()
      ) return false;
      this.focusOptions = { ...options, sourceIdentity: captured?.target };
      this.interactionId = data.interactionId || null;
      port.postMessage(data);
      this.setIframeVisible(true);
      this.showing = true;
      if (options.focus) {
        this.focusingIframe = true;
        try {
          this.iframeElement.focus();
        } finally {
          this.focusingIframe = false;
        }
      }
      return true;
    }
    async hide(refocus = true, interactionId) {
      if (interactionId && interactionId !== this.interactionId) return false;
      this.revision++;
      if (this.disposed || !this.showing) return false;
      const options = this.focusOptions;
      this.showing = false;
      this.focusOptions = {};
      this.setIframeVisible(false);
      if (options.focus) {
        this.iframeElement.blur();
        if (refocus && this.controller.valid()) {
          if (options.sourceFrameId != null) {
            this.controller.send(BrowserToolboxMessageProtocol.envelope("ui", "restoreFocus", {
              target: options.sourceIdentity,
            }, this.ownerIdentity)).catch(() => {});
          } else this.controller.focus.focus({ forceFocusThisFrame: true });
        }
      }
      await this.postMessage({
        name: "hidden",
        ...(this.interactionId ? { interactionId: this.interactionId } : {}),
      });
      return true;
    }
    async postMessage(data) {
      const port = await this.iframePort;
      if (this.live() && port) port.postMessage(data);
    }
    destroy() {
      if (this.disposed) return;
      this.disposed = true;
      this.showing = false;
      this.revision++;
      this.releaseAuthorization();
      this.resources.dispose();
      for (const port of this.messageChannelPorts || []) {
        port.onmessage = null;
        port.close();
      }
      this.resolvePort(null);
      this.shadowDOM?.host.remove();
      this.iframeElement?.remove();
      this.messageHandler = null;
      this.controller.components.delete(this);
      this.controller.registry.delete(this);
    }
  }
  globalThis.BrowserToolboxUIComponent = Component;
})();

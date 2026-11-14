// A UIComponent is an iframe containing a Vimium extension page, like the Vomnibar. This class
// provides methods that content scripts can use to interact with that page:
// - show
// - hide
// - postMessage
//
// When the iframe has not yet been loaded, all messages will be queued until it's done loading. The
// page in the iframe uses the module ui_component_messenger.js to manage message passing back to
// this class. Since the iframe's page can receive messages from untrusted javascript, secure
// message passing is achieved using ports from MessageChannel() and a vimiumSecret handshake.
class UIComponent {
  static instances = new Set();
  constructor() {
    const controller = globalThis.BrowserToolboxUIControllerInstance;
    if (controller?.valid(true)) return controller.createComponent();
    this.disposed = false;
    this.resources = globalThis.BrowserToolboxRuntime
      ? new BrowserToolboxRuntime.ResourceScope()
      : null;
    UIComponent.instances.add(this);
  }

  static destroyAll() {
    for (const component of [...this.instances]) component.destroy();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.revision++;
    this.releaseAuthorization();
    this.showing = false;
    this.resources?.dispose();
    this.removeFocusListener?.();
    this.observer?.disconnect();
    for (const port of this.messageChannelPorts || []) {
      port.onmessage = null;
      port.close();
    }
    this.resolvePort?.(null);
    this.shadowDOM?.host.remove();
    this.iframeElement?.remove();
    this.messageHandler = null;
    UIComponent.instances.delete(this);
  }

  releaseAuthorization() {
    const authorization = this.authorization;
    if (authorization) {
      this.authorization = null;
      chrome.runtime.sendMessage(BrowserToolboxMessageProtocol.envelope("ui", "release", {
        componentId: authorization.componentId,
      }, this.ownerIdentity)).catch(() => {});
    }
  }
  iframeElement;
  iframePort;
  showing = false;
  revision = 0;
  // An optional message handler for handling messages from the iFrame.
  messageHandler;
  iframeFrameId;
  // These are the focus options set when show() is invoked. We store them while the UIComponent
  // is visible so we know how to revert focus once it's dismissed.
  focusOptions = {};
  shadowDOM;
  // When we open ports to the iframe using MessageChannel, we save them so that our unit tests can
  // close the ports. See ui_component_test.js for details.
  messageChannelPorts;

  // - iframeUrl:
  // - className: the CSS class to add to the iframe.
  // - messageHandler: optional; a function to handle messages from the iframe's page.
  async load(iframeUrl, className, messageHandler) {
    if (this.iframeFrameElement) throw new Error("init should only be called once.");
    this.messageHandler = messageHandler;
    const isDomTests = iframeUrl.includes("?dom_tests=true");
    this.iframeElement = DomUtils.createElement("iframe");

    // Allow Vimium's iframes to have clipboard access in Chrome. This is needed when triggering
    // some commands, like link hints or copyCurrentUrl, from within the help dialog. Firefox does
    // not support clipboard-read and clipboard-write in the allow attribute. NOTE(philc): this
    // permission has to be set before we append the iframe to the DOM, or Chrome will log the
    // console error "Potential permissions policy violation: clipboard-read is not allowed in this
    // document."
    if (!Utils.isFirefox()) {
      this.iframeElement.allow = "clipboard-read; clipboard-write";
    }

    const styleSheet = DomUtils.createElement("style");
    styleSheet.type = "text/css";
    // Default to everything hidden while the stylesheet loads.
    styleSheet.innerHTML = "iframe {display: none;}";

    // Fetch "content_scripts/vimium.css" from chrome.storage.session; the background page caches
    // it there.
    this.cssReady = chrome.storage.session.get("vimiumCSSInChromeStorage")
      .then(async (items) => {
        let cssText = items.vimiumCSSInChromeStorage;
        if (!cssText) {
          // 首次打开可能早于后台会话缓存写入；只回退读取扩展自身 CSS，避免组件裸样式显示。
          const response = await fetch(chrome.runtime.getURL("content_scripts/vimium.css"));
          if (response.ok) cssText = await response.text();
        }
        if (cssText && !this.disposed) styleSheet.textContent = cssText;
      })
      .catch(() => {});

    this.iframeElement.className = className;

    const shadowWrapper = DomUtils.createElement("div");
    // Prevent the page's CSS from interfering with this container div.
    shadowWrapper.className = "vimium-reset";
    this.shadowDOM = shadowWrapper.attachShadow({ mode: "open" });
    this.shadowDOM.appendChild(styleSheet);
    this.shadowDOM.appendChild(this.iframeElement);

    // Load the iframe and pass it a port via window.postMessage so we can communicate privately
    // with the iframe. Use a promise here so that requests to message this iframe's port will
    // block until it's ready. See #1679.
    let resolveFn;
    this.iframePort = new Promise((resolve, _reject) => {
      this.resolvePort = resolveFn = resolve;
    });

    this.setIframeVisible(false);
    await DomUtils.documentReady();
    if (this.disposed) return;
    this.handleDarkReaderFilter();

    let authorization;
    const host = globalThis.BrowserToolboxRuntimeHostInstance;
    if (host?.context.documentId && !isDomTests && !Utils.isFirefox()) {
      const component = {
        "pages/hud_page.html": "hud",
        "pages/vomnibar_page.html": "vomnibar",
        "pages/help_dialog_page.html": "help",
      }[iframeUrl.split(/[?#]/)[0]];
      this.ownerIdentity = {
        documentId: host.context.documentId,
        runtimeEpoch: host.runtimeEpoch,
        incognito: host.context.incognito === true,
      };
      const response = await chrome.runtime.sendMessage(BrowserToolboxMessageProtocol.envelope(
        "ui",
        "authorize",
        { component, componentId: crypto.randomUUID() },
        this.ownerIdentity,
      ));
      if (!response?.ok) throw new Error(response?.code || "UI_AUTHORIZATION_FAILED");
      authorization = response.grant;
      this.authorization = {
        componentId: response.grant.componentId,
        grantId: response.grant.grantId,
      };
    } else authorization = (await chrome.storage.session.get("vimiumSecret")).vimiumSecret;
    if (this.disposed) {
      // 授权可能在销毁后才返回；不能留下无人持有的一次性组件授权。
      this.releaseAuthorization();
      return;
    }
    const { port1, port2 } = new MessageChannel();
    this.messageChannelPorts = [port1, port2];
    const onLoad = () => {
      if (this.disposed) return;
      // Get vimiumSecret so the iframe can determine that our message isn't the page
      // impersonating us.
      // Outside of tests, target origin starts with chrome-extension://{vimium's-id}
      const targetOrigin = isDomTests ? "*" : chrome.runtime.getURL("");
      this.iframeElement.contentWindow.postMessage(authorization, targetOrigin, [port2]);
      port1.onmessage = (event) => {
        let eventName = null;
        // TODO(philc): Why are we using both data and data.name as the name? Pick one.
        if (event) {
          eventName = (event.data ? event.data.name : undefined) || event.data;
        }

        switch (eventName) {
          case "uiAuthorizationProof": {
            const proof = event.data.proof;
            if (
              !this.authorization || proof.grantId !== this.authorization.grantId ||
              proof.componentId !== this.authorization.componentId
            ) return;
            chrome.runtime.sendMessage(
              BrowserToolboxMessageProtocol.envelope("ui", "attest", proof, this.ownerIdentity),
            ).then((result) => {
              if (!this.disposed) {
                port1.postMessage({
                  name: "uiAuthorizationComplete",
                  proofId: proof.proofId,
                  ok: result?.ok === true,
                });
              }
            }).catch(() => {});
            break;
          }
          case "uiComponentIsReady":
            // If this frame receives the focus, then hide the UI component.
            this.removeFocusListener?.();
            const onFocus = forTrusted((event) => {
              if ((event.target === window) && this.focusOptions.focus) {
                // 从子frame激活本组件会先聚焦所属window，不能把这次焦点转移当作用户退出。
                if (this.focusingIframe || this.shadowDOM.activeElement === this.iframeElement) return true;
                this.hide(false);
              }
              // Continue propagating the event.
              return true;
            });
            const host = globalThis.BrowserToolboxRuntimeHostInstance;
            if (host) this.removeFocusListener = host.observe("focus", onFocus);
            else {
              globalThis.addEventListener("focus", onFocus, true);
              this.removeFocusListener = () =>
                globalThis.removeEventListener("focus", onFocus, true);
            }
            // Set the iframe's port, thereby rendering the UI component ready.
            resolveFn(port1);
            break;
          case "setIframeFrameId":
            this.iframeFrameId = event.data.iframeFrameId;
            break;
          case "hide":
            return this.hide(undefined, event.data?.interactionId);
          default:
            this.messageHandler?.(event);
        }
      };
    };
    this.iframeElement.addEventListener("load", onLoad);
    this.resources?.add(() => this.iframeElement.removeEventListener("load", onLoad), "listener");
    // 握手监听和一次性授权先就绪，再开始导航，避免 iframe 已加载而尚未安装 load 监听。
    this.iframeElement.src = chrome.runtime.getURL(iframeUrl);
    document.documentElement.appendChild(shadowWrapper);
  }

  // This ensures that Vimium's UI elements (HUD, Vomnibar) honor the browser's light/dark theme
  // preference, even when the user is also using the DarkReader extension. DarkReader is the most
  // popular dark mode Chrome extension in use as of 2020.
  handleDarkReaderFilter() {
    const reverseFilterClass = "vimium-reverse-dark-reader-filter";
    const reverseFilterIfExists = () => {
      // The DarkReader extension creates this element if it's actively modifying the current page.
      const darkReaderElement = document.getElementById("dark-reader-style");
      if (darkReaderElement && darkReaderElement.innerHTML.includes("filter")) {
        this.iframeElement.classList.add(reverseFilterClass);
      } else {
        this.iframeElement.classList.remove(reverseFilterClass);
      }
    };

    reverseFilterIfExists();

    this.observer = new MutationObserver(reverseFilterIfExists);
    if (document.head) {
      this.observer.observe(document.head, { characterData: true, subtree: true, childList: true });
    }
  }

  setIframeVisible(visible) {
    const classes = this.iframeElement.classList;
    if (visible) {
      classes.remove("vimium-ui-component-hidden");
      classes.add("vimium-ui-component-visible");
    } else {
      classes.add("vimium-ui-component-hidden");
      classes.remove("vimium-ui-component-visible");
    }
  }

  // Send a message to this UIComponent's iframe's page.
  // - data: an object with at least a `name` field.
  async postMessage(data) {
    const port = await this.iframePort;
    if (!this.disposed && port) port.postMessage(data);
  }

  // Show the UIComponent.
  // - messageData: a message to send to the underlying iframe via `postMessage`.
  // - focusOptions: optional. {
  //     focus: whether the UIComponent should be focused once it's ready.
  //     sourceFrameId: which frame should the focus when this component is dismissed.
  //   }
  async show(messageData = {}, focusOptions = {}) {
    const revision = ++this.revision;
    await this.refocusing;
    const host = globalThis.BrowserToolboxRuntimeHostInstance;
    const runtimeEpoch = host?.runtimeEpoch;
    const interactionEpoch = host?.interactionEpoch;
    if (focusOptions) {
      Utils.assertType({ focus: "boolean", sourceFrameId: "number" }, focusOptions);
    }
    this.focusOptions = focusOptions;
    // 外层仍为 display:none 时聚焦会被浏览器忽略；样式就绪后再激活，避免冷启动丢失输入焦点。
    const [_, port] = await Promise.all([this.cssReady, this.iframePort]);
    if (
      this.disposed || !port || revision !== this.revision ||
      host &&
        (host.state !== "active" || host.runtimeEpoch !== runtimeEpoch ||
          host.interactionEpoch !== interactionEpoch)
    ) return false;
    this.interactionId = messageData.interactionId || null;
    port.postMessage(messageData);
    this.setIframeVisible(true);
    if (this.focusOptions.focus) {
      this.focusingIframe = true;
      try { this.iframeElement.focus(); }
      finally { this.focusingIframe = false; }
    }
    this.showing = true;
    return true;
  }

  async hide(shouldRefocusOriginalFrame, interactionId) {
    if (shouldRefocusOriginalFrame == null) shouldRefocusOriginalFrame = true;

    await this.iframePort;
    if (this.disposed) return;
    // 独立组件的迟到hide不能关闭较新的激活；旧组件仍使用原无编号握手。
    if (interactionId && interactionId !== this.interactionId) return;
    this.revision++;
    if (!this.showing) return;
    this.showing = false;
    this.setIframeVisible(false);
    let refocusing;
    if (this.focusOptions.focus) {
      this.iframeElement.blur();
      if (shouldRefocusOriginalFrame) {
        if (this.focusOptions.sourceFrameId != null) {
          refocusing = BrowserToolboxFrameRuntimeBridgeInstance.sendToFrame(
            this.focusOptions.sourceFrameId,
            {
              handler: "focusFrame",
              forceFocusThisFrame: true,
            },
          ).catch(() => {});
        } else {
          refocusing = new Promise((resolve) => {
            const removeCancellation = this.resources?.add(resolve);
            Utils.nextTick(() => {
              try {
                if (!this.disposed) globalThis.focus();
              } finally {
                removeCancellation?.();
                resolve();
              }
            });
          });
        }
      }
    }
    this.focusOptions = {};
    this.refocusing = refocusing;
    this.postMessage({ name: "hidden", ...(this.interactionId ? { interactionId: this.interactionId } : {}) });
    // 关闭的完成回执包含原有归焦任务，帮助重开不再越过仍在途的旧任务。
    await refocusing;
  }
}

globalThis.UIComponent = UIComponent;

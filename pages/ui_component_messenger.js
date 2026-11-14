//
// These are functions for a page in a UIComponent iframe to communicate to its parent frame.
//

import "../lib/browser_toolbox/value_utils.js";
import "../lib/browser_toolbox/command_invocation.js";
import "../lib/browser_toolbox/message_protocol.js";
import "../lib/browser_toolbox/ui_authorization.js";
import "../lib/browser_toolbox/runtime_plan.js";

let ownerPagePort = null;
let handleMessage = null;
let awaitingAuthorization = false;
let independentSession = null;

export function probeDocument(message, sender, sendResponse) {
  if (
    message?.name !== "BrowserToolboxProbeUiDocument" || sender?.id !== chrome.runtime.id ||
    chrome.extension?.inIncognitoContext !== true || document.prerendering ||
    !["hud", "vomnibar", "help_dialog"].some((name) =>
      location.href.split(/[?#]/)[0] === chrome.runtime.getURL(`pages/${name}_page.html`)
    )
  ) return false;
  // 回应只取本上下文的原生身份；请求里的tab/frame/document字段用于筛选，不能成为身份来源。
  chrome.runtime.getContexts({ documentIds: [message.documentId], incognito: true }).then(
    (contexts) => {
      const context = contexts.find((item) =>
        item.documentId === message.documentId &&
        item.tabId === message.tabId && item.frameId === message.frameId &&
        item.incognito === true &&
        item.documentUrl === location.href.split(/[?#]/)[0]
      );
      sendResponse({
        nonce: message.nonce,
        context: context
          ? {
            documentId: context.documentId,
            tabId: context.tabId,
            frameId: context.frameId,
            incognito: context.incognito,
            documentUrl: context.documentUrl,
          }
          : null,
      });
    },
  ).catch(() => sendResponse({ nonce: message.nonce, context: null }));
  return true;
}

export async function registerPortWithOwnerPage(event) {
  if (event.source !== globalThis.parent) return;
  if (ownerPagePort || awaitingAuthorization || event.ports.length !== 1) return;
  if (typeof event.data === "object" && event.data?.grantId) {
    if (event.origin !== event.data.ownerOrigin) {
      BrowserToolboxUIAuthorization.lastErrorCode = "INVALID_UI_ORIGIN";
      return;
    }
    awaitingAuthorization = true;
    try {
      const result = await chrome.runtime.sendMessage(
        BrowserToolboxMessageProtocol.envelope("ui", "claim", event.data),
      );
      if (!result?.ok || result.proof.ownerOrigin !== event.origin) {
        BrowserToolboxUIAuthorization.lastErrorCode = result?.code || "UI_AUTHORIZATION_FAILED";
        return;
      }
      const port = event.ports[0];
      let timer;
      const attested = await new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 10000);
        port.onmessage = (message) => {
          if (
            message.data?.name === "uiAuthorizationComplete" &&
            message.data.proofId === result.proof.proofId
          ) resolve(message.data.ok === true);
        };
        port.postMessage({ name: "uiAuthorizationProof", proof: result.proof });
      });
      clearTimeout(timer);
      if (!attested) {
        port.close();
        BrowserToolboxUIAuthorization.lastErrorCode = "INVALID_UI_OWNER";
        return;
      }
      const finalized = await chrome.runtime.sendMessage(
        BrowserToolboxMessageProtocol.envelope("ui", "finalize", result.proof),
      );
      if (!finalized?.ok || finalized.session.ownerOrigin !== event.origin) {
        port.close();
        BrowserToolboxUIAuthorization.lastErrorCode = finalized?.code || "UI_AUTHORIZATION_FAILED";
        return;
      }
      BrowserToolboxUIAuthorization.accept(finalized.session);
      await openPort(event.ports[0], finalized.session);
      globalThis.removeEventListener("message", registerPortWithOwnerPage);
    } finally {
      awaitingAuthorization = false;
    }
    return;
  }
  // DOM 测试与仍使用旧引擎协议的 Firefox 保留原秘密握手；Chrome 产品路径只接受组件授权。
  if (
    !globalThis.isUnitTests && !globalThis.vimiumDomTestsAreRunning &&
    !location.protocol.startsWith("moz-extension")
  ) return;
  // The Vimium content script that's running on the parent page has access to this vimiumSecret
  // fetched from session storage, so if it matches, then we know that event.ports came from the
  // Vimium extension.
  const secret = (await chrome.storage.session.get("vimiumSecret")).vimiumSecret;
  if (event.data !== secret) {
    Utils.debugLog("ui_component_messenger.js: vimiumSecret is incorrect.");
    return;
  }
  openPort(event.ports[0]);
  // Once we complete a handshake with the parent page hosting this page's iframe, stop listening
  // for messages on the window object.
  globalThis.removeEventListener("message", registerPortWithOwnerPage);
}

// Used by unit tests.
export async function unregister() {
  independentSession?.destroy();
  independentSession = null;
  ownerPagePort = null;
  handleMessage = null;
}

export function init() {
  globalThis.addEventListener("message", registerPortWithOwnerPage);
  chrome.runtime.onMessage?.addListener(probeDocument);
}

async function openPort(port, session = null) {
  const ownUi = BrowserToolboxRuntimePlans.allowed.some((plan) =>
    plan.planVersion === session?.planVersion && plan.moduleImplementations.ui === "browser-toolbox");
  if (ownUi) {
    const { UiSession } = await import("./browser_toolbox/ui_session.js");
    ownerPagePort = port;
    independentSession = new UiSession({ port, handler: (event) => handleMessage?.(event),
      onClose: () => chrome.runtime.onMessage?.removeListener(probeDocument) });
    return;
  }
  ownerPagePort = port;
  ownerPagePort.onmessage = async (event) => {
    if (handleMessage) {
      return await handleMessage(event);
    }
  };
  dispatchReadyEventWhenReady();
}

export function registerHandler(messageHandlerFn) {
  handleMessage = messageHandlerFn;
}

export function postMessage(data) {
  if (independentSession) return independentSession.post(data);
  if (!ownerPagePort) return;
  ownerPagePort.postMessage(data);
}

// We require both that the DOM is ready and that the port has been opened before the UIComponent
// is ready. These events can happen in either order. We count them, and notify the content script
// when we've seen both.
let hasDispatchedReadyEvent = false;
function dispatchReadyEventWhenReady() {
  if (hasDispatchedReadyEvent) return;

  if (document.readyState === "loading") {
    globalThis.addEventListener("DOMContentLoaded", () => dispatchReadyEventWhenReady());
    return;
  }
  if (!ownerPagePort) return;

  if (globalThis.frameId != null) {
    postMessage({ name: "setIframeFrameId", iframeFrameId: globalThis.frameId });
  }
  hasDispatchedReadyEvent = true;
  postMessage({ name: "uiComponentIsReady" });
}

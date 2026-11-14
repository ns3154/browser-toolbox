import * as testHelper from "./test_helper.js";
import "../../lib/utils.js";
import "../../lib/dom_utils.js";
import "../../lib/browser_toolbox/value_utils.js";
import "../../lib/browser_toolbox/command_invocation.js";
import "../../lib/browser_toolbox/message_protocol.js";
import "../../content_scripts/ui_component.js";

function stubPostMessage(iframeEl, fn) {
  if (!iframeEl || !fn) throw new Error("iframeEl and fn are required.");
  Object.defineProperty(iframeEl, "contentWindow", {
    value: { postMessage: fn },
    writable: false,
    configurable: true,
  });
}

context("UIComponent", () => {
  let c;

  setup(async () => {
    // Which page we load doesn't matter; we just need any DOM.
    await testHelper.jsdomStub("pages/help_dialog_page.html");
    stub(Utils, "isFirefox", () => false);
  });

  teardown(() => {
    // MessageChannel ports must be closed, or our test process will never terminate. See
    // https://github.com/facebook/react/issues/26608
    c?.destroy();
    c = null;
  });

  should("focus the frame when showing", async () => {
    c = new UIComponent("testing.html", "example-class");
    await c.load("example.html", "example-class");
    stubPostMessage(c.iframeElement, function () {});
    c.iframeElement.dispatchEvent(new window.Event("load"));
    assert.equal(document.body, document.activeElement);

    // The shadow root element containing the iframe should be focused.
    c.show();
    assert.equal(c.iframeElement.getRootNode().host, document.activeElement);
  });

  should("load local component CSS when the session cache is not ready", async () => {
    stub(chrome.storage.session, "get", async () => ({}));
    stub(globalThis, "fetch", async () => ({
      ok: true,
      text: async () => "iframe.example-class { width: 920px; }",
    }));

    c = new UIComponent("testing.html", "example-class");
    await c.load("example.html", "example-class");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.isTrue(
      c.shadowDOM.querySelector("style").textContent.includes("width: 920px"),
    );
  });
  should("关闭完成必须等待来源frame的归焦回执，防止旧任务越过下一次显示", async () => {
    let finish;
    let completed = false;
    stub(globalThis, "BrowserToolboxFrameRuntimeBridgeInstance", {
      sendToFrame: () => new Promise((resolve) => finish = resolve),
    });
    c = new UIComponent();
    await c.load("example.html", "example-class");
    stubPostMessage(c.iframeElement, () => {});
    c.iframeElement.dispatchEvent(new window.Event("load"));
    c.messageChannelPorts[0].onmessage({ data: { name: "uiComponentIsReady" } });
    await c.show({}, { focus: true, sourceFrameId: 7 });
    const hiding = c.hide().then(() => completed = true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const beforeReply = completed;
    let reopened = false;
    const showing = c.show({}, { focus: true, sourceFrameId: 7 }).then(() => reopened = true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const beforeReopen = reopened;
    finish();
    await hiding;
    await showing;
    assert.isFalse(beforeReply);
    assert.isFalse(beforeReopen);
    assert.isTrue(completed);
  });
  should("组件销毁取消本地归焦时也结束关闭等待", async () => {
    c = new UIComponent();
    await c.load("example.html", "example-class");
    stubPostMessage(c.iframeElement, () => {});
    c.iframeElement.dispatchEvent(new window.Event("load"));
    c.messageChannelPorts[0].onmessage({ data: { name: "uiComponentIsReady" } });
    await c.show({}, { focus: true });
    stub(Utils, "nextTick", () => {});
    const hiding = c.hide().then(() => true);
    await Promise.resolve();
    c.destroy();
    const completed = await Promise.race([hiding, new Promise((resolve) => setTimeout(() => resolve(false), 25))]);
    assert.isTrue(completed);
  });

  should("加载期间销毁，迟到的组件授权也必须释放且不能注入iframe", async () => {
    let authorize;
    const releases = [];
    stub(globalThis, "BrowserToolboxRuntimeHostInstance", {
      context: { documentId: "synthetic-owner" }, runtimeEpoch: 1,
    });
    stub(Utils, "isFirefox", () => false);
    stub(chrome.runtime, "sendMessage", (message) => {
      if (message.action === "authorize") return new Promise((resolve) => authorize = resolve);
      releases.push(message);
      return Promise.resolve({ ok: true });
    });
    c = new UIComponent();
    const loading = c.load("pages/hud_page.html", "vimium-hud-frame");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.isTrue(typeof authorize === "function");
    c.destroy();
    authorize({ ok: true, grant: { componentId: "late-component", grantId: "late-grant" } });
    await loading;
    assert.equal(1, releases.length);
    assert.equal("release", releases[0].action);
    assert.isFalse(c.shadowDOM.host.isConnected);
  });

  should("从子框架转移到组件的window焦点不退出，真正离开组件仍退出", async () => {
    let focusObserver;
    stub(globalThis, "BrowserToolboxRuntimeHostInstance", {
      context: {},
      state: "active",
      runtimeEpoch: 1,
      interactionEpoch: 0,
      observe(type, callback) {
        assert.equal("focus", type);
        focusObserver = callback;
        return () => {
          focusObserver = null;
        };
      },
    });
    c = new UIComponent();
    await c.load("example.html", "example-class");
    stubPostMessage(c.iframeElement, () => {});
    c.iframeElement.dispatchEvent(new window.Event("load"));
    c.messageChannelPorts[0].onmessage({ data: { name: "uiComponentIsReady" } });
    const nativeFocus = c.iframeElement.focus.bind(c.iframeElement);
    stub(c.iframeElement, "focus", () => {
      focusObserver({ target: window, isTrusted: true });
      nativeFocus();
    });

    await c.show({}, { focus: true });
    await Promise.resolve();
    assert.isTrue(c.showing);
    assert.equal(c.iframeElement, c.shadowDOM.activeElement);
    focusObserver({ target: window, isTrusted: true });
    await Promise.resolve();
    assert.isTrue(c.showing);

    c.iframeElement.blur();
    document.body.tabIndex = -1;
    document.body.focus();
    focusObserver({ target: window, isTrusted: true });
    await Promise.resolve();
    assert.isFalse(c.showing);
    assert.equal("vimium-ui-component-hidden", c.iframeElement.className.split(" ").at(-1));
    c.destroy();
    assert.equal(null, focusObserver);
  });
});

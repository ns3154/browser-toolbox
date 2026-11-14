import * as testHelper from "./test_helper.js";
import "../../lib/dom_utils.js";
import "../../lib/settings.js";
import "../../content_scripts/mode.js";
import "../../content_scripts/hud.js";

context("HUD自然退出与共享剪贴板生命周期", () => {
  let components;
  setup(async () => {
    await testHelper.jsdomStub("pages/hud_page.html");
    components = [];
    stub(globalThis, "BrowserToolboxRuntimeHostInstance", null);
    stub(globalThis, "getComputedStyle", () => ({ display: "block" }));
    stub(globalThis, "focus", () => {});
    stub(Settings, "onLoaded", async () => {});
    stub(DomUtils, "documentComplete", async () => {});
    stub(Mode, "setIndicator", () => HUD.hide(true, false));
    stub(globalThis, "UIComponent", class {
      constructor() { components.push(this); }
      load(url, className, handler) {
        this.handler = handler;
        this.iframeElement = document.createElement("iframe");
        const host = document.createElement("div");
        this.shadowDOM = host.attachShadow({ mode: "open" });
        this.shadowDOM.appendChild(this.iframeElement);
        document.body.appendChild(host);
        this.messages = [];
        this.iframePort = Promise.resolve({});
      }
      setIframeVisible(visible) { this.visible = visible; }
      async show(message) {
        this.messages.push(message);
        this.showing = this.visible = true;
        return true;
      }
      hide() { this.showing = this.visible = false; }
      postMessage(message) { this.messages.push(message); }
      destroy() {
        this.disposed = true;
        this.shadowDOM.host.remove();
      }
    });
  });
  teardown(() => HUD.destroy());

  should("退出即拆除隐藏iframe与淡出样式，重开只建立新组件", async () => {
    await HUD.show("Hints");
    const old = HUD.hudUI, style = HUD.tween.styleElement;
    HUD.hide(true, false);
    assert.equal(null, HUD.hudUI);
    assert.isTrue(old.disposed);
    assert.isFalse(style.isConnected);
    await HUD.show("再次打开");
    assert.isTrue(HUD.hudUI !== old && HUD.hudUI.showing);
    assert.equal(2, components.length);
  });
  should("页面完成前退出，迟到show不能重新注入HUD", async () => {
    let complete;
    stub(DomUtils, "documentComplete", () => new Promise((resolve) => complete = resolve));
    const showing = HUD.show("已退出提示");
    HUD.hide(true, false);
    complete();
    await showing;
    assert.equal(null, HUD.hudUI);
    assert.equal(0, components.length);
  });
  should("旧淡出回调不能销毁较新的提示", async () => {
    await HUD.show("旧提示");
    let callback;
    stub(HUD.tween, "fade", (alpha, duration, onComplete) => {
      if (onComplete) callback = onComplete;
    });
    HUD.hide();
    await HUD.show("新提示");
    const current = HUD.hudUI;
    callback();
    assert.equal(current, HUD.hudUI);
    assert.isFalse(Boolean(current.disposed));
  });
  should("隐藏期间复制借用仍可聚焦，最后一次借用结束才释放", async () => {
    const first = HUD.retainClipboard("copy-one"), second = HUD.retainClipboard("copy-two");
    await HUD.init();
    const current = HUD.hudUI;
    HUD.hide(true, false);
    assert.isTrue(current.visible);
    first.release();
    assert.equal(current, HUD.hudUI);
    second.release();
    assert.equal(null, HUD.hudUI);
    first.release();
    assert.equal(null, HUD.hudUI);
  });
  should("兼容复制确认后释放，旧组件迟到回包不能影响重开", async () => {
    await HUD.copyToClipboard("合成复制");
    const old = HUD.hudUI;
    const request = old.messages.at(-1);
    HUD.hide(true, false);
    assert.isFalse(Boolean(old.disposed));
    old.handler({ data: { name: "clipboardComplete", clipboardRequestId: request.clipboardRequestId } });
    assert.equal(null, HUD.hudUI);
    await HUD.show("新提示");
    const current = HUD.hudUI;
    old.handler({ data: { name: "showClipboardUnavailableMessage" } });
    await Promise.resolve();
    assert.equal(current, HUD.hudUI);
    assert.equal("新提示", current.messages.at(-1).text);
  });
  should("粘贴回包只消费一次且保留操作期间打开的新提示", async () => {
    const values = [];
    await HUD.pasteFromClipboard((value) => values.push(value));
    const component = HUD.hudUI, request = component.messages.at(-1);
    await HUD.show("后续提示");
    const message = { name: "pasteResponse", data: "合成粘贴", clipboardRequestId: request.clipboardRequestId };
    component.handler({ data: message });
    component.handler({ data: message });
    assert.equal(["合成粘贴"], values);
    assert.equal(component, HUD.hudUI);
    assert.isTrue(component.visible);
    HUD.hide(true, false);
    assert.equal(null, HUD.hudUI);
  });
  should("等待页面完成时退出Find，旧查找栏不会重新激活", async () => {
    let complete;
    stub(DomUtils, "documentComplete", () => new Promise((resolve) => complete = resolve));
    const mode = { modeIsActive: true, sessionId: "old-find" };
    const opening = HUD.showFindMode(mode);
    HUD.hide(true, false);
    mode.modeIsActive = false;
    complete();
    assert.isFalse(await opening);
    assert.equal(null, HUD.hudUI);
  });
  should("兼容复制无回包时有界释放，超时后晚回包不执行动作", async () => {
    let timeout;
    stub(globalThis, "setTimeout", (callback, duration) => {
      assert.equal(3000, duration);
      timeout = callback;
    });
    await HUD.copyToClipboard("超时复制");
    const old = HUD.hudUI;
    timeout();
    assert.equal(null, HUD.hudUI);
    assert.isTrue(old.disposed);
    old.handler({ data: { name: "showClipboardUnavailableMessage" } });
    await Promise.resolve();
    assert.equal(null, HUD.hudUI);
  });
  should("提示自动退出不抢走页面中其他输入框的焦点", async () => {
    let focused = 0;
    stub(globalThis, "focus", () => focused++);
    await HUD.show("普通提示");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    HUD.hide(true, false);
    assert.equal(input, document.activeElement);
    assert.equal(0, focused);
  });
  should("Find退出先等同一按键keyup完成，再释放隐藏组件", async () => {
    let keyup;
    const timers = [];
    stub(globalThis, "BrowserToolboxRuntimeHostInstance", {
      state: "active", runtimeEpoch: 1,
      observe(type, callback) {
        assert.equal("keyup", type);
        keyup = callback;
        return () => keyup = null;
      },
    });
    stub(globalThis, "setTimeout", (callback, duration) => timers.push({ callback, duration }));
    await HUD.show("Find");
    const component = HUD.hudUI;
    HUD.deferFindRelease("Escape", "find-session");
    HUD.hide(true, false);
    assert.equal(component, HUD.hudUI);
    HUD.handleUIComponentMessage({ data: {
      name: "findKeyReleased", key: "Escape", findSessionId: "previous-find",
    } });
    assert.equal(1, timers.length);
    keyup({ key: "j" });
    assert.equal(1, timers.length);
    keyup({ key: "Escape" });
    assert.equal(component, HUD.hudUI);
    assert.equal(0, timers.at(-1).duration);
    timers.at(-1).callback();
    assert.equal(null, HUD.hudUI);
    assert.equal(null, keyup);
  });
  should("兼容HUD剪贴板授焦等待样式就绪并校验租约归属，新交互撤销旧许可且旧租约不误归焦", async () => {
    const observers = new Map();
    let parentFocused = 0;
    stub(globalThis, "focus", () => parentFocused++);
    stub(document, "hasFocus", () => true);
    const host = {
      state: "active",
      runtimeEpoch: 1,
      interactionEpoch: 3,
      observe(type, callback) {
        const set = observers.get(type) || new Set();
        observers.set(type, set);
        set.add(callback);
        return () => set.delete(callback);
      },
    };
    stub(globalThis, "BrowserToolboxRuntimeHostInstance", host);
    const otherInstances = new Set();
    let releaseCss;
    stub(globalThis, "UIComponent", class {
      static instances = otherInstances;
      revision = 0;
      constructor() {
        components.push(this);
        otherInstances.add(this);
      }
      load(url, className, handler) {
        this.handler = handler;
        this.iframeElement = document.createElement("iframe");
        this.iframeElement.tabIndex = 0;
        const wrapper = document.createElement("div");
        this.shadowDOM = wrapper.attachShadow({ mode: "open" });
        this.shadowDOM.appendChild(this.iframeElement);
        document.body.appendChild(wrapper);
        this.messages = [];
        this.cssReady = new Promise((resolve) => releaseCss = resolve);
        this.iframePort = Promise.resolve({});
      }
      setIframeVisible(visible) { this.visible = visible; }
      async postMessage(message) { this.messages.push(message); }
      destroy() {
        this.disposed = true;
        otherInstances.delete(this);
        this.shadowDOM.host.remove();
      }
    });

    const source = document.createElement("button");
    document.body.appendChild(source);
    source.focus();

    const first = HUD.retainClipboard("lease-1");
    await HUD.init();
    const ui = HUD.hudUI;
    const focusing = HUD.handleUIComponentMessage({
      data: { name: "clipboardFocus", clipboardRequestId: "lease-1" },
    });
    await Promise.resolve();
    assert.equal([], ui.messages);
    releaseCss();
    await focusing;
    assert.equal(
      [{ name: "clipboardFocusResult", clipboardRequestId: "lease-1", ok: true }],
      ui.messages,
    );
    assert.equal(ui.iframeElement, ui.shadowDOM.activeElement);

    // 新租约持焦后，旧租约的延迟 unfocusIfFocused 不能夺走当前 HUD 焦点。
    source.focus();
    const second = HUD.retainClipboard("lease-2");
    await HUD.handleUIComponentMessage({
      data: { name: "clipboardFocus", clipboardRequestId: "lease-2" },
    });
    assert.equal(true, ui.messages.at(-1).ok);
    HUD.handleUIComponentMessage({
      data: { name: "unfocusIfFocused", clipboardRequestId: "lease-1" },
    });
    assert.equal(0, parentFocused);
    assert.equal(ui.iframeElement, ui.shadowDOM.activeElement);
    HUD.handleUIComponentMessage({
      data: { name: "unfocusIfFocused", clipboardRequestId: "lease-2" },
    });
    assert.equal(1, parentFocused);
    first.release();
    second.release();

    // 已退出的 Find 对象可能随仍显示的 HUD 保留，但不能阻止后续复制。
    source.focus();
    HUD.findMode = { modeIsActive: false };
    const endedFind = HUD.retainClipboard("lease-ended-find");
    await HUD.init();
    releaseCss();
    await HUD.handleUIComponentMessage({
      data: { name: "clipboardFocus", clipboardRequestId: "lease-ended-find" },
    });
    assert.equal(true, HUD.hudUI.messages.at(-1).ok);
    endedFind.release();

    // 实际活动的 Find 仍须阻止复制借用抢夺查找框焦点。
    source.focus();
    HUD.findMode = { modeIsActive: true };
    const activeFind = HUD.retainClipboard("lease-active-find");
    await HUD.init();
    releaseCss();
    await HUD.handleUIComponentMessage({
      data: { name: "clipboardFocus", clipboardRequestId: "lease-active-find" },
    });
    assert.equal(false, HUD.hudUI.messages.at(-1).ok);
    activeFind.release();
    HUD.findMode = null;

    // 等待期间发生新按键或其他聚焦组件 revision 变更时，必须拒绝授焦。
    source.focus();
    const revokedByKey = HUD.retainClipboard("lease-key");
    await HUD.init();
    releaseCss();
    for (const cb of observers.get("keydown") || []) cb({ key: "o" });
    await HUD.handleUIComponentMessage({
      data: { name: "clipboardFocus", clipboardRequestId: "lease-key" },
    });
    assert.equal(false, HUD.hudUI.messages.at(-1).ok);
    revokedByKey.release();

    const otherUi = { disposed: false, revision: 1, showing: false, focusOptions: {} };
    otherInstances.add(otherUi);
    source.focus();
    const revokedByUi = HUD.retainClipboard("lease-ui");
    await HUD.init();
    releaseCss();
    otherUi.revision++;
    await HUD.handleUIComponentMessage({
      data: { name: "clipboardFocus", clipboardRequestId: "lease-ui" },
    });
    assert.equal(false, HUD.hudUI.messages.at(-1).ok);
    revokedByUi.release();
  });
});

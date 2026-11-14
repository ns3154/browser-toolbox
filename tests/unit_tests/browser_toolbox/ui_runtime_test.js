// SPDX-License-Identifier: GPL-3.0-or-later
// 验证取消、身份竞争和用户可见行为；合成输入事件不作为系统输入法证据。
import "../test_helper.js";
import "../../../lib/browser_toolbox/command_invocation.js";
import "../../../lib/browser_toolbox/message_protocol.js";
import "../../../lib/browser_toolbox/runtime_host.js";
import "../../../lib/keyboard_utils.js";
import "../../../content_scripts/browser_toolbox/ui_component.js";
import "../../../content_scripts/browser_toolbox/frame_focus.js";
import "../../../content_scripts/browser_toolbox/hud_runtime.js";
import "../../../content_scripts/browser_toolbox/ui_runtime.js";
import { FrameFocusService } from "../../../background_scripts/browser_toolbox/frame_focus_service.js";
import { UiSession } from "../../../pages/browser_toolbox/ui_session.js";
import { HudController } from "../../../pages/browser_toolbox/hud_controller.js";
import { JSDOM } from "jsdom";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => resolve = done);
  return { resolve, promise };
};
context("独立共享组件的取消和资源所有权", () => {
  let dom, page, host, scope, controller, facade, channels, requests, observers;
  setup(() => {
    dom = new JSDOM("<!doctype html><html><head></head><body><input id='source'></body></html>");
    page = {
      document: dom.window.document,
      focus() {},
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    };
    observers = new Set();
    host = {
      state: "active",
      context: { documentId: "document-a" },
      runtimeEpoch: 2,
      interactionEpoch: 1,
      plan: { moduleImplementations: { ui: "browser-toolbox" } },
      observe: (_name, callback) => {
        observers.add(callback);
        return () => observers.delete(callback);
      },
    };
    facade = {
      hudUI: null,
      generation: 4,
      destroy() {
        this.generation++;
      },
      show() {
        return "compat";
      },
    };
    channels = [];
    requests = [];
    stub(globalThis, "MutationObserver", dom.window.MutationObserver);
    stub(globalThis, "DomUtils", {
      documentReady: async () => {},
      documentComplete: async () => {},
      windowIsTooSmall: () => false,
      getSelectionFocusElement: () => null,
    });
    stub(chrome.runtime, "getURL", (url) => "chrome-extension://synthetic/" + url);
    scope = new BrowserToolboxRuntime.ResourceScope();
    controller = new BrowserToolboxUIRuntime.Controller(
      scope,
      { documentId: "document-a", frameId: 0 },
      () => true,
      {
        page,
        host,
        registry: new Set(),
        facade,
        send: async (request) => {
          requests.push(request);
          return { ok: true, grant: { componentId: "c", grantId: "g" } };
        },
        channel: () => {
          const create = () => ({
            closed: 0,
            messages: [],
            close() {
              this.closed++;
            },
            postMessage(data) {
              this.messages.push(data);
            },
          });
          const channel = { port1: create(), port2: create() };
          channels.push(channel);
          return channel;
        },
      },
    );
    controller.css = async () => "iframe {display:block;}";
  });
  teardown(() => {
    scope.dispose();
    dom.window.close();
  });
  async function ready(ui) {
    const port = channels.at(-1).port1;
    ui.receive({
      data: {
        name: "uiAuthorizationProof",
        proof: { componentId: "c", grantId: "g", proofId: "p" },
      },
    }, port);
    await tick();
    ui.receive({ data: "uiComponentIsReady" }, port);
    return port;
  }
  should("销毁早于授权返回时撤销授权，不创建端口或孤立iframe", async () => {
    const reply = deferred();
    controller.send = async (request) => {
      requests.push(request);
      return request.action === "authorize" ? reply.promise : { ok: true };
    };
    const ui = controller.createComponent();
    const loading = ui.load("pages/hud_page.html", "vimium-hud-frame");
    await tick();
    ui.destroy();
    reply.resolve({ ok: true, grant: { componentId: "late", grantId: "late-grant" } });
    await loading;
    assert.equal(0, channels.length);
    assert.equal(0, controller.components.size);
    assert.equal(0, page.document.querySelectorAll("iframe").length);
    assert.equal("release", requests.at(-1).action);
    assert.equal("late", requests.at(-1).payload.componentId);
  });
  should("授权失败让等待显示明确结束，重复销毁不重复关闭端口", async () => {
    controller.send = async () => ({ ok: false, code: "STALE_DOCUMENT" });
    const ui = controller.createComponent();
    const loading = ui.load("pages/hud_page.html", "vimium-hud-frame");
    const showing = ui.show({ name: "show" });
    assert.isFalse(await loading);
    assert.isFalse(await showing);
    ui.destroy();
    assert.equal("STALE_DOCUMENT", controller.lastErrorCode);
    assert.equal(0, controller.registry.size);
  });
  should("隐藏取消尚在握手的显示，迟到就绪不能显示旧请求", async () => {
    const ui = controller.createComponent();
    await ui.load("pages/vomnibar_page.html", "vomnibar-frame");
    const showing = ui.show({ name: "activate", interactionId: "old" });
    await ui.hide();
    const port = await ready(ui);
    assert.isFalse(await showing);
    assert.isFalse(ui.showing);
    assert.equal([], port.messages.filter((data) => data.name === "activate"));
  });
  should("错误证明和过期交互hide不能显示或关闭较新激活", async () => {
    const ui = controller.createComponent();
    await ui.load("pages/vomnibar_page.html", "vomnibar-frame");
    ui.receive({
      data: { name: "uiAuthorizationProof", proof: { componentId: "other", grantId: "g" } },
    }, channels[0].port1);
    ui.receive({ data: "uiComponentIsReady" }, channels[0].port1);
    assert.isFalse(Boolean(ui.ready));
    await ready(ui);
    assert.isTrue(await ui.show({ name: "activate", interactionId: "new" }));
    assert.isFalse(await ui.hide(true, "old"));
    assert.isTrue(ui.showing);
    await ui.hide(false, "new");
    assert.isFalse(ui.showing);
  });
  should("跨异步边界的文档与交互代次改变均撤销显示和延迟焦点", async () => {
    const ui = controller.createComponent();
    await ui.load("pages/hud_page.html", "vimium-hud-frame");
    const showing = ui.show({ name: "show" });
    host.interactionEpoch++;
    await ready(ui);
    assert.isFalse(await showing);
    let focusCalls = 0;
    page.focus = () => focusCalls++;
    const focusing = controller.focus.focus({ forceFocusThisFrame: true });
    host.runtimeEpoch++;
    assert.isFalse(await focusing);
    assert.equal(0, focusCalls);
  });
  should("100次组件开关后端口、DOM、组件注册与观察器没有净增长", async () => {
    const initial = observers.size;
    for (let index = 0; index < 100; index++) {
      const ui = controller.createComponent();
      await ui.load("pages/hud_page.html", "vimium-hud-frame");
      await ready(ui);
      await ui.show({ name: "show" });
      ui.destroy();
      ui.destroy();
      assert.equal(0, ui.resources.entries.size);
    }
    assert.equal(initial, observers.size);
    assert.equal(0, controller.registry.size);
    assert.equal(0, page.document.querySelectorAll(".vimium-reset").length);
    assert.isTrue(channels.every(({ port1, port2 }) => port1.closed === 1 && port2.closed === 1));
  });
  should("跨frame组件只归焦到显示时捕获的文档，替换后不发送无身份focusFrame", async () => {
    const original = {
      tabId: 5,
      frameId: 8,
      documentId: "source-old",
      runtimeEpoch: 3,
      planVersion: 8,
      incognito: false,
    };
    let current = { ...original };
    const delivered = [];
    stub(globalThis, "BrowserToolboxFrameRuntimeBridgeInstance", {
      sendToFrame: async () => delivered.push(current.documentId),
    });
    const send = controller.send;
    controller.send = async (request) => {
      if (request.action === "captureFocus") return { ok: true, target: { ...current } };
      if (request.action === "restoreFocus") {
        const target = request.payload.target;
        if (
          target.documentId === current.documentId && target.runtimeEpoch === current.runtimeEpoch
        ) {
          delivered.push(target.documentId);
        }
        return { ok: true };
      }
      return send(request);
    };
    const ui = controller.createComponent();
    await ui.load("pages/vomnibar_page.html", "vomnibar-frame");
    await ready(ui);
    ui.iframeElement.focus = ui.iframeElement.blur = () => {};
    await ui.show({ name: "activate" }, { focus: true, sourceFrameId: 8 });
    current = { ...original, documentId: "source-new" };
    await ui.hide();
    assert.equal([], delivered);
    current = { ...original };
    await ui.show({ name: "activate" }, { focus: true, sourceFrameId: 8 });
    await ui.hide();
    assert.equal(["source-old"], delivered);
  });
  should("源身份读取失败或隐藏后迟到都不显示组件或恢复焦点", async () => {
    const ui = controller.createComponent();
    await ui.load("pages/vomnibar_page.html", "vomnibar-frame");
    await ready(ui);
    const capture = deferred(), requests = [];
    controller.send = async (request) => {
      requests.push(request);
      return request.action === "captureFocus" ? capture.promise : { ok: true };
    };
    const showing = ui.show({ name: "activate" }, { focus: true, sourceFrameId: 8 });
    await ui.hide();
    capture.resolve({ ok: true, target: { documentId: "late", runtimeEpoch: 1 } });
    assert.isFalse(await showing);
    assert.isFalse(ui.showing);
    assert.equal(0, requests.filter((request) => request.action === "restoreFocus").length);
    controller.send = async () => ({ ok: false, code: "STALE_DOCUMENT" });
    assert.isFalse(await ui.show({ name: "activate" }, { focus: true, sourceFrameId: 8 }));
  });
  should("HUD租约防止提前拆除，最后一个剪贴板回执后立即释放", () => {
    const hud = controller.hud;
    let destroyed = 0;
    hud.hudUI = {
      destroy() {
        destroyed++;
      },
    };
    const first = hud.retainClipboard("a"), second = hud.retainClipboard("b");
    hud.releaseIfIdle();
    assert.equal(0, destroyed);
    first.release();
    assert.equal(0, destroyed);
    second.release();
    assert.equal(1, destroyed);
    second.release();
    assert.equal(1, destroyed);
    assert.equal(0, hud.clipboardRequests.size);
  });
  should("引擎关闭恢复兼容门面，旧控制器重复销毁不会覆盖恢复结果", () => {
    assert.isFalse(facade.show() === "compat");
    controller.destroy();
    assert.equal("compat", facade.show());
    assert.equal(5, facade.generation);
    controller.destroy();
    assert.equal("compat", facade.show());
    assert.equal(0, observers.size);
  });
});

context("独立HUD渲染和私有会话", () => {
  let dom, renderer, messages, history, page;
  setup(() => {
    dom = new JSDOM("<!doctype html><div id='hud'></div>");
    page = dom.window;
    messages = [];
    history = { init: async () => {}, getQuery: (index) => ["旧查询"][index], destroy() {} };
    renderer = new HudController({ post: (message) => messages.push(message), page, history });
  });
  teardown(() => {
    renderer.destroy();
    dom.window.close();
  });
  const event = (type, key, extra = {}) => ({
    type,
    key,
    keyCode: 0,
    preventDefault() {},
    stopImmediatePropagation() {},
    ...extra,
  });
  should("组合态Esc保留输入，确认候选的Enter不退出，下一次Enter仅提交一次", async () => {
    await renderer.showFind("find-a");
    const input = page.document.getElementById("hud-find-input");
    input.dispatchEvent(new page.Event("compositionstart"));
    input.textContent = "中文";
    renderer.key(event("keydown", "Escape", { isComposing: true }));
    renderer.key(event("keydown", "Enter", { keyCode: 229 }));
    assert.equal([], messages);
    input.dispatchEvent(new page.Event("compositionend"));
    renderer.key(event("keypress", "Enter"));
    assert.equal(["search"], messages.map((message) => message.name));
    renderer.keyup(event("keyup", "Enter"));
    renderer.key(event("keydown", "Enter"));
    renderer.key(event("keypress", "Enter"));
    renderer.key(event("keypress", "Enter"));
    assert.equal(1, messages.filter((message) => message.name === "hideFindMode").length);
    renderer.keyup(event("keyup", "Enter"));
    assert.equal("findKeyReleased", messages.at(-1).name);
  });
  should("隐藏使等待历史的旧查找不能覆盖新提示，反复打开不积累输入节点", async () => {
    const reply = deferred();
    renderer.historyReady = reply.promise;
    const waiting = renderer.showFind("old");
    renderer.show("新提示");
    reply.resolve();
    assert.isFalse(await waiting);
    assert.equal("新提示", renderer.element().textContent);
    for (let index = 0; index < 5; index++) await renderer.showFind("find-" + index);
    assert.equal(1, page.document.querySelectorAll("#hud-find-input").length);
    assert.equal(1, page.document.querySelectorAll("#hud-match-count").length);
  });
  should("历史上下键恢复未提交的部分输入，不覆盖确认后的中文", async () => {
    await renderer.showFind("history");
    renderer.find.input.textContent = "部分中文";
    renderer.search(renderer.find);
    renderer.key(event("keydown", "ArrowUp"));
    assert.equal("旧查询", renderer.find.input.textContent);
    renderer.key(event("keydown", "ArrowDown"));
    assert.equal("部分中文", renderer.find.input.textContent);
  });
  should("剪贴板拒绝也交付唯一结束回执；页面销毁取消尚未执行的写入", async () => {
    let writes = 0;
    Object.defineProperty(page.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          writes++;
          throw new Error("NotAllowedError");
        },
      },
    });
    page.document.hasFocus = () => true;
    renderer.post = (message) => {
      messages.push(message);
      if (message.name === "clipboardFocus") {
        renderer.handle({
          name: "clipboardFocusResult",
          clipboardRequestId: message.clipboardRequestId,
          ok: true,
        });
      }
    };
    await renderer.clipboard({ data: "合成文本", clipboardRequestId: "first" }, "copy");
    assert.equal(1, writes);
    assert.equal(1, messages.filter((message) => message.name === "clipboardComplete").length);
    assert.isFalse(messages.at(-1).ok);
    const pending = renderer.clipboard({ data: "取消", clipboardRequestId: "second" }, "copy");
    renderer.destroy();
    await pending;
    assert.equal(1, writes);
    assert.equal(0, renderer.jobs.size);
  });
  should("私有端口只就绪一次，pagehide后消息与DOM就绪均不能复活会话", () => {
    const events = new EventTarget(), document = new EventTarget();
    document.readyState = "loading";
    const sent = [];
    let closed = 0, delivered = 0;
    const port = { postMessage: (data) => sent.push(data), close: () => closed++ };
    const session = new UiSession({
      port,
      page: Object.assign(events, { document, frameId: 9 }),
      handler: () => delivered++,
    });
    document.dispatchEvent(new Event("DOMContentLoaded"));
    session.notifyReady();
    assert.equal(["setIframeFrameId", "uiComponentIsReady"], sent.map((message) => message.name));
    port.onmessage({ data: { name: "show" } });
    assert.equal(1, delivered);
    const old = port.onmessage;
    events.dispatchEvent(new Event("pagehide"));
    old({ data: {} });
    session.notifyReady();
    session.destroy();
    assert.equal(1, delivered);
    assert.equal(1, closed);
    assert.equal(2, sent.length);
  });
});

context("框架焦点的原生文档定向", () => {
  function fixture() {
    const sent = [];
    const source = { documentId: "source", runtimeEpoch: 1, planVersion: 8, incognito: false };
    const targets = [0, 1, 2].map((frameId) => ({ ...source, documentId: "frame-" + frameId }));
    const authority = {
      verify: async (identity) => {
        if (
          ["documentId", "runtimeEpoch", "incognito"].some((key) => identity[key] !== source[key])
        ) {
          throw Object.assign(new Error("STALE_RUNTIME"), { code: "STALE_RUNTIME" });
        }
        return { ...source };
      },
      compatible: async () => ({ ...source }),
      frames: async () =>
        targets.map((identity, frameId) => ({ frameId, documentId: identity.documentId })),
      target: async (_tabId, frameId) => ({ ...targets[frameId] }),
    };
    const service = new FrameFocusService({
      authority,
      allowsPlan: (plan) => plan === 8,
      api: {
        tabs: {
          sendMessage: async (_tabId, message, options) => {
            sent.push({ message, options });
            if (message.payload.message.handler === "getFocusStatus") {
              return {
                focused: options.documentId === "frame-0",
                focusable: options.documentId !== "frame-1",
              };
            }
          },
        },
      },
    });
    return { sent, source, targets, authority, service };
  }
  should("UI归焦只投递捕获的Native文档和代次，不重新绑定同frameId", async () => {
    const h = fixture(), sender = { tab: { id: 5 } };
    const captured = await h.service.captureFocus(2, h.source, sender);
    await h.service.restoreFocus(captured, h.source, sender);
    assert.equal({ documentId: "frame-2" }, h.sent.at(-1).options);
    assert.equal(1, h.sent.at(-1).message.identity.runtimeEpoch);
    assert.isTrue(h.sent.at(-1).message.payload.message.forceFocusThisFrame);
    for (const change of [{ documentId: "replacement" }, { runtimeEpoch: 2 }]) {
      const race = fixture(), owner = { ...race.source };
      const target = await race.service.captureFocus(2, owner, sender);
      Object.assign(race.targets[2], change);
      let failure;
      try {
        await race.service.restoreFocus(target, owner, sender);
      } catch (error) {
        failure = error;
      }
      assert.equal("STALE_DOCUMENT", failure?.code);
      assert.equal(0, race.sent.length);
    }
  });
  should("UI归焦拒绝跨标签、无痕、方案、所有者失效及组件伪装", async () => {
    for (const change of [{ tabId: 6 }, { incognito: true }, { planVersion: 7 }]) {
      const h = fixture(), sender = { tab: { id: 5 } };
      const target = await h.service.captureFocus(2, h.source, sender);
      let failure;
      try {
        await h.service.restoreFocus({ ...target, ...change }, h.source, sender);
      } catch (error) {
        failure = error;
      }
      assert.equal("STALE_DOCUMENT", failure?.code);
      assert.equal(0, h.sent.length);
    }
    const h = fixture(), owner = { ...h.source }, sender = { tab: { id: 5 } };
    const target = await h.service.captureFocus(2, owner, sender);
    h.source.runtimeEpoch++;
    let failure;
    try {
      await h.service.restoreFocus(target, owner, sender);
    } catch (error) {
      failure = error;
    }
    assert.equal("STALE_RUNTIME", failure?.code);
    assert.equal(0, h.sent.length);
    h.source.component = "vomnibar";
    failure = null;
    try {
      await h.service.captureFocus(2, h.source, sender);
    } catch (error) {
      failure = error;
    }
    assert.equal("PERMISSION_DENIED", failure?.code);
  });
  should("归焦最后一次Native读取后来源失效时也不产生副作用", async () => {
    const h = fixture(), owner = { ...h.source }, sender = { tab: { id: 5 } };
    const target = await h.service.captureFocus(2, owner, sender);
    const read = h.authority.target;
    h.authority.target = async (...args) => {
      const identity = await read(...args);
      h.source.runtimeEpoch++;
      return identity;
    };
    let failure;
    try {
      await h.service.restoreFocus(target, owner, sender);
    } catch (error) {
      failure = error;
    }
    assert.equal("STALE_RUNTIME", failure?.code);
    assert.equal(0, h.sent.length);
  });
  should("忽略不可聚焦frame并按count循环，焦点消息只投递到捕获的documentId", async () => {
    const h = fixture();
    await h.service.next({ tabId: 5, count: 1 }, {});
    assert.equal("frame-2", h.sent.at(-1).options.documentId);
    assert.equal("focusFrame", h.sent.at(-1).message.payload.message.handler);
    assert.equal("frame-2", h.sent.at(-1).message.identity.documentId);
  });
  should("目标在读取后导航替换或来源代次变化，都不能把焦点交给新文档", async () => {
    for (const targetChanged of [false, true]) {
      const h = fixture();
      let guarded = 0;
      let failed = false;
      try {
        await h.service.next({
          tabId: 5,
          executionGuard: () => {
            if (++guarded === 2) {
              if (targetChanged) h.targets[2].documentId = "replacement";
              else h.source.runtimeEpoch++;
            }
          },
        }, {});
      } catch (_) {
        failed = true;
      }
      assert.isTrue(failed);
      assert.equal(
        0,
        h.sent.filter(({ message }) => message.payload.message.handler === "focusFrame").length,
      );
    }
  });
});

context("HUD剪贴板焦点许可的异步边界", () => {
  let parentDom, childDom, parentPage, childPage, hud, renderer, ui, controller;
  let source, next, messages, observers, writes, childFocusCalls, parentFocusCalls, write;
  let nativeFocusListeners;
  setup(() => {
    parentDom = new JSDOM("<body><input id='source'><input id='next'><div id='host'></div></body>");
    childDom = new JSDOM("<body><div id='hud'></div></body>");
    const document = parentDom.window.document;
    source = document.getElementById("source");
    next = document.getElementById("next");
    source.focus();
    const shadowDOM = document.getElementById("host").attachShadow({ mode: "open" });
    const iframeElement = document.createElement("iframe");
    shadowDOM.append(iframeElement);
    messages = [];
    observers = new Map();
    writes = childFocusCalls = parentFocusCalls = 0;
    write = async () => {};
    parentPage = {
      document,
      focus: () => {
        parentFocusCalls++;
        source.focus();
      },
    };
    controller = {
      page: parentPage,
      host: {
        interactionEpoch: 1,
        observe(name, callback) {
          const callbacks = observers.get(name) || new Set();
          observers.set(name, callbacks);
          callbacks.add(callback);
          return () => callbacks.delete(callback);
        },
      },
      valid: () => true,
      components: new Set(),
    };
    hud = new BrowserToolboxHudRuntime.Hud(controller, 3);
    hud.displayWanted = true;
    childPage = childDom.window;
    nativeFocusListeners = new Set();
    const addListener = childPage.addEventListener.bind(childPage);
    const removeListener = childPage.removeEventListener.bind(childPage);
    childPage.addEventListener = (name, listener, options) => {
      if (name === "focus") nativeFocusListeners.add(listener);
      addListener(name, listener, options);
    };
    childPage.removeEventListener = (name, listener, options) => {
      if (name === "focus") nativeFocusListeners.delete(listener);
      removeListener(name, listener, options);
    };
    childPage.document.hasFocus = () => shadowDOM.activeElement === iframeElement;
    childPage.focus = () => {
      childFocusCalls++;
      iframeElement.focus();
    };
    Object.defineProperty(childPage, "parent", { value: parentPage });
    Object.defineProperty(childPage.navigator, "clipboard", {
      value: {
        writeText: async () => {
          writes++;
          await write();
        },
      },
    });
    renderer = new HudController({
      page: childPage,
      history: { init: async () => {}, destroy() {} },
      post(message) {
        messages.push(message);
        hud.handleUIComponentMessage({ data: message });
      },
    });
    ui = {
      shadowDOM,
      iframeElement,
      postMessage: async (message) => renderer.handle(message),
      destroy() {
        this.disposed = true;
        iframeElement.remove();
      },
    };
    hud.hudUI = ui;
    controller.components.add(ui);
  });
  teardown(() => {
    renderer.destroy();
    hud.destroy();
    parentDom.window.close();
    childDom.window.close();
  });
  function begin(id = "copy") {
    hud.retainClipboard(id);
    const pending = renderer.clipboard({ clipboardRequestId: id, data: "合成文本" }, "copy");
    return { pending, release: () => renderer.jobs.get(id)?.resolveWait(true) };
  }
  const listenerCount = () => [...observers.values()].reduce((sum, set) => sum + set.size, 0);
  should("原页面持焦时正常授焦，渲染器不直接聚焦且回执释放所有等待", async () => {
    const job = begin();
    job.release();
    await job.pending;
    assert.equal(1, writes);
    assert.equal(0, childFocusCalls);
    assert.equal(1, parentFocusCalls);
    assert.isTrue(messages.at(-1).ok);
    assert.equal(0, hud.clipboardRequests.size);
    assert.equal(0, renderer.jobs.size);
    assert.equal(0, listenerCount());
  });
  should("延迟期间新Vomnibar持焦时旧剪贴板不能夺焦或调用API", async () => {
    const job = begin();
    controller.components.add({ showing: true, focusOptions: { focus: true } });
    next.focus();
    job.release();
    await job.pending;
    assert.equal(next, parentPage.document.activeElement);
    assert.equal(0, writes);
    assert.equal(0, childFocusCalls + parentFocusCalls);
    assert.equal(1, messages.filter((message) => message.name === "clipboardComplete").length);
    assert.isFalse(messages.at(-1).ok);
    assert.equal(0, hud.clipboardRequests.size);
    assert.equal(0, listenerCount());
  });
  should("授焦回执先于子页面原生焦点时等待事件再复制并释放监听", async () => {
    let focused = false;
    childPage.document.hasFocus = () => focused;
    const job = begin();
    job.release();
    await tick();
    assert.equal(0, writes);
    assert.equal(1, renderer.jobs.size);
    assert.equal(1, nativeFocusListeners.size);
    focused = true;
    childPage.dispatchEvent(new childPage.Event("focus"));
    await job.pending;
    assert.equal(1, writes);
    assert.equal(0, childFocusCalls);
    assert.isTrue(messages.at(-1).ok);
    assert.equal(0, renderer.jobs.size);
    assert.equal(0, hud.clipboardRequests.size);
    assert.equal(0, nativeFocusListeners.size);
  });
  for (const action of ["hidden", "destroy"]) {
    should(`${action}取消原生焦点等待，迟到事件不能写入且不遗留监听`, async () => {
      let focused = false;
      childPage.document.hasFocus = () => focused;
      const job = begin();
      job.release();
      await tick();
      assert.equal(1, nativeFocusListeners.size);
      renderer[action]();
      await job.pending;
      focused = true;
      childPage.dispatchEvent(new childPage.Event("focus"));
      await tick();
      assert.equal(0, writes);
      assert.equal(0, childFocusCalls);
      assert.equal(0, renderer.jobs.size);
      assert.equal(0, nativeFocusListeners.size);
    });
  }
  should("授焦已耗尽原有期限时不再给原生焦点新增等待期限", async () => {
    let now = 0, reply;
    childPage.performance.now = () => now;
    childPage.document.hasFocus = () => false;
    ui.postMessage = async (message) => reply = message;
    const job = begin();
    job.release();
    await tick();
    now = 1001;
    await renderer.handle(reply);
    await job.pending;
    assert.equal(0, writes);
    assert.equal(0, renderer.jobs.size);
    assert.equal(0, nativeFocusListeners.size);
    assert.isFalse(messages.at(-1).ok);
  });
  should("原焦点仍在但新按键交互已开始时撤销旧许可", async () => {
    const job = begin();
    for (const callback of observers.get("keydown") || []) callback({ key: "o" });
    job.release();
    await job.pending;
    assert.equal(0, writes);
    assert.equal(source, parentPage.document.activeElement);
    assert.equal(0, listenerCount());
  });
  should("原焦点快照变化或交互代次变化均拒绝旧许可", async () => {
    let job = begin("focus");
    next.focus();
    job.release();
    await job.pending;
    assert.equal(0, writes);
    source.focus();
    job = begin("epoch");
    controller.host.interactionEpoch++;
    job.release();
    await job.pending;
    assert.equal(0, writes);
    assert.equal(0, hud.clipboardRequests.size);
  });
  should("其他组件新建或在途show改变revision时均撤销旧许可", async () => {
    const other = { showing: false, revision: 1, focusOptions: {} };
    controller.components.add(other);
    let job = begin("pending-show");
    other.revision++;
    job.release();
    await job.pending;
    assert.equal(0, writes);
    job = begin("created-ui");
    controller.components.add({ showing: false, revision: 0, focusOptions: {} });
    job.release();
    await job.pending;
    assert.equal(0, writes);
    assert.equal(0, listenerCount());
  });
  should("已释放的租约不能再次申请焦点", async () => {
    const job = begin();
    hud.clipboardRequests.get("copy").release();
    job.release();
    await job.pending;
    assert.equal(0, writes);
    assert.equal(source, parentPage.document.activeElement);
    assert.equal(0, listenerCount());
  });
  should("许可返回前新UI取焦时渲染器复核实际焦点并取消写入", async () => {
    let reply;
    ui.postMessage = async (message) => {
      reply = message;
    };
    const job = begin();
    job.release();
    await tick();
    assert.equal("clipboardFocusResult", reply?.name);
    next.focus();
    await renderer.handle(reply);
    await job.pending;
    assert.equal(0, writes);
    assert.equal(next, parentPage.document.activeElement);
    assert.isFalse(messages.at(-1).ok);
  });
  should("Clipboard API延迟完成时不归焦到已经被新UI替代的页面", async () => {
    const response = deferred();
    write = () => response.promise;
    const job = begin();
    job.release();
    await tick();
    assert.equal(1, writes);
    next.focus();
    response.resolve();
    await job.pending;
    assert.equal(next, parentPage.document.activeElement);
    assert.equal(0, parentFocusCalls);
    assert.equal(0, messages.filter((message) => message.name === "unfocusIfFocused").length);
    assert.isTrue(messages.at(-1).ok);
  });
  should("并发剪贴板的新租约持焦时旧完成回执不能归焦", async () => {
    const first = deferred(), second = deferred();
    write = () => writes === 1 ? first.promise : second.promise;
    const old = begin("old");
    old.release();
    await tick();
    const current = begin("current");
    current.release();
    await tick();
    assert.equal(2, writes);
    first.resolve();
    await old.pending;
    assert.equal(0, parentFocusCalls);
    assert.isTrue(childPage.document.hasFocus());
    assert.equal("current", hud.clipboardFocusOwner.id);
    second.resolve();
    await current.pending;
    assert.equal(1, parentFocusCalls);
    assert.equal(0, hud.clipboardRequests.size);
  });
  should("许可无回应时有界结束，迟到回执不能复活写入", async () => {
    let reply;
    ui.postMessage = async (message) => {
      reply = message;
    };
    const job = begin();
    job.release();
    await job.pending;
    assert.equal(0, writes);
    assert.equal(0, renderer.jobs.size);
    assert.equal(0, hud.clipboardRequests.size);
    assert.equal(0, listenerCount());
    await renderer.handle(reply);
    assert.equal(0, writes);
  });
  should("隐藏立即结算等待许可的任务，销毁不遗留等待或重复结束回执", async () => {
    ui.postMessage = async () => {};
    let job = begin("hidden");
    job.release();
    await tick();
    let settled = false;
    job.pending.then(() => settled = true);
    renderer.hidden();
    await tick();
    assert.isTrue(settled);
    await job.pending;
    assert.equal(0, writes);
    assert.equal(0, renderer.jobs.size);
    assert.equal(1, messages.filter((message) => message.name === "clipboardComplete").length);
    job = begin("destroyed");
    job.release();
    await tick();
    renderer.destroy();
    hud.destroy();
    await job.pending;
    assert.equal(0, writes);
    assert.equal(0, renderer.jobs.size);
    assert.equal(0, listenerCount());
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// 标记的存储兼容、键盘交互、身份竞争和副作用去重各自使用独立期望。
import "../test_helper.js";
import "../../../lib/settings.js";
import "../../../lib/keyboard_utils.js";
import "../../../lib/handler_stack.js";
import "../../../content_scripts/mode.js";
import "../../../lib/browser_toolbox/command_invocation.js";
import "../../../lib/browser_toolbox/message_protocol.js";
import "../../../lib/browser_toolbox/runtime_host.js";
import "../../../lib/browser_toolbox/marks_compat_storage.js";
import "../../../lib/i18n.js";
import "../../../content_scripts/browser_toolbox/marks_runtime.js";
import { MarksService } from "../../../background_scripts/browser_toolbox/marks_service.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => resolve = done);
  return { promise, resolve };
};
const key = (properties = {}) => ({
  type: "keydown",
  key: "a",
  code: "KeyA",
  keyCode: 65,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...properties,
});
context("Marks 页面数据与独立选择模式", () => {
  let page, store, controller, resources, host, messages, requests;
  setup(async () => {
    await Settings.onLoaded();
    const local = new Map();
    page = {
      location: { href: "https://synthetic.invalid/page#old", hash: "#old" },
      scrollX: 0,
      scrollY: 120,
      localStorage: { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, v) },
      Marks: { localRegisters: {} },
      scrollTo(x, y) {
        this.scrollX = x;
        this.scrollY = y;
      },
      focus() {},
      document: { body: { focus() {} } },
    };
    store = new BrowserToolboxMarksCompatStorage.PageStorage(page);
    messages = [];
    requests = [];
    stub(globalThis, "HUD", { show: (message) => messages.push(message), hide() {} });
    stub(globalThis, "DomUtils", { documentReady: async () => {}, isWindow: () => false });
    host = {
      runtimeEpoch: 3,
      state: "active",
      context: { documentId: "synthetic" },
      plan: { moduleImplementations: { marks: "browser-toolbox" } },
    };
    stub(globalThis, "BrowserToolboxRuntimeHostInstance", host);
    resources = new BrowserToolboxRuntime.ResourceScope();
    controller = new BrowserToolboxMarksRuntime.Controller(
      resources,
      { documentId: "synthetic", frameId: 0 },
      () => true,
      {
        page,
        store,
        send: async (message) => {
          requests.push(message);
          return { ok: true };
        },
      },
    );
  });
  teardown(() => resources.dispose());
  should("页面标记按去hash URL共享，两个前位置寄存器保持文档内兼容", () => {
    store.write("a", controller.capture());
    assert.equal(
      JSON.stringify({ scrollX: 0, scrollY: 120, hash: "#old" }),
      page.localStorage.getItem("vimiumMark|https://synthetic.invalid/page|a"),
    );
    page.location.href = "https://synthetic.invalid/page#new";
    assert.equal(120, store.read("a").scrollY);
    controller.remember();
    page.scrollY = 0;
    assert.equal(120, store.read("'").scrollY);
    assert.equal(store.read("'"), store.read("`"));
  });
  should("局部跳转保存前位置并支持反复返回；hash原点沿用锚点导航", async () => {
    store.write("a", { scrollX: 0, scrollY: 450, hash: "" });
    await controller.perform("goto", "a", false, 0);
    assert.equal(450, page.scrollY);
    await controller.perform("goto", "'", false, 0);
    assert.equal(120, page.scrollY);
    await controller.perform("goto", "`", false, 0);
    assert.equal(450, page.scrollY);
    store.write("b", { scrollX: 0, scrollY: 0, hash: "#target" });
    await controller.perform("goto", "b", false, 0);
    assert.equal("#target", page.location.hash);
    assert.equal([], requests);
  });
  should("损坏值不能滚动或覆盖前位置，存储拒绝不会留下选择模式", async () => {
    page.localStorage.setItem(store.key("a"), "{broken");
    let rejected = false;
    try {
      await controller.perform("goto", "a", false, 0);
    } catch (_) {
      rejected = true;
    }
    assert.isTrue(rejected);
    assert.equal(120, page.scrollY);
    assert.equal({}, page.Marks.localRegisters);
    store.write = () => {
      throw new Error("SecurityError");
    };
    controller.open("create");
    handlerStack.bubbleEvent("keydown", key());
    await tick();
    assert.equal(null, controller.mode);
    assert.equal(BrowserToolboxI18n.message("markUnavailable"), messages.at(-1));
  });
  should("组合态、229、dead key、修饰键和重复键不提交，Esc可退出并释放模式", () => {
    controller.open("create");
    for (
      const properties of [{ isComposing: true }, { keyCode: 229 }, { key: "Dead" }, {
        key: "Shift",
      }, { repeat: true }]
    ) {
      // 引擎在进入共享 Mode 前已经放行IME；直接调用选择回调验证其自身仍无副作用。
      controller.mode.options.keydown(key(properties));
      assert.isTrue(controller.mode.modeIsActive);
    }
    handlerStack.bubbleEvent("keydown", key({ key: "Escape", code: "Escape" }));
    assert.equal(null, controller.mode);
    assert.equal(null, store.read("a"));
    assert.equal([], requests);
  });
  should("Shift及swap选择全局，但前位置寄存器始终局部；全局提交只发送一次", async () => {
    controller.open("create");
    handlerStack.bubbleEvent("keydown", key({ key: "A", shiftKey: true }));
    handlerStack.bubbleEvent("keydown", key({ key: "A", shiftKey: true, repeat: true }));
    await tick();
    assert.equal(1, requests.length);
    assert.equal(
      { operation: "create", name: "A", position: controller.capture() },
      requests[0].payload,
    );
    assert.equal(
      { documentId: "synthetic", runtimeEpoch: 3, incognito: false },
      requests[0].identity,
    );
    controller.open("create", { options: { swap: true } });
    handlerStack.bubbleEvent("keydown", key());
    await tick();
    assert.equal("a", requests[1].payload.name);
    controller.open("goto", { options: { swap: true } });
    handlerStack.bubbleEvent("keydown", key({ key: "'", code: "Quote", shiftKey: true }));
    await tick();
    assert.equal(2, requests.length);
  });
  should("忽略布局时Dead/Process/Unidentified仍不能用物理code提交标记", () => {
    const get = Settings.get.bind(Settings);
    stub(Settings, "get", (name) => name === "ignoreKeyboardLayout" ? true : get(name));
    controller.open("create");
    for (const name of ["Dead", "Process", "Unidentified"]) {
      controller.mode.options.keydown(key({ key: name, code: "KeyA" }));
      assert.equal(null, store.read("a"));
      assert.isTrue(controller.mode.modeIsActive);
    }
    controller.cancelInteractions();
    assert.equal([], requests);
  });
  should("子框架不把自身坐标冒充顶层；取消或旧代次的迟到回包不展示HUD", async () => {
    controller.context.frameId = 8;
    const pending = deferred();
    controller.send = (message) => {
      requests.push(message);
      return pending.promise;
    };
    controller.open("create");
    handlerStack.bubbleEvent("keydown", key({ key: "A", shiftKey: true }));
    assert.equal({ operation: "create", name: "A" }, requests[0].payload);
    const before = messages.length;
    controller.cancelInteractions();
    pending.resolve({ ok: true });
    await tick();
    assert.equal(before, messages.length);
    host.runtimeEpoch++;
    assert.isFalse(controller.open("goto"));
  });
  should("DOM就绪期间销毁不能恢复焦点或滚动；100次开关不增加模式", async () => {
    const base = Mode.modes.length;
    for (let i = 0; i < 100; i++) {
      controller.open("goto");
      controller.cancelInteractions();
    }
    assert.equal(base, Mode.modes.length);
    const pending = deferred();
    DomUtils.documentReady = () => pending.promise;
    let focused = 0;
    page.focus = () => focused++;
    const restoring = controller.restorePosition({ scrollX: 0, scrollY: 999 });
    controller.destroy();
    pending.resolve();
    assert.isFalse(await restoring);
    assert.equal(0, focused);
    assert.equal(120, page.scrollY);
  });
});

function serviceHarness() {
  let active = true, role = "content", plan = 7;
  const effects = [], saved = new Map(), requests = new Set();
  const tabs = new Map([[1, {
    id: 1,
    windowId: 1,
    url: "https://synthetic.invalid/source",
    index: 0,
  }]]);
  const api = {
    tabs: {
      get: async (id) => {
        if (!tabs.has(id)) throw new Error("closed");
        return tabs.get(id);
      },
      query: async () => [],
      update: async (id, properties) => {
        effects.push(["activate", id]);
        return { ...tabs.get(id), ...properties };
      },
    },
    windows: { getCurrent: async () => ({ id: 1 }), update: async () => effects.push(["focus"]) },
  };
  const service = new MarksService({
    api,
    authority: {
      role: () => role,
      verify: async () => {
        if (!active) throw Object.assign(new Error("stale"), { code: "STALE_RUNTIME" });
        return { planVersion: plan, frameId: 0 };
      },
    },
    ledger: {
      begin: async ({ requestId }) => {
        if (requests.has(requestId)) return "DUPLICATE_REQUEST";
        requests.add(requestId);
        return null;
      },
      complete: async () => {},
    },
    allowsPlan: (version) => version === 7,
    paused: () => false,
    relay: async (...args) => {
      effects.push(["relay", ...args]);
      return { scrollX: 0, scrollY: 230 };
    },
    open: async () => {
      effects.push(["open"]);
      const tab = { id: 2, windowId: 1 };
      tabs.set(2, tab);
      return tab;
    },
    ready: async () => effects.push(["ready"]),
    store: {
      read: async (name) => saved.get(name),
      write: async (name, value) => saved.set(name, value),
      prepare: async (name, tab, position) => ({
        ...position,
        tabId: tab.id,
        url: tab.url,
        markName: name,
      }),
      sameSession: async () => true,
    },
  });
  const sender = { tab: tabs.get(1), frameId: 0, documentId: "source" };
  const request = (operation = "create", extra = {}) => ({
    requestId: crypto.randomUUID(),
    payload: { operation, name: "A", ...extra },
    identity: { documentId: "source", runtimeEpoch: 3, incognito: false },
  });
  return {
    service,
    effects,
    saved,
    api,
    sender,
    request,
    tabs,
    stale: () => active = false,
    role: (value) => role = value,
    plan: (value) => plan = value,
  };
}
context("Marks 后台原生身份与副作用", () => {
  should("记录逻辑寄存器名，重放不写第二次；无痕沿用同一兼容存储策略", async () => {
    const h = serviceHarness(),
      request = h.request("create", { position: { scrollX: 0, scrollY: 400 } });
    h.sender.tab.incognito = true;
    request.identity.incognito = true;
    assert.isTrue((await h.service.handle(request, h.sender)).ok);
    assert.equal(400, h.saved.get("A").scrollY);
    assert.equal("A", h.saved.get("A").markName);
    assert.equal("DUPLICATE_REQUEST", (await h.service.handle(request, h.sender)).code);
    assert.equal([], h.effects);
  });
  should("无效请求、未登记方案及组件角色无副作用", async () => {
    const h = serviceHarness();
    for (
      const extra of [{ name: "vimiumGlobalMark|A" }, { name: "'" }, { url: "forbidden" }, {
        position: { scrollX: 0, scrollY: Infinity },
      }]
    ) {
      assert.equal(
        "INVALID_MARK_ACTION",
        (await h.service.handle(h.request("create", extra), h.sender)).code,
      );
    }
    h.plan(6);
    let code;
    try {
      await h.service.handle(h.request(), h.sender);
    } catch (error) {
      code = error.code;
    }
    assert.equal("PERMISSION_DENIED", code);
    h.plan(7);
    h.role("component");
    try {
      await h.service.handle(h.request(), h.sender);
    } catch (error) {
      code = error.code;
    }
    assert.equal("PERMISSION_DENIED", code);
    assert.equal(0, h.saved.size);
    assert.equal([], h.effects);
  });
  should("顶层位置读取或保存准备期间文档失效，不能写入全局标记", async () => {
    const h = serviceHarness();
    h.service.store.prepare = async () => {
      h.stale();
      return {};
    };
    assert.equal("STALE_RUNTIME", (await h.service.handle(h.request(), h.sender)).code);
    assert.equal(0, h.saved.size);
    assert.equal("getScrollPosition", h.effects[0][3].handler);
  });
  should("旧tabId失效时创建一次并等真实注册，缺标记不导航", async () => {
    const h = serviceHarness();
    assert.equal("MARK_NOT_SET", (await h.service.handle(h.request("goto"), h.sender)).code);
    h.saved.set("A", {
      tabId: 99,
      url: "https://synthetic.invalid/target",
      scrollX: 0,
      scrollY: 500,
    });
    const request = h.request("goto");
    assert.isTrue((await h.service.handle(request, h.sender)).ok);
    assert.equal(
      ["open", "ready", "activate", "focus", "relay"],
      h.effects.map((effect) => effect[0]),
    );
    assert.equal(7, h.effects.at(-1).at(-1));
    assert.equal("DUPLICATE_REQUEST", (await h.service.handle(request, h.sender)).code);
    assert.equal(1, h.effects.filter((effect) => effect[0] === "open").length);
  });
  should("原标签已存在时只聚焦和恢复；异步激活后失效不能再聚焦窗口或滚动", async () => {
    const h = serviceHarness();
    h.saved.set("A", { tabId: 1, url: h.sender.tab.url, scrollX: 0, scrollY: 500 });
    h.api.tabs.update = async (id) => {
      h.effects.push(["activate", id]);
      h.stale();
      return h.tabs.get(id);
    };
    assert.equal("STALE_RUNTIME", (await h.service.handle(h.request("goto"), h.sender)).code);
    assert.equal([["activate", 1]], h.effects);
  });
});

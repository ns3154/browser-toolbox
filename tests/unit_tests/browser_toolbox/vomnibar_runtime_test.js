// SPDX-License-Identifier: GPL-3.0-or-later
// 可重复的状态竞争测试补充真实CFT；模拟composition不能代替系统输入法人工验收。
import { jsdomStub } from "../test_helper.js";
import "../../../lib/types.js";
import "../../../lib/keyboard_utils.js";
import "../../../lib/settings.js";
import "../../../lib/i18n.js";
import { VomnibarController } from "../../../pages/browser_toolbox/vomnibar_controller.js";
import "../../../content_scripts/browser_toolbox/vomnibar_runtime.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => resolve = done);
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const key = (properties) => ({
  type: "keydown",
  key: "a",
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  preventDefault() {
    this.prevented = true;
  },
  stopImmediatePropagation() {
    this.stopped = true;
  },
  ...properties,
});
const item = (value = {}) => ({
  url: "https://synthetic.invalid/alpha",
  html: "<div class=top-half>synthetic alpha</div>",
  description: "history",
  ...value,
});
context("独立查找栏激活和候选", () => {
  let ui, sent, posted, results, api;
  setup(async () => {
    await jsdomStub("pages/vomnibar_page.html");
    // 适配入口只加载本目录，不能依赖整套单元测试提前加载全局键盘设置。
    await Settings.onLoaded();
    sent = [];
    posted = [];
    results = [];
    api = {
      runtime: {
        sendMessage: async (message) => {
          sent.push(message);
          return message.handler === "filterCompletions" ? results : undefined;
        },
      },
    };
    ui = new VomnibarController({
      api,
      messenger: { postMessage: (message) => posted.push(message) },
      settings: { get: () => "g: https://synthetic.invalid/search?q=%s synthetic Search" },
    });
    stub(UrlUtils, "isUrl", async (value) => value.startsWith("https://"));
  });
  teardown(() => ui.destroy());
  should("三种模式复用CSS/ARIA和本地化，显式关键词保留", async () => {
    for (const name of ["omni", "bookmarks", "tabs"]) {
      await ui.activate({ completer: name, selectFirst: true, newTab: true, interactionId: name });
      assert.equal("combobox", ui.input.getAttribute("role"));
      assert.equal("vomnibar-completions", ui.input.getAttribute("aria-controls"));
      assert.equal("false", ui.input.getAttribute("aria-expanded"));
      assert.isFalse(ui.dispositionLabel.hidden);
      assert.equal(document.activeElement, ui.input);
    }
    await ui.activate({ query: "中文目标", keyword: "g", interactionId: "keyword" });
    assert.equal(
      "g 中文目标",
      sent.filter((message) => message.handler === "filterCompletions").at(-1).query,
    );
    assert.equal("browser-toolbox", ui.implementation);
  });
  should("连续输入只显示最后一次结果，隐藏后迟到回包不重新聚焦", async () => {
    await ui.activate({ interactionId: "active" });
    const a = deferred(), b = deferred();
    api.runtime.sendMessage = (message) =>
      message.handler === "filterCompletions"
        ? message.query === "first" ? a.promise : b.promise
        : Promise.resolve();
    ui.input.value = "first";
    const first = ui.update();
    ui.input.value = "second";
    const second = ui.update();
    b.resolve([item({ title: "second" })]);
    await second;
    a.resolve([item({ title: "first" })]);
    await first;
    assert.equal("second", ui.completions[0].title);
    const late = deferred();
    api.runtime.sendMessage = (message) =>
      message.handler === "filterCompletions" ? late.promise : Promise.resolve();
    const pending = ui.update();
    ui.hide();
    late.resolve([item({ title: "late" })]);
    await pending;
    await tick();
    assert.equal([], ui.completions);
    assert.isFalse(ui.active);
    assert.equal("active", posted[0].interactionId);
    assert.isFalse(document.activeElement === ui.input);
  });
  should("IME候选Esc和Enter以及229不吞掉，普通Esc异步退出", async () => {
    await ui.activate({ interactionId: "ime" });
    for (
      const event of [
        key({ key: "Escape", isComposing: true }),
        key({ type: "keypress", key: "Enter", isComposing: true }),
        key({ key: "Escape", keyCode: 229 }),
      ]
    ) {
      ui.onKeyEvent(event);
      assert.isFalse(event.prevented);
      assert.isTrue(ui.active);
    }
    const event = key({ key: "Escape" });
    ui.onKeyEvent(event);
    await tick();
    assert.isTrue(event.prevented);
    assert.isTrue(event.stopped);
    assert.isFalse(ui.active);
    assert.equal([{ name: "hide", interactionId: "ime" }], posted);
  });
  should("Tab/上下键及ctrl-enter编辑URL维持选中和aria", async () => {
    results = [item(), item({ url: "https://synthetic.invalid/beta" })];
    await ui.activate({ query: "alpha", interactionId: "selection" });
    ui.onKeyEvent(key({ key: "Tab" }));
    assert.equal(0, ui.selection);
    assert.equal("vomnibar-completion-0", ui.input.getAttribute("aria-activedescendant"));
    ui.onKeyEvent(key({ key: "ArrowDown" }));
    assert.equal(1, ui.selection);
    ui.onKeyEvent(key({ type: "keypress", key: "Enter", ctrlKey: true }));
    assert.equal("https://synthetic.invalid/beta", ui.input.value);
    assert.equal(0, sent.filter((message) => message.handler.startsWith("openUrl")).length);
    ui.onKeyEvent(key({ key: "ArrowUp" }));
    assert.equal(0, ui.selection);
    assert.equal("true", ui.list.children[0].getAttribute("aria-selected"));
  });
  should("新标签仅在对应hidden之后委托一次，界面不直接调用导航API", async () => {
    results = [item()];
    await ui.activate({ newTab: true, selectFirst: true, interactionId: "once" });
    await ui.submit(key({ key: "Enter" }));
    await ui.submit(key({ key: "Enter" }));
    assert.equal(0, sent.filter((message) => message.handler.startsWith("openUrl")).length);
    ui.onHidden({ interactionId: "wrong" });
    await tick();
    assert.equal(0, sent.filter((message) => message.handler.startsWith("openUrl")).length);
    ui.onHidden({ interactionId: "once" });
    ui.onHidden({ interactionId: "once" });
    await tick();
    assert.equal(
      [{
        name: "vomnibarInteractionFinished",
        interactionId: "once",
        submission: { handler: "openUrlInNewTab", url: item().url },
      }],
      posted.filter((message) => message.name === "vomnibarInteractionFinished"),
    );
    assert.equal(0, sent.filter((message) => message.handler.startsWith("openUrl")).length);
  });
  should("新激活废弃旧hidden动作，选择标签调用既有Native动作", async () => {
    results = [item()];
    await ui.activate({ selectFirst: true, interactionId: "old" });
    await ui.submit(key({ key: "Enter" }));
    results = [item({ description: "tab", tabId: 23 })];
    await ui.activate({ completer: "tabs", selectFirst: true, interactionId: "new" });
    ui.onHidden({ interactionId: "old" });
    await tick();
    assert.isTrue(ui.active);
    await ui.submit(key({ key: "Enter" }));
    ui.onHidden({ interactionId: "new" });
    await tick();
    assert.equal(
      [{ handler: "selectSpecificTab", id: 23 }],
      posted.filter((message) => message.submission?.handler === "selectSpecificTab").map((
        message,
      ) => message.submission),
    );
    assert.equal(0, sent.filter((message) => message.handler.startsWith("openUrl")).length);
  });
  should("空查询不提交，普通文本搜索及URL提交区分新标签", async () => {
    await ui.activate({ interactionId: "empty" });
    await ui.submit(key({ key: "Enter" }));
    assert.isTrue(ui.active);
    ui.input.value = "中文目标";
    await ui.submit(key({ key: "Enter", shiftKey: true }));
    ui.onHidden({ interactionId: "empty" });
    await tick();
    assert.equal(
      [{ handler: "launchSearchQuery", query: "中文目标", openInNewTab: true }],
      posted.filter((message) => message.submission?.handler === "launchSearchQuery").map((
        message,
      ) => message.submission),
    );
    await ui.activate({ query: "https://synthetic.invalid/typed", interactionId: "url" });
    await ui.submit(key({ key: "Enter" }));
    ui.onHidden({ interactionId: "url" });
    await tick();
    assert.equal(
      "https://synthetic.invalid/typed",
      posted.find((message) => message.submission?.handler === "openUrlInCurrentTab").submission
        .url,
    );
  });
  should("search建议可编辑，返回primary提交当前输入；bookmarklet不能强制新标签", async () => {
    results = [
      item({
        isCustomSearch: true,
        isPrimarySuggestion: true,
        autoSelect: true,
        searchUrl: "https://synthetic.invalid/search?q=%s",
      }),
      item({ insertText: "alpha suggestion", isCustomSearch: true }),
    ];
    await ui.activate({ query: "alpha", keyword: "g", interactionId: "search" });
    ui.onKeyEvent(key({ key: "ArrowDown" }));
    assert.equal("alpha suggestion", ui.input.value);
    ui.onKeyEvent(key({ key: "ArrowUp" }));
    assert.equal("alpha", ui.input.value);
    ui.input.value = "edited value";
    await ui.submit(key({ key: "Enter" }));
    ui.onHidden({ interactionId: "search" });
    await tick();
    assert.equal(
      UrlUtils.createSearchUrl("edited value", "https://synthetic.invalid/search?q=%s"),
      posted.find((message) => message.submission?.handler === "openUrlInCurrentTab").submission
        .url,
    );
    results = [item({ url: "javascript:void(0)" })];
    await ui.activate({ newTab: true, selectFirst: true, interactionId: "bookmarklet" });
    await ui.submit(key({ key: "Enter" }));
    ui.onHidden({ interactionId: "bookmarklet" });
    await tick();
    assert.equal(
      "openUrlInCurrentTab",
      posted.filter((message) => message.submission?.handler.startsWith("openUrl")).at(-1)
        .submission.handler,
    );
  });
  should("未选中primary时仍提交当前页，并且等待对应hidden后才委托", async () => {
    results = [
      item({
        isCustomSearch: true,
        isPrimarySuggestion: true,
        searchUrl: "https://synthetic.invalid/search?q=%s",
      }),
    ];
    await ui.activate({ query: "中文目标", newTab: true, interactionId: "unselected" });
    ui.selection = -1;
    await ui.submit(key({ key: "Enter" }));
    assert.equal([], posted.filter((message) => message.submission));
    ui.onHidden({ interactionId: "unselected" });
    await tick();
    assert.equal({
      handler: "openUrlInCurrentTab",
      url: UrlUtils.createSearchUrl("中文目标", results[0].searchUrl),
    }, posted.find((message) => message.submission).submission);
    assert.equal([], sent.filter((message) => message.handler.startsWith("openUrl")));
  });
  should("关键字退格还原，ShiftDelete不删数据，销毁移除7个监听器", async () => {
    await ui.activate({ query: "g alpha", interactionId: "keywords" });
    ui.onInput();
    await tick();
    assert.equal("alpha", ui.input.value);
    ui.input.selectionStart = ui.input.selectionEnd = 0;
    ui.onKeyEvent(key({ key: "Backspace" }));
    assert.equal("galpha", ui.input.value);
    const event = key({ key: "Delete", shiftKey: true });
    ui.onKeyEvent(event);
    assert.isTrue(event.prevented);
    assert.equal(7, ui.resources.counts().listener);
    ui.destroy();
    assert.equal({}, ui.resources.counts());
    const before = sent.length;
    ui.input.dispatchEvent(new window.Event("input"));
    assert.equal(before, sent.length);
  });
  should("异步URL判断不能在后一次激活后提交旧输入", async () => {
    const pending = deferred();
    stub(UrlUtils, "isUrl", () => pending.promise);
    await ui.activate({ query: "https://synthetic.invalid/old", interactionId: "old-url" });
    const submit = ui.submit(key({ key: "Enter" }));
    await ui.activate({ interactionId: "new-url" });
    pending.resolve(true);
    await submit;
    await tick();
    assert.isTrue(ui.active);
    assert.equal(0, posted.length);
    assert.equal(0, sent.filter((message) => message.handler.startsWith("openUrl")).length);
  });
  should("后台读取失败移除旧可提交候选，保留文字并允许恢复查询", async () => {
    results = [item({ title: "old" })];
    await ui.activate({ completer: "bookmarks", selectFirst: true, interactionId: "read-error" });
    api.runtime.sendMessage = async (message) =>
      message.handler === "filterCompletions"
        ? { ok: false, code: "COMPLETIONS_UNAVAILABLE" }
        : undefined;
    ui.input.value = "中文新查询";
    await ui.update();
    assert.equal([], ui.completions);
    assert.equal("中文新查询", ui.input.value);
    assert.equal("COMPLETIONS_UNAVAILABLE", ui.lastErrorCode);
    assert.equal("false", ui.input.getAttribute("aria-expanded"));
    assert.equal(null, ui.input.getAttribute("aria-activedescendant"));
    assert.isTrue(ui.active);
    api.runtime.sendMessage = async (message) =>
      message.handler === "filterCompletions" ? [item({ title: "recovered" })] : undefined;
    await ui.update();
    assert.equal("recovered", ui.completions[0].title);
    assert.equal(null, ui.lastErrorCode);
  });
  should("隐藏确认只委托一次数据动作，旧确认不能撤销新激活", async () => {
    results = [item()];
    await ui.activate({ selectFirst: true, interactionId: "pending-action" });
    await ui.submit(key({ key: "Enter" }));
    ui.onHidden({ interactionId: "pending-action" });
    ui.onHidden({ interactionId: "pending-action" });
    await tick();
    assert.equal([], sent.filter((message) => message.handler.startsWith("openUrl")));
    assert.equal(
      [{
        name: "vomnibarInteractionFinished",
        interactionId: "pending-action",
        submission: { handler: "openUrlInCurrentTab", url: item().url },
      }],
      posted.filter((message) => message.name === "vomnibarInteractionFinished"),
    );
    await ui.activate({ interactionId: "new" });
    ui.onHidden({ interactionId: "pending-action" });
    await tick();
    assert.isTrue(ui.active);
    assert.equal(
      1,
      posted.filter((message) => message.name === "vomnibarInteractionFinished").length,
    );
  });
  should("隐藏确认后立刻重新激活，不执行排队的旧导航也不释放新组件", async () => {
    results = [item()];
    await ui.activate({ selectFirst: true, interactionId: "old" });
    await ui.submit(key({ key: "Enter" }));
    ui.onHidden({ interactionId: "old" });
    const activate = ui.activate({ interactionId: "new" });
    await activate;
    await tick();
    assert.equal([], sent.filter((message) => message.handler.startsWith("openUrl")));
    assert.equal([], posted.filter((message) => message.name === "vomnibarInteractionFinished"));
    assert.isTrue(ui.active);
  });
});

context("独立查找栏组件退出与准备竞态", () => {
  let controller, resources, components, submissions;
  setup(() => {
    components = [];
    submissions = [];
    stub(globalThis, "BrowserToolboxRuntimeHostInstance", {
      state: "active",
      runtimeEpoch: 1,
      interactionEpoch: 0,
      context: { documentId: "synthetic-owner" },
      plan: { moduleImplementations: { vomnibar: "browser-toolbox" } },
    });
    stub(globalThis, "Vomnibar", { vomnibarUI: null });
    stub(globalThis, "HelpDialog", { abort() {} });
    stub(
      globalThis,
      "UIComponent",
      class {
        constructor() {
          components.push(this);
        }
        load(_url, _className, callback) {
          this.callback = callback;
        }
        async show(message) {
          this.interactionId = message.interactionId;
          this.showing = true;
          return true;
        }
        destroy() {
          this.disposed = true;
        }
      },
    );
    resources = new BrowserToolboxRuntime.ResourceScope();
    controller = new BrowserToolboxVomnibarRuntime.Controller(
      resources,
      {
        documentId: "synthetic-owner",
      },
      () => true,
      async (message) => {
        assert.isTrue(components.at(-1).disposed);
        submissions.push(message);
        return { ok: true };
      },
    );
  });
  teardown(() => resources.dispose());
  should("自然退出释放iframe和诊断门面，旧完成消息不能销毁新一次组件", async () => {
    await controller.open(0, { completer: "omni" });
    const first = components[0];
    first.showing = false;
    const event = {
      data: { name: "vomnibarInteractionFinished", interactionId: first.interactionId },
    };
    first.callback(event);
    assert.isTrue(first.disposed);
    assert.equal(null, Vomnibar.vomnibarUI);
    await controller.open(0, { completer: "bookmarks" });
    first.callback(event);
    assert.equal(components[1], controller.ui);
    assert.isFalse(components[1].disposed);
  });
  should("准备期间取消的组件被释放，早到的旧退出消息不影响等待中的新激活", async () => {
    await controller.open(0, { completer: "omni" });
    const component = components[0], oldId = component.interactionId;
    const pending = deferred();
    component.showing = false;
    component.show = () => pending.promise;
    const opening = controller.open(0, { completer: "omni" });
    component.callback({ data: { name: "vomnibarInteractionFinished", interactionId: oldId } });
    assert.isFalse(component.disposed);
    pending.resolve(false);
    assert.isFalse(await opening);
    assert.isTrue(component.disposed);
    assert.equal(null, controller.ui);
  });
  should("对应hidden先同步销毁组件再以父文档身份唯一提交，失败不重发", async () => {
    await controller.open(0, { completer: "omni" });
    const component = components[0];
    component.showing = false;
    const event = {
      data: {
        name: "vomnibarInteractionFinished",
        interactionId: component.interactionId,
        submission: { handler: "openUrlInCurrentTab", url: item().url },
      },
    };
    controller.send = async (message) => {
      assert.isTrue(component.disposed);
      assert.equal(null, controller.ui);
      submissions.push(message);
      throw new Error("lost-response");
    };
    component.callback(event);
    assert.isTrue(component.disposed);
    component.callback(event);
    await tick();
    assert.equal(1, submissions.length);
    assert.equal("submitVomnibar", submissions[0].action);
    assert.equal(
      { documentId: "synthetic-owner", runtimeEpoch: 1, incognito: false },
      submissions[0].identity,
    );
    assert.equal("RESULT_UNKNOWN", controller.lastErrorCode);
  });
  should("无效动作、旧代次、维护暂停及刚重开的组件都不能提交", async () => {
    const host = BrowserToolboxRuntimeHostInstance;
    for (const mode of ["payload", "epoch", "paused", "reopen", "showing"]) {
      host.runtimeEpoch = 1;
      host.maintenancePaused = false;
      await controller.open(0, { completer: "omni" });
      const component = controller.ui;
      component.showing = mode === "showing";
      if (mode === "epoch") host.runtimeEpoch++;
      if (mode === "paused") host.maintenancePaused = true;
      component.callback({
        data: {
          name: "vomnibarInteractionFinished",
          interactionId: component.interactionId,
          submission: mode === "payload"
            ? { handler: "removeTab" }
            : { handler: "openUrlInCurrentTab", url: item().url },
        },
      });
      if (mode === "reopen") await controller.open(0, { completer: "omni" });
      await tick();
      assert.equal([], submissions);
      controller.releaseUi();
    }
  });
});

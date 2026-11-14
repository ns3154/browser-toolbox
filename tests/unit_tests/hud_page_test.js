import * as testHelper from "./test_helper.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import * as hudPage from "../../pages/hud_page.js";
import * as UIComponentMessenger from "../../pages/ui_component_messenger.js";

function newKeyEvent(properties) {
  return Object.assign(
    {
      type: "keydown",
      key: "a",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      stopImmediatePropagation: function () {},
      preventDefault: function () {},
    },
    properties,
  );
}

context("hud page", () => {
  let ui;
  setup(async () => {
    stub(Utils, "isFirefox", () => false);
    await testHelper.jsdomStub("pages/hud_page.html");
    // Make Utils.setTimeout synchronous so that the tests easier to deal with.
    stub(Utils, "setTimeout", (timeout, fn) => {
      fn();
    });
  });

  teardown(() => {
    UIComponentMessenger.unregister();
  });

  should("find mode hides when escape is pressed", async () => {
    let message;
    const stubPort = {
      postMessage: (event) => {
        message = event;
      },
    };
    await UIComponentMessenger.registerPortWithOwnerPage({
      data: (await chrome.storage.session.get("vimiumSecret")).vimiumSecret,
      ports: [stubPort],
    });
    hudPage.handlers.showFindMode();
    await hudPage.onKeyEvent(newKeyEvent({ key: "Escape" }));
    assert.equal("hideFindMode", message.name);
    assert.equal("Escape", message.exitKey);
    hudPage.onFindKeyup({ key: "j" });
    assert.equal("hideFindMode", message.name);
    hudPage.onFindKeyup({ key: "Escape" });
    assert.equal("findKeyReleased", message.name);
    assert.equal("Escape", message.key);
  });
  should("兼容复制与粘贴返回对应借用回执，保留空格转换", async () => {
    const messages = [], writes = [];
    let focusCalls = 0, parentFocusCalls = 0;
    await UIComponentMessenger.registerPortWithOwnerPage({
      data: (await chrome.storage.session.get("vimiumSecret")).vimiumSecret,
      ports: [{
        postMessage: (message) => {
          messages.push(message);
          if (message.name === "clipboardFocus") {
            hudPage.handlers.clipboardFocusResult({
              clipboardRequestId: message.clipboardRequestId,
              ok: true,
            });
          }
        },
      }],
    });
    stub(document, "hasFocus", () => true);
    stub(globalThis, "focus", () => focusCalls++);
    stub(globalThis, "parent", { focus: () => parentFocusCalls++ });
    stub(navigator, "clipboard", {
      writeText: async (text) => writes.push(text),
      readText: async () => "合成\xa0粘贴",
    });
    await hudPage.handlers.copyToClipboard({ data: "合成\xa0复制", clipboardRequestId: "copy" });
    await hudPage.handlers.pasteFromClipboard({ clipboardRequestId: "paste" });
    assert.equal(0, focusCalls + parentFocusCalls);
    assert.equal(["合成 复制"], writes);
    assert.equal([{ name: "clipboardComplete", clipboardRequestId: "copy", ok: true }],
      messages.filter((message) => message.name === "clipboardComplete"));
    assert.equal([{ name: "pasteResponse", clipboardRequestId: "paste", data: "合成 粘贴", ok: true }],
      messages.filter((message) => message.name === "pasteResponse"));
  });
  should("兼容剪贴板拒绝和不安全上下文也结束借用，不伪造粘贴结果", async () => {
    const messages = [];
    await UIComponentMessenger.registerPortWithOwnerPage({
      data: (await chrome.storage.session.get("vimiumSecret")).vimiumSecret,
      ports: [{
        postMessage: (message) => {
          messages.push(message);
          if (message.name === "clipboardFocus") {
            hudPage.handlers.clipboardFocusResult({
              clipboardRequestId: message.clipboardRequestId,
              ok: true,
            });
          }
        },
      }],
    });
    stub(document, "hasFocus", () => true);
    stub(globalThis, "focus", () => {});
    stub(globalThis, "parent", { focus() {} });
    stub(navigator, "clipboard", { readText: async () => { throw new Error("denied"); } });
    await hudPage.handlers.pasteFromClipboard({ clipboardRequestId: "denied" });
    stub(navigator, "clipboard", undefined);
    await hudPage.handlers.copyToClipboard({ data: "合成复制", clipboardRequestId: "unavailable" });
    assert.equal(0, messages.filter((message) => message.name === "pasteResponse").length);
    assert.equal(["denied", "unavailable"], messages.filter((message) =>
      message.name === "clipboardComplete" && message.ok === false
    ).map((message) => message.clipboardRequestId));
    assert.equal(1, messages.filter((message) => message.name === "showClipboardUnavailableMessage").length);
  });
  should("等待期间授权会话失效，兼容剪贴板不执行或向新会话回包", async () => {
    const messages = [], writes = [];
    let complete;
    await UIComponentMessenger.registerPortWithOwnerPage({
      data: (await chrome.storage.session.get("vimiumSecret")).vimiumSecret,
      ports: [{ postMessage: (message) => messages.push(message) }],
    });
    stub(Utils, "setTimeout", (timeout, callback) => complete = callback);
    stub(navigator, "clipboard", { writeText: async (text) => writes.push(text) });
    const copying = hudPage.handlers.copyToClipboard({ data: "不应复制", clipboardRequestId: "stale" });
    stub(BrowserToolboxUIAuthorization, "session", { planVersion: 1 });
    complete();
    await copying;
    assert.equal([], writes);
    assert.equal([], messages);
  });
  should("HUD按已登记方案的模块成员选择Find与复制，方案6继承依赖且未知方案拒绝", async () => {
    const plans = [
      "COMPAT_PLAN",
      "INPUT_CANARY_PLAN",
      "FIND_CANARY_PLAN",
      "VISUAL_CANARY_PLAN",
      "HINTS_CANARY_PLAN",
      "VOMNIBAR_CANARY_PLAN",
    ].map((name) => BrowserToolboxRuntimePlans[name]);
    stub(globalThis, "BrowserToolboxRuntimePlans", {
      ...BrowserToolboxRuntimePlans,
      allowed: plans,
    });
    const messages = [], copied = [];
    await UIComponentMessenger.registerPortWithOwnerPage({
      data: (await chrome.storage.session.get("vimiumSecret")).vimiumSecret,
      ports: [{
        postMessage: (message) => {
          messages.push(message);
          if (message.name === "clipboardFocus") {
            hudPage.handlers.clipboardFocusResult({
              clipboardRequestId: message.clipboardRequestId,
              ok: true,
            });
          }
        },
      }],
    });
    stub(document, "hasFocus", () => true);
    stub(navigator, "clipboard", { writeText: async (text) => copied.push(text) });
    let childFocusCalls = 0, parentFocusCalls = 0;
    stub(globalThis, "focus", () => childFocusCalls++);
    stub(globalThis, "parent", { focus: () => parentFocusCalls++ });
    stub(globalThis, "addEventListener", () => {});
    stub(globalThis, "removeEventListener", () => {});
    for (const planVersion of [1, 2, 3, 4, 5, 6, 7]) {
      stub(BrowserToolboxUIAuthorization, "session", { planVersion });
      assert.equal([3, 4, 5, 6].includes(planVersion), hudPage.usesIndependentFind());
      const before = copied.length;
      await hudPage.handlers.copyToClipboardWithResult({
        copyRequestId: `synthetic-copy-${planVersion}`,
        data: "中文目标",
      });
      assert.equal([4, 5, 6].includes(planVersion) ? before + 1 : before, copied.length);
    }
    assert.equal(0, childFocusCalls + parentFocusCalls);
    assert.equal(
      3,
      messages.filter((message) => message.name === "copyToClipboardResult" && message.ok).length,
    );
  });
  should("兼容HUD剪贴板等待父授焦与原生焦点确认，拒绝或隐藏时取消写入且普通提示不中断复制", async () => {
    const plans = ["COMPAT_PLAN", "HINTS_CANARY_PLAN", "VOMNIBAR_CANARY_PLAN"].map((name) =>
      BrowserToolboxRuntimePlans[name]
    );
    stub(globalThis, "BrowserToolboxRuntimePlans", {
      ...BrowserToolboxRuntimePlans,
      allowed: plans,
    });
    stub(BrowserToolboxUIAuthorization, "session", { planVersion: 6 });
    const messages = [], writes = [];
    let focused = false, allowFocus = true, childFocusCalls = 0, parentFocusCalls = 0;
    await UIComponentMessenger.registerPortWithOwnerPage({
      data: (await chrome.storage.session.get("vimiumSecret")).vimiumSecret,
      ports: [{
        postMessage: (message) => {
          messages.push(message);
          if (message.name === "clipboardFocus" && allowFocus !== null) {
            hudPage.handlers.clipboardFocusResult({
              clipboardRequestId: message.clipboardRequestId,
              ok: allowFocus,
            });
          }
        },
      }],
    });
    stub(document, "hasFocus", () => focused);
    stub(globalThis, "focus", () => childFocusCalls++);
    stub(globalThis, "parent", { focus: () => parentFocusCalls++ });
    stub(navigator, "clipboard", { writeText: async (text) => writes.push(text) });

    // 授焦回执先到、原生焦点稍后到达时，必须等原生 focus 事件后再写入，且期间普通 show 不取消任务。
    const delayed = hudPage.handlers.copyToClipboardWithResult({
      copyRequestId: "copy-native-focus",
      data: "合成链接",
    });
    await Promise.resolve();
    hudPage.handlers.show({ text: "Yanked ..." });
    assert.equal(0, writes.length);
    focused = true;
    globalThis.dispatchEvent(new Event("focus"));
    await delayed;
    assert.equal(["合成链接"], writes);
    assert.equal(0, childFocusCalls + parentFocusCalls);
    const tail = messages.slice(-2);
    assert.equal(
      [
        { name: "unfocusIfFocused", clipboardRequestId: "copy-native-focus" },
        { name: "copyToClipboardResult", copyRequestId: "copy-native-focus", ok: true },
      ],
      tail,
    );

    // 父框架拒绝授焦时不得写入，也不发 unfocusIfFocused。
    messages.length = 0;
    allowFocus = false;
    await hudPage.handlers.copyToClipboardWithResult({
      copyRequestId: "copy-denied",
      data: "不应写入",
    });
    assert.equal(["合成链接"], writes);
    assert.equal(0, messages.filter((m) => m.name === "unfocusIfFocused").length);
    assert.equal(
      [{ name: "copyToClipboardResult", copyRequestId: "copy-denied", ok: false }],
      messages.filter((m) => m.name === "copyToClipboardResult"),
    );

    // 等待授焦期间组件隐藏时立即结算失败，迟到回执不能复活写入。
    messages.length = 0;
    allowFocus = null;
    const hiddenCopy = hudPage.handlers.copyToClipboard({
      clipboardRequestId: "copy-hidden",
      data: "隐藏取消",
    });
    await Promise.resolve();
    hudPage.handlers.hidden();
    await hiddenCopy;
    hudPage.handlers.clipboardFocusResult({ clipboardRequestId: "copy-hidden", ok: true });
    assert.equal(["合成链接"], writes);
    assert.equal(
      [{ name: "clipboardComplete", clipboardRequestId: "copy-hidden", ok: false }],
      messages.filter((m) => m.name === "clipboardComplete"),
    );
  });
  should("输入法候选 Esc 与 229 事件不退出查找或发送查询历史动作", async () => {
    const messages = [];
    await UIComponentMessenger.registerPortWithOwnerPage({
      data: (await chrome.storage.session.get("vimiumSecret")).vimiumSecret,
      ports: [{ postMessage: (message) => messages.push(message) }],
    });
    hudPage.handlers.showFindMode();
    for (
      const event of [
        { key: "Escape", isComposing: true },
        { key: "Escape", keyCode: 229 },
        { key: "ArrowUp", isComposing: true },
        { key: "Enter", type: "keypress", isComposing: true },
      ]
    ) await hudPage.onKeyEvent(newKeyEvent(event));
    assert.equal([], messages);
    assert.isTrue(document.getElementById("hud-find-input") !== null);
  });
});

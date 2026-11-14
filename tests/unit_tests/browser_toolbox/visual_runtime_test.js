// SPDX-License-Identifier: GPL-3.0-or-later
// 状态与资源测试不替代原生 Selection.modify、剪贴板和 CFT 旧新按键对照。
import { jsdomStub } from "../test_helper.js";
import "../../../lib/handler_stack.js";
import "../../../content_scripts/mode.js";
import "../../../content_scripts/mode_key_handler.js";
import "../../../lib/browser_toolbox/runtime_host.js";
import "../../../lib/browser_toolbox/runtime_plan.js";
import "../../../content_scripts/browser_toolbox/input_runtime.js";
import "../../../lib/browser_toolbox/visual_word_characters.js";
import "../../../content_scripts/browser_toolbox/visual_runtime.js";

const { SelectionNavigator, VisualMode, Controller, keyMapping } = BrowserToolboxVisualRuntime;
context("独立选择契约", () => {
  should("直接使用公共 Mode，不继承旧键处理或选择算法", () => {
    assert.isTrue(VisualMode.prototype instanceof Mode);
    assert.isFalse(VisualMode.prototype instanceof KeyHandlerMode);
    assert.equal(undefined, SelectionNavigator.prototype.runMovement);
  });
  should("零映射、词句实体、gg 和复杂键均由独立键序列处理", () => {
    const sequence = new BrowserToolboxInputRuntime.KeySequence(keyMapping());
    assert.equal("0", sequence.accept("0").entry.command);
    for (const key of "12g") sequence.accept(key);
    assert.equal({ handled: true, entry: { command: "gg" }, count: 12 }, sequence.accept("g"));
    sequence.accept("a");
    assert.equal("aw", sequence.accept("w").entry.command);
    assert.equal("<c-e>", sequence.accept("<c-e>").entry.command);
    assert.equal("W", sequence.accept("W").entry.command);
  });
  should("词字符沿用冻结的 BMP 范围，标点与 emoji 不当作字母", () => {
    for (const value of ["A", "z", "9", "_", "中", "Ä", "あ", "한", "Ж"]) {
      assert.isTrue(BrowserToolboxVisualWordCharacter(value));
    }
    for (const value of ["", undefined, " ", ",", "😀", "\n", "\u0301"]) {
      assert.isFalse(BrowserToolboxVisualWordCharacter(value));
    }
  });
  should("默认包拒绝方案 4 及任意模块混合", () => {
    assert.isFalse(BrowserToolboxRuntimePlans.COMPILED_VISUAL_CANARY);
    assert.equal(
      undefined,
      BrowserToolboxRuntimePlans.canonical(BrowserToolboxRuntimePlans.VISUAL_CANARY_PLAN),
    );
    assert.equal(
      undefined,
      BrowserToolboxRuntimePlans.canonical({
        ...BrowserToolboxRuntimePlans.COMPAT_PLAN,
        moduleImplementations: {
          ...BrowserToolboxRuntimePlans.COMPAT_PLAN.moduleImplementations,
          visual: "browser-toolbox",
        },
      }),
    );
  });
});

context("选择端点与控件方向", () => {
  setup(async () => {
    await jsdomStub("pages/hud_page.html");
    document.body.innerHTML =
      '<p id="selection">alpha beta</p><textarea id="control">alpha beta</textarea>';
    stub(globalThis, "getSelection", () => document.getSelection());
    stub(globalThis, "Range", document.defaultView.Range);
    stub(globalThis, "Node", document.defaultView.Node);
  });
  should("没有原生范围时方向反转不创建新选择或抛错", () => {
    const navigator = new SelectionNavigator();
    navigator.reverse();
    assert.equal("forward", navigator.direction());
    assert.equal(0, getSelection().rangeCount);
  });
  should("DOM 反向选择不靠移动探测，恢复保持两个端点", () => {
    const node = document.querySelector("#selection").firstChild;
    getSelection().setBaseAndExtent(node, 6, node, 1);
    const navigator = new SelectionNavigator();
    assert.equal("backward", navigator.direction());
    const state = navigator.snapshot();
    navigator.reverse();
    assert.equal("forward", navigator.direction());
    assert.equal(1, getSelection().anchorOffset);
    navigator.restore(state);
    assert.equal(6, getSelection().anchorOffset);
    assert.equal(1, getSelection().focusOffset);
    navigator.collapse("focus");
    assert.equal(1, getSelection().anchorOffset);
  });
  should("textarea 反向选区的锚点与焦点独立于文档范围", () => {
    const control = document.querySelector("#control");
    control.focus();
    control.setSelectionRange(1, 6, "backward");
    const navigator = new SelectionNavigator();
    assert.equal("backward", navigator.direction());
    const state = navigator.snapshot();
    navigator.reverse();
    assert.equal("forward", control.selectionDirection);
    navigator.restore(state);
    // jsdom 不将 textarea 内部选区投影到文档 Selection；空原生范围不能覆盖其内部游标。
    navigator.collapse("anchor");
    assert.equal(1, control.selectionStart);
    assert.equal(6, control.selectionEnd);
  });
});

context("复制生命周期与权限结果", () => {
  let root, controller, host, sent, released;
  setup(() => {
    root = new BrowserToolboxRuntime.ResourceScope();
    host = {
      state: "active",
      runtimeEpoch: 4,
      context: { documentId: "synthetic-visual-document" },
    };
    stub(globalThis, "BrowserToolboxRuntimeHostInstance", host);
    controller = new Controller(root, host.context);
    stub(globalThis, "BrowserToolboxVisualControllerInstance", controller);
    sent = [];
    released = [];
    stub(globalThis, "HUD", {
      init: async () => true,
      retainClipboard: (id) => ({ release() { released.push(id); } }),
      hudUI: { iframePort: Promise.resolve({}), postMessage: (message) => sent.push(message) },
    });
  });
  teardown(() => root.dispose());
  should("无选区和失效代次拒绝复制且不创建计时器", async () => {
    assert.equal({ ok: false, code: "NO_MATCHING_ELEMENT" }, await controller.copy(""));
    host.runtimeEpoch++;
    assert.equal({ ok: false, code: "CANCELLED" }, await controller.copy("合成文字"));
    assert.equal({}, controller.resources.counts());
    assert.equal([], released);
  });
  should("错误请求回包不能完成复制，正确拒绝清理计时器", async () => {
    const pending = controller.copy("合成文字");
    controller.completeCopy({ copyRequestId: "other-request", ok: true });
    assert.equal(1, controller.pendingCopies.size);
    const requestId = [...controller.pendingCopies.keys()][0];
    controller.completeCopy({ copyRequestId: requestId, ok: false });
    assert.equal({ ok: false, code: "CLIPBOARD_DENIED" }, await pending);
    assert.equal(0, controller.pendingCopies.size);
    assert.equal({}, controller.resources.counts());
    controller.completeCopy({ copyRequestId: requestId, ok: true });
    assert.equal([requestId], released);
  });
  should("注销结束未完成复制，晚到成功不能改写取消结果", async () => {
    const pending = controller.copy("合成文字");
    const requestId = [...controller.pendingCopies.keys()][0];
    root.dispose();
    controller.completeCopy({ copyRequestId: requestId, ok: true });
    assert.equal({ ok: false, code: "CANCELLED" }, await pending);
    assert.equal(0, controller.pendingCopies.size);
    assert.equal({}, controller.resources.counts());
    assert.equal([requestId], released);
  });
  should("复制请求等待HUD样式就绪后再投递消息，避免冷启动隐藏状态下请求焦点", async () => {
    let resolveCss;
    HUD.hudUI.cssReady = new Promise((resolve) => resolveCss = resolve);
    const pending = controller.copy("冷启动复制");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal([], sent);
    resolveCss();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(1, sent.length);
    controller.completeCopy({ copyRequestId: sent[0].copyRequestId, ok: true });
    assert.equal({ ok: true, code: "OK" }, await pending);
  });
});

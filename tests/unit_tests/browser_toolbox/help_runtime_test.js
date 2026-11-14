// SPDX-License-Identifier: GPL-3.0-or-later
// 合成事件验证取消与页面语义，不作为系统输入法或人工平台证据。
import "../test_helper.js";
import "../../../content_scripts/browser_toolbox/help_runtime.js";
import { HelpController } from "../../../pages/browser_toolbox/help_controller.js";
import { JSDOM } from "jsdom";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => resolve = done);
  return { promise, resolve };
};
context("独立帮助宿主的在途取消", () => {
  let help, ui, component, shows;
  setup(() => {
    shows = [];
    component = {
      showing: false,
      load() {},
      async show(message, options) {
        shows.push({ message, options });
        this.showing = true;
        return true;
      },
      hide() {
        this.showing = false;
        return true;
      },
      destroy() {
        this.disposed = true;
      },
    };
    ui = { valid: () => true, context: { frameId: 0 }, createComponent: () => component };
    help = new BrowserToolboxHelpRuntime.Controller(ui, async () => ({ stateAvailable: true }));
  });
  should("第二次切换取消摘要等待，迟到结果不能重新显示", async () => {
    const summary = deferred();
    help.summary = () => summary.promise;
    const first = help.toggle({ sourceFrameId: 7 });
    await help.toggle();
    summary.resolve({ stateAvailable: true });
    assert.isFalse(await first);
    assert.equal(0, shows.length);
    assert.isFalse(help.showing);
  });
  should("宿主销毁或代次失效时取消摘要后的显示", async () => {
    const summary = deferred();
    help.summary = () => summary.promise;
    const first = help.toggle();
    help.destroy();
    summary.resolve({});
    assert.isFalse(await first);
    assert.isTrue(component.disposed);
    assert.equal(0, shows.length);
  });
  should("摘要读取失败仍显示静态帮助，携带原始来源frame", async () => {
    help.summary = () => {
      throw new Error("unavailable");
    };
    assert.isTrue(await help.toggle({ sourceFrameId: 7 }));
    assert.equal(false, shows[0].message.browserToolbox.stateAvailable);
    assert.equal(7, shows[0].options.sourceFrameId);
    assert.isTrue(help.showing);
    await help.toggle();
    assert.isFalse(help.showing);
  });
  should("100次开关复用组件且每次显示都有不同交互身份", async () => {
    let created = 0;
    ui.createComponent = () => {
      created++;
      return component;
    };
    for (let n = 0; n < 100; n++) {
      await help.toggle();
      await help.toggle();
    }
    assert.equal(1, created);
    assert.equal(100, new Set(shows.map((s) => s.message.interactionId)).size);
  });
});

context("独立帮助页面控制器", () => {
  let dom, controller, client, posts, mapping;
  setup(async () => {
    dom = new JSDOM(await Deno.readTextFile("pages/help_dialog_page.html"));
    posts = [];
    mapping = { reload: { "": ["<c-r>", "r"], hard: ["R"] } };
    client = {
      read: async () => ({ keyboard: { helpDialog_showAdvancedCommands: false } }),
      commit: async (input) => ({ keyboard: { ...input.legacyPatch } }),
    };
    BrowserToolboxI18n.setLocale("en");
    controller = new HelpController({
      page: dom.window,
      client,
      locale: async () => BrowserToolboxI18n.apply(dom.window.document),
      activate: () => {},
      mappings: async () => ({ commandToOptionsToKeys: mapping }),
      post: (value) => posts.push(value),
    });
  });
  teardown(() => {
    controller.destroy();
    dom.window.close();
    BrowserToolboxI18n.setLocale("auto");
  });
  const show = () =>
    controller.show({ interactionId: "current", browserToolbox: { stateAvailable: true } });
  should("按命令参数渲染、特殊键后置且不修改共享映射", async () => {
    assert.isTrue(await show());
    const rows = controller.dialogElement.querySelectorAll(".row");
    assert.equal(2, rows.length);
    assert.equal(["r", "<c-r>"], [...rows[0].querySelectorAll(".key")].map((e) => e.textContent));
    assert.equal(["<c-r>", "r"], mapping.reload[""]);
    assert.isTrue(rows[1].classList.contains("advanced"));
  });
  should("长参数仅缩略可见标签，title保留完整参数", async () => {
    mapping = { reload: { ["hard ".repeat(20)]: ["R"] } };
    await show();
    const description = controller.dialogElement.querySelector(".help-description");
    assert.isTrue(description.textContent.includes("..."));
    assert.isTrue(description.title.includes("hard ".repeat(20)));
  });
  should("隐藏使未结束的读取失效，不渲染旧会话或抢焦点", async () => {
    const read = deferred();
    client.read = () => read.promise;
    const first = show();
    await controller.handle({ name: "hidden" });
    read.resolve({ keyboard: {} });
    assert.isFalse(await first);
    assert.equal(0, controller.dialogElement.querySelectorAll(".row").length);
  });
  should("较新显示优先于先发后到的配置响应", async () => {
    const read = deferred();
    let count = 0;
    client.read = () =>
      ++count === 1
        ? read.promise
        : Promise.resolve({ keyboard: { helpDialog_showAdvancedCommands: true } });
    const first = show();
    await show();
    read.resolve({ keyboard: { helpDialog_showAdvancedCommands: false } });
    assert.isFalse(await first);
    assert.isTrue(controller.advanced);
  });
  should("高级偏好仅提交唯一字段和读取基线，拒绝并发重复写入", async () => {
    await show();
    const write = deferred();
    const inputs = [];
    client.commit = (input) => {
      inputs.push(input);
      return write.promise;
    };
    const first = controller.toggleAdvancedCommands();
    assert.isFalse(await controller.toggleAdvancedCommands());
    assert.equal([{
      baseline: { keyboard: { helpDialog_showAdvancedCommands: false } },
      legacyPatch: { helpDialog_showAdvancedCommands: true },
    }], inputs);
    write.resolve({ keyboard: { helpDialog_showAdvancedCommands: true } });
    assert.isTrue(await first);
    assert.isTrue(controller.advanced);
  });
  should("保存失败保持已保存偏好，不假报已切换", async () => {
    await show();
    client.commit = () => Promise.reject(new Error("quota"));
    assert.isFalse(await controller.toggleAdvancedCommands());
    assert.isFalse(controller.advanced);
    assert.equal("HELP_PREFERENCE_FAILED", controller.lastErrorCode);
  });
  should("配置读取失败有明确错误且不回写默认值", async () => {
    client.read = () => Promise.reject(new Error("unavailable"));
    assert.isFalse(await show());
    assert.equal("HELP_CONFIGURATION_UNAVAILABLE", controller.lastErrorCode);
    assert.isFalse(await controller.toggleAdvancedCommands());
  });
  should("本地配置语言来自权威快照，不被同步区空值覆盖", async () => {
    controller.destroy();
    client.read = async () => ({
      keyboard: {},
      toolboxSource: { value: { general: { language: "ja", browserSyncEnabled: false } } },
    });
    controller = new HelpController({
      page: dom.window,
      client,
      activate: () => {},
      mappings: async () => ({ commandToOptionsToKeys: mapping }),
      post: (value) => posts.push(value),
    });
    assert.isTrue(await show());
    assert.equal("ja", dom.window.document.documentElement.lang);
  });
  should("状态摘要和规则使用文本节点，未知模块不会进入界面", async () => {
    controller.renderSummary({
      stateAvailable: true,
      disabledModules: ["mouse", "unknown"],
      matchedRule: { matchType: "regex", pattern: "<img src=x onerror=bad()>" },
      vimiumExcluded: true,
    });
    const d = dom.window.document;
    assert.equal(0, d.querySelectorAll("#browser-toolbox-help-rule-value img").length);
    assert.isTrue(d.querySelector("#browser-toolbox-help-rule-value").textContent.includes("<img"));
    assert.isFalse(d.querySelector("#browser-toolbox-help-vimium-excluded").hidden);
  });
  should("关闭关联当前交互，销毁对称移除所有页面监听器", async () => {
    await show();
    dom.window.document.querySelector("#close").click();
    assert.equal([{ name: "hide", interactionId: "current" }], posts);
    controller.destroy();
    dom.window.document.querySelector("#close").click();
    assert.equal(1, posts.length);
    assert.equal(0, controller.removers.length);
  });
});

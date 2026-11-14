// SPDX-License-Identifier: GPL-3.0-or-later
// 先完成组件授权再选择页面算法；网页消息与地址参数不能选择运行时。
import * as messenger from "../ui_component_messenger.js";

globalThis.isVimiumHelpDialogPage = true;
const pending = [];
let controller;
let closed = false;
let ready = false;
globalThis.addEventListener("pagehide", () => {
  closed = true;
  pending.length = 0;
}, { once: true });
messenger.registerHandler((event) => {
  if (closed) return;
  if (controller && ready) return controller.handle(event.data);
  pending.push(event.data);
});
messenger.init();
const session = await BrowserToolboxUIAuthorization.ready;
const plan = BrowserToolboxRuntimePlans.allowed.find((item) =>
  item.planVersion === session?.planVersion
);
if (!closed && (!plan || session?.component !== "help")) throw new Error("INVALID_HELP_SESSION");
if (!closed && (plan.moduleImplementations.help === "browser-toolbox" ||
  plan === BrowserToolboxRuntimePlans.UI_CANARY_PLAN)) {
  const { HelpController } = await import("./help_controller.js");
  if (!closed) {
    controller = new HelpController({ post: (data) => messenger.postMessage(data) });
    globalThis.HelpDialogPage = controller;
    const { startPageRuntime } = await import("./page_runtime.js");
    try {
      if (!closed) await startPageRuntime();
    } catch (_) {
      globalThis.BrowserToolboxHelpStartupError = "PAGE_RUNTIME_FAILED";
    }
    // 启动期间按端口顺序交付；hidden同步取消先到show的异步读取，不能串行等待旧show结束。
    ready = true;
    for (const message of pending.splice(0)) controller.handle(message);
  }
} else if (!closed) {
  // 已核验的兼容方案才加载旧页面，避免先安装旧算法再替换它。
  await import("../help_dialog_page.js");
  // 动态加载可能晚于DOMContentLoaded，复用同一页面宿主补齐设置就绪及用户CSS。
  const { startPageRuntime } = await import("./page_runtime.js");
  if (!closed) await startPageRuntime();
  for (const message of pending.splice(0)) {
    if (message.name === "show") {
      HelpDialogPage.init();
      await HelpDialogPage.show(message);
    } else if (message.name === "hide") HelpDialogPage.hide();
  }
}

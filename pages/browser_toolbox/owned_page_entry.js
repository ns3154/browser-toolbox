// SPDX-License-Identifier: GPL-3.0-or-later
import "../../lib/browser_toolbox/runtime_plan.js";

async function start() {
  let independent = true;
  try {
    const plan = await BrowserToolboxRuntimePlans.select(chrome);
    independent = plan.moduleImplementations.settingsPages === "browser-toolbox" ||
      plan === BrowserToolboxRuntimePlans.UI_CANARY_PLAN;
  } catch (_) {
    // 无法核验键盘方案时，配置页面仍需可读写并可打开维护入口。
  }

  const page = location.pathname.split("/").at(-1);
  const runtime = () =>
    import("./page_runtime.js").then(({ startPageRuntime }) => startPageRuntime())
      .catch((error) => console.error("页面键盘运行时启动失败", error));

  if (independent) {
    // 页面内容与键盘分别启动，键盘宿主失效不会中断设置或说明渲染。
    void runtime();
    if (page === "options.html") {
      const { startOptionsController } = await import("./options_controller.js");
      await startOptionsController();
    } else {
      const { startDocumentation } = await import("./settings_documentation.js");
      await startDocumentation(page);
    }
  } else {
    if (page === "options.html") {
      const { startOptionsPage } = await import("../options.js");
      await startOptionsPage();
    } else if (page === "command_listing.html") {
      const { startCommandListingPage } = await import("../command_listing.js");
      await startCommandListingPage();
    } else if (page === "doc_search_completion.html") {
      const { populatePage } = await import("../doc_search_completion.js");
      populatePage();
    }
  }
}

document.addEventListener("DOMContentLoaded", start, { once: true });

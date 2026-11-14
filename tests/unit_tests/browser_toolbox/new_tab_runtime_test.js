// SPDX-License-Identifier: GPL-3.0-or-later
import "../test_helper.js";
import "../../../lib/settings.js";
import "../../../content_scripts/browser_toolbox/new_tab_runtime.js";
import { createTab } from "../../../background_scripts/browser_toolbox/new_tab_service.js";

context("方案 9 新标签生命周期", () => {
  should("每张标签和每个窗口都必须重新取得执行权", async () => {
    const effects = [];
    stub(UrlUtils, "isUrl", async (value) => value.startsWith("https://"));
    stub(UrlUtils, "convertToUrl", async (url) => url);
    stub(chrome.tabs, "create", async (options) => {
      effects.push(options);
      return { id: 42, index: options.index, windowId: options.windowId };
    });
    stub(chrome.windows, "create", async (options) => effects.push(options));
    const urls = { "https://first.invalid/": true, "https://second.invalid/": true };
    for (const window of [false, true]) {
      effects.length = 0;
      const error = new Error("STALE_RUNTIME");
      let thrown, calls = 0;
      try {
        await createTab({
          count: 2,
          tab: { id: 41, index: 2, windowId: 4 },
          registryEntry: { options: { ...urls, window } },
          executionGuard: () => {
            if (++calls > 1) throw error;
          },
        });
      } catch (failure) {
        thrown = failure;
      }
      assert.equal(error, thrown);
      assert.equal(1, effects.length);
      assert.equal(window ? Object.keys(urls) : Object.keys(urls)[0], effects[0].url);
    }
  });

  should("迟到的 DOM 初始化在导航后取消，同一文档只消费一次自动打开", async () => {
    const url = Settings.vimiumNewTabPageUrl;
    const page = { href: url };
    const host = {
      context: { frameId: 0, documentId: "新标签合成文档" },
      runtimeEpoch: 2,
      plan: { moduleImplementations: { newTab: "browser-toolbox" } },
    };
    let unblock, started, count = 0;
    const pending = new Promise((resolve) => unblock = resolve);
    const preparing = new Promise((resolve) => started = resolve);
    stub(globalThis, "location", page);
    stub(globalThis, "DomUtils", { injectUserCss() {} });
    stub(Settings, "onLoaded", async () => {});
    stub(Settings, "get", () => true);
    stub(Utils, "populateBrowserInfo", () => {
      started();
      return pending;
    });
    stub(globalThis, "BrowserToolboxVomnibarControllerInstance", {
      valid: () => true,
      open: async (_frame, _options, canShow) => {
        count++;
        assert.isTrue(canShow());
        page.href += "?navigated";
        assert.isFalse(canShow());
        page.href = url;
      },
    });
    const late = BrowserToolboxNewTabRuntime.openOnReady(host, 2);
    await preparing;
    host.runtimeEpoch++;
    unblock();
    await late;
    assert.equal(0, count);
    await Promise.all([
      BrowserToolboxNewTabRuntime.openOnReady(host, 3),
      BrowserToolboxNewTabRuntime.openOnReady(host, 3),
    ]);
    host.runtimeEpoch++;
    await BrowserToolboxNewTabRuntime.openOnReady(host, 4);
    assert.equal(1, count);
  });
});

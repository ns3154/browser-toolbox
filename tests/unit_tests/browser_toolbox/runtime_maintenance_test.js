// 维护接口只返回脱敏计数；网页和公开 UI iframe 不得取得恢复能力。
import "../test_helper.js";
import "../../../background_scripts/browser_toolbox/runtime_maintenance.js";

context("运行时维护发送者边界", () => {
  function harness() {
    const messages = [];
    let queries = 0;
    const api = {
      runtime: { id: "synthetic", getURL: (file) => `chrome-extension://synthetic/${file}` },
      tabs: {
        async query() {
          queries++;
          return [{ id: 1, url: "https://synthetic.invalid/" }, {
            id: 2,
            url: "chrome://extensions/",
          }];
        },
        async sendMessage(tabId, message, options) {
          messages.push({ tabId, message, options });
          return {
            initializationState: "active",
            planVersion: 1,
            secret: "不得导出",
            url: "不得导出",
          };
        },
      },
      webNavigation: {
        async getAllFrames() {
          return [{ frameId: 0, documentId: "synthetic-document" }];
        },
      },
    };
    return { service: new BrowserToolboxRuntimeMaintenance(api), messages, queries: () => queries };
  }

  should("拒绝内容脚本、公开 iframe、伪造 ID 和嵌入设置页，并且没有副作用", async () => {
    const h = harness();
    for (
      const sender of [
        { id: "synthetic", url: "https://synthetic.invalid/", frameId: 0 },
        {
          id: "synthetic",
          url: "chrome-extension://synthetic/pages/help_dialog_page.html",
          frameId: 0,
        },
        { id: "other", url: "chrome-extension://synthetic/pages/mouse_options.html", frameId: 0 },
        {
          id: "synthetic",
          url: "chrome-extension://synthetic/pages/mouse_options.html",
          frameId: 2,
        },
      ]
    ) {
      assert.equal(
        { ok: false, code: "PERMISSION_DENIED" },
        await h.service.run("restore", sender),
      );
    }
    assert.equal(0, h.queries());
    assert.equal([], h.messages);
  });

  should("合法设置页按可信 documentId 恢复，结果不包含 URL 或文档关联", async () => {
    const h = harness();
    const result = await h.service.run("restore", {
      id: "synthetic",
      url: "chrome-extension://synthetic/pages/mouse_options.html#general",
      frameId: 0,
    });
    assert.equal(1, result.activeFrames);
    assert.equal(1, result.unavailableTabs);
    assert.equal({ documentId: "synthetic-document" }, h.messages[0].options);
    assert.equal("browserToolbox.restoreCompatibleRuntime", h.messages[0].message.handler);
    assert.isFalse(JSON.stringify(result).includes("不得导出"));
    assert.isFalse(JSON.stringify(result).includes("synthetic-document"));
  });
  should("Canary 恢复先持久选择和撤销权限，全部 frame 暂停后才激活兼容方案", async () => {
    const events = [];
    const api = {
      runtime: { id: "synthetic", getURL: (file) => `chrome-extension://synthetic/${file}` },
      tabs: {
        query: async () => [{ id: 1, url: "https://synthetic.invalid/" }],
        sendMessage: async (_tabId, message, options) => {
          events.push(`${message.handler}:${options.documentId}`);
          if (message.handler === "browserToolbox.pauseRuntime") {
            await new Promise((resolve) =>
              setTimeout(resolve, options.documentId === "a" ? 10 : 0)
            );
            return { initializationState: "disabled", planVersion: 2 };
          }
          return { initializationState: "active", planVersion: 1 };
        },
      },
      webNavigation: {
        getAllFrames: async () => [{ frameId: 0, documentId: "a" }],
      },
    };
    const service = new BrowserToolboxRuntimeMaintenance(api, {
      plans: {
        COMPILED_CANARY: true,
        select: async () => ({ planVersion: 2 }),
        restore: async () => events.push("persist"),
      },
      clearTab: async () => events.push("revoke"),
      // 模拟 BFCache 后 API 漏掉 b；补证源在撤销授权后仍能枚举两个活动文档。
      frames: async () => [{ frameId: 0, documentId: "a" }, { frameId: 1, documentId: "b" }],
    });
    const result = await service.run("restore", {
      id: "synthetic",
      url: api.runtime.getURL("pages/mouse_options.html"),
      frameId: 0,
    });
    assert.equal(2, result.activeFrames);
    assert.equal([
      "persist",
      "revoke",
      "browserToolbox.pauseRuntime:a",
      "browserToolbox.pauseRuntime:b",
      "browserToolbox.restoreCompatibleRuntime:a",
      "browserToolbox.restoreCompatibleRuntime:b",
    ], events);
  });
  should("并发恢复与检查按整套流程串行，失败也在下一次动作前清理暂停状态", async () => {
    const events = [];
    let finish;
    const service = new BrowserToolboxRuntimeMaintenance({}, {
      onFinished: () => events.push("cleanup"),
    });
    service.runAction = async (action) => {
      events.push(action);
      if (action === "restore") {
        await new Promise((resolve) => finish = resolve);
        throw new Error("synthetic-failure");
      }
      return { ok: true };
    };
    const first = service.run("restore", {}).catch((failure) => failure.message);
    const second = service.run("inspect", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(["restore"], events);
    finish();
    assert.equal("synthetic-failure", await first);
    assert.equal({ ok: true }, await second);
    assert.equal(["restore", "cleanup", "inspect", "cleanup"], events);
  });

  should("暂停超时的标签不启动恢复，其他标签仍可恢复", async () => {
    const messages = [];
    let finishPause;
    const pendingPause = new Promise((resolve) => finishPause = resolve);
    const api = {
      runtime: { id: "synthetic", getURL: (file) => `chrome-extension://synthetic/${file}` },
      tabs: {
        query: () =>
          Promise.resolve([
            { id: 1, url: "https://one.invalid/" },
            { id: 2, url: "https://two.invalid/" },
          ]),
        sendMessage: async (tabId, message, options) => {
          messages.push({ tabId, handler: message.handler, frameId: options.frameId });
          if (message.handler === "browserToolbox.pauseRuntime") {
            if (tabId === 1 && options.frameId === 0) return await pendingPause;
            return { initializationState: "disabled", planVersion: 3 };
          }
          return { initializationState: "active", planVersion: 1 };
        },
      },
    };
    const service = new BrowserToolboxRuntimeMaintenance(api, {
      messageTimeoutMs: 10,
      plans: {
        COMPILED_CANARY: true,
        select: () => Promise.resolve({ planVersion: 3 }),
        restore: () => Promise.resolve(),
      },
      clearTab: () => Promise.resolve(),
      frames: () => Promise.resolve([{ frameId: 0 }, { frameId: 1 }]),
    });
    const result = await service.run("restore", {
      id: "synthetic",
      url: api.runtime.getURL("pages/mouse_options.html"),
      frameId: 0,
    });
    finishPause({ initializationState: "disabled", planVersion: 3 });
    assert.equal(2, result.pendingFrames);
    assert.equal(0, result.refreshRequiredFrames);
    assert.equal(2, result.activeFrames);
    assert.isFalse(
      messages.some((item) =>
        item.tabId === 1 && item.handler === "browserToolbox.restoreCompatibleRuntime"
      ),
    );
    assert.equal(
      2,
      messages.filter((item) =>
        item.tabId === 2 && item.handler === "browserToolbox.restoreCompatibleRuntime"
      ).length,
    );
  });

  should("恢复消息超时时报告仍在进行，而不误称页面需要刷新", async () => {
    let finishRestore;
    const pendingRestore = new Promise((resolve) => finishRestore = resolve);
    const api = {
      runtime: { id: "synthetic", getURL: (file) => `chrome-extension://synthetic/${file}` },
      tabs: {
        query: () => Promise.resolve([{ id: 1, url: "https://synthetic.invalid/" }]),
        sendMessage: async () => await pendingRestore,
      },
    };
    const service = new BrowserToolboxRuntimeMaintenance(api, {
      messageTimeoutMs: 10,
      frames: () => Promise.resolve([{ frameId: 0 }]),
    });
    const result = await service.run("restore", {
      id: "synthetic",
      url: api.runtime.getURL("pages/mouse_options.html"),
      frameId: 0,
    });
    finishRestore({ initializationState: "active", planVersion: 1 });
    assert.equal(1, result.pendingFrames);
    assert.equal(0, result.refreshRequiredFrames);
    assert.equal(0, result.activeFrames);
  });

  should("暂停失败只阻止对应标签，并忽略扩展组件子 frame", async () => {
    const messages = [];
    const api = {
      runtime: { id: "synthetic", getURL: (file) => `chrome-extension://synthetic/${file}` },
      tabs: {
        query: () => Promise.resolve([{ id: 1, url: "https://synthetic.invalid/" }]),
        sendMessage: (tabId, message, options) => {
          messages.push({ tabId, handler: message.handler, frameId: options.frameId });
          return Promise.reject(new Error("合成文档不可用"));
        },
      },
    };
    const service = new BrowserToolboxRuntimeMaintenance(api, {
      plans: {
        COMPILED_CANARY: true,
        select: () => Promise.resolve({ planVersion: 3 }),
        restore: () => Promise.resolve(),
      },
      clearTab: () => Promise.resolve(),
      frames: () =>
        Promise.resolve([
          { frameId: 0, url: "https://synthetic.invalid/" },
          { frameId: 1, url: "chrome-extension://synthetic/pages/hud_page.html" },
        ]),
    });
    const result = await service.run("restore", {
      id: "synthetic",
      url: api.runtime.getURL("pages/mouse_options.html"),
      frameId: 0,
    });
    assert.equal(1, result.refreshRequiredFrames);
    assert.equal(0, result.pendingFrames);
    assert.equal(0, result.activeFrames);
    assert.equal([{ tabId: 1, handler: "browserToolbox.pauseRuntime", frameId: 0 }], messages);
  });
});

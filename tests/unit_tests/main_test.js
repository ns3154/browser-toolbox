import "./test_helper.js";
import "../../lib/settings.js";
import "../../background_scripts/main.js";
import { RegistryEntry } from "../../background_scripts/commands.js";

context("独立查找栏父文档提交授权", () => {
  let sender, request, authority, effects, verifications;
  setup(() => {
    sender = { tab: { id: 23, index: 0, windowId: 7 }, documentId: "synthetic-owner" };
    request = {
      identity: { documentId: sender.documentId, runtimeEpoch: 2, incognito: false },
      payload: {
        submission: { handler: "openUrlInCurrentTab", url: "https://synthetic.invalid/" },
      },
    };
    authority = { planVersion: 6 };
    effects = [];
    verifications = 0;
    stub(globalThis, "BrowserToolboxRuntimePlans", {
      COMPILED_VOMNIBAR_CANARY: true,
      allowed: [{ planVersion: 6, moduleImplementations: { vomnibar: "browser-toolbox" } }],
    });
    stub(BrowserToolboxDocumentAuthority.prototype, "role", () => "content");
    stub(BrowserToolboxDocumentAuthority.prototype, "verify", async (identity, actor) => {
      verifications++;
      assert.equal(request.identity, identity);
      assert.equal(sender, actor);
      return authority;
    });
    stub(UrlUtils, "convertToUrl", async (value) => value);
    stub(chrome.tabs, "update", async (id, options) => effects.push({ id, options }));
    stub(chrome.tabs, "create", async (options) => effects.push({ options }));
    stub(chrome.search, "query", async (options) => effects.push({ options }));
  });
  should("先核验登记方案，再在异步URL转换后重核并只导航一次", async () => {
    assert.equal({ ok: true }, await browserToolboxSubmitVomnibar(request, sender));
    assert.equal(2, verifications);
    assert.equal([{ id: 23, options: { url: "https://synthetic.invalid/" } }], effects);
  });
  should("组件和公共页面不能使用父文档提交入口，兼容方案和额外参数被拒绝", async () => {
    for (const role of ["component", "public", "untrusted"]) {
      stub(BrowserToolboxDocumentAuthority.prototype, "role", () => role);
      assert.equal("PERMISSION_DENIED", (await browserToolboxSubmitVomnibar(request, sender)).code);
    }
    stub(BrowserToolboxDocumentAuthority.prototype, "role", () => "content");
    authority = { planVersion: 5 };
    let failure;
    try {
      await browserToolboxSubmitVomnibar(request, sender);
    } catch (error) {
      failure = error;
    }
    assert.equal("PERMISSION_DENIED", failure?.code);
    request.payload.submission.tabId = 999;
    assert.equal(
      "INVALID_VOMNIBAR_SUBMISSION",
      (await browserToolboxSubmitVomnibar(request, sender)).code,
    );
    assert.equal([], effects);
  });
  should("URL转换期间文档失效不能触发后续Native副作用", async () => {
    stub(UrlUtils, "convertToUrl", async (value) => {
      stub(BrowserToolboxDocumentAuthority.prototype, "verify", async () => {
        throw Object.assign(new Error("STALE_RUNTIME"), { code: "STALE_RUNTIME" });
      });
      return value;
    });
    let failure;
    try {
      await browserToolboxSubmitVomnibar(request, sender);
    } catch (error) {
      failure = error;
    }
    assert.equal("STALE_RUNTIME", failure?.code);
    assert.equal([], effects);
  });
  should("选择标签读取后文档失效不能激活窗口或标签", async () => {
    request.payload.submission = { handler: "selectSpecificTab", id: 24 };
    stub(chrome.windows, "update", async (id, options) => effects.push({ id, options }));
    stub(chrome.tabs, "get", async () => {
      stub(BrowserToolboxDocumentAuthority.prototype, "verify", async () => {
        throw Object.assign(new Error("STALE_RUNTIME"), { code: "STALE_RUNTIME" });
      });
      return { id: 24, windowId: 8 };
    });
    let failure;
    try {
      await browserToolboxSubmitVomnibar(request, sender);
    } catch (error) {
      failure = error;
    }
    assert.equal("STALE_RUNTIME", failure?.code);
    assert.equal([], effects);
  });
  should("未编译独立方案时拒绝入口，Native失效不进入动作", async () => {
    BrowserToolboxRuntimePlans.COMPILED_VOMNIBAR_CANARY = false;
    assert.equal("PERMISSION_DENIED", (await browserToolboxSubmitVomnibar(request, sender)).code);
    BrowserToolboxRuntimePlans.COMPILED_VOMNIBAR_CANARY = true;
    stub(BrowserToolboxDocumentAuthority.prototype, "verify", async () => {
      throw Object.assign(new Error("STALE_DOCUMENT"), { code: "STALE_DOCUMENT" });
    });
    let failure;
    try {
      await browserToolboxSubmitVomnibar(request, sender);
    } catch (error) {
      failure = error;
    }
    assert.equal("STALE_DOCUMENT", failure?.code);
    assert.equal([], effects);
  });
  should("新标签和系统搜索保持Native动作且不扩展提交选项", async () => {
    request.payload.submission.handler = "openUrlInNewTab";
    await browserToolboxSubmitVomnibar(request, sender);
    assert.equal(23, effects[0].options.openerTabId);
    assert.equal(1, effects[0].options.index);
    request.payload.submission = {
      handler: "launchSearchQuery",
      query: "中文目标",
      openInNewTab: true,
    };
    await browserToolboxSubmitVomnibar(request, sender);
    assert.equal({ options: { disposition: "NEW_TAB", text: "中文目标" } }, effects[1]);
  });
});

context("HintCoordinator", () => {
  should("prepareToActivateLinkHintsMode", async () => {
    let receivedMessages = [];
    const frameIdToHintDescriptors = {
      "0": { frameId: 0, localIndex: 123, linkText: null },
      "1": { frameId: 1, localIndex: 456, linkText: null },
    };

    stub(chrome.webNavigation, "getAllFrames", () => [{ frameId: 0 }, { frameId: 1 }]);
    stub(
      BrowserToolboxDocumentAuthority.prototype,
      "target",
      async (_tabId, frameId) => ({
        documentId: `synthetic-document-${frameId}`,
        runtimeEpoch: 1,
        incognito: false,
      }),
    );

    stub(chrome.tabs, "sendMessage", async (_tabId, message, options) => {
      assert.equal(2, message.protocolVersion);
      assert.equal("lifecycle", message.kind);
      assert.equal("hints", message.action);
      assert.equal(message.identity.documentId, options.documentId);
      const request = message.payload.message;
      if (request.messageType == "getHintDescriptors") {
        return frameIdToHintDescriptors[Number(options.documentId.at(-1))];
      } else if (request.messageType == "activateMode") {
        receivedMessages.push(request);
      }
    });

    await HintCoordinator.prepareToActivateLinkHintsMode(0, 0, {
      modeIndex: 0,
      requestedByHelpDialog: false,
    });

    receivedMessages = receivedMessages.map(
      (m) => Utils.pick(m, ["frameId", "frameIdToHintDescriptors"]),
    );

    // Each frame should receive only the hint descriptors from the other frames.
    assert.equal([
      { frameId: 0, frameIdToHintDescriptors: { "1": frameIdToHintDescriptors[1] } },
      { frameId: 1, frameIdToHintDescriptors: { "0": frameIdToHintDescriptors[0] } },
    ], receivedMessages);
  });
});

context("createTab command", () => {
  let tabCreated;
  let requestStub;

  setup(async () => {
    stub(chrome.tabs, "create", (args) => {
      tabCreated = args;
    });
    requestStub = {
      registryEntry: new RegistryEntry({ options: {} }),
      tab: {},
      count: 1,
    };
    await Settings.load();
  });

  should("open the provided URL", async () => {
    requestStub.url = "https://example.com";
    await BackgroundCommands.createTab(requestStub);
    assert.equal("https://example.com", tabCreated.url);
  });

  should("open the vimium new tab page", async () => {
    await Settings.set("newTabDestination", Settings.newTabDestinations.vimiumNewTabPage);
    await BackgroundCommands.createTab(requestStub);
    assert.equal(Settings.vimiumNewTabPageUrl, tabCreated.url);
  });

  should("open the browser's new tab page", async () => {
    await Settings.set("newTabDestination", Settings.newTabDestinations.browserNewTabPage);
    await BackgroundCommands.createTab(requestStub);
    // The URL argument to chrome.tabs.create is omitted when we want to use the browser's NTP.
    assert.isTrue(tabCreated != null);
    assert.equal(undefined, tabCreated.url);
  });

  should("open custom URL", async () => {
    await Settings.set("newTabDestination", Settings.newTabDestinations.customUrl);
    await BackgroundCommands.createTab(requestStub);
    // If a specific custom URL isn't provided, the browser's new tab page will be used.
    // The URL argument to chrome.tabs.create is omitted when we want to use the browser's NTP.
    assert.isTrue(tabCreated != null);
    assert.equal(undefined, tabCreated.url);

    await Settings.set("newTabCustomUrl", "http://example.com");
    await BackgroundCommands.createTab(requestStub);
    assert.equal("http://example.com", tabCreated.url);
  });

  teardown(() => {
    tabCreated = null;
    Settings.clear();
  });
});

context("Next zoom level", () => {
  // All these tests use the Chrome zoom levels, which are the default.
  should("Zoom in 0 times", async () => {
    const zoom = await nextZoomLevel(1.00, 0);
    assert.equal(1.00, zoom);
  });

  should("Zoom in 1", async () => {
    const zoom = await nextZoomLevel(1.00, 1);
    assert.equal(1.10, zoom);
  });

  should("Zoom out 1", async () => {
    const zoom = await nextZoomLevel(1.00, -1);
    assert.equal(0.90, zoom);
  });

  should("Zoom in 2", async () => {
    const zoom = await nextZoomLevel(1.00, 2);
    assert.equal(1.25, zoom);
  });

  should("Zoom out 2", async () => {
    const zoom = await nextZoomLevel(1.00, -2);
    assert.equal(0.80, zoom);
  });

  should("Zoom in from between values", async () => {
    const zoom = await nextZoomLevel(1.05, 1);
    assert.equal(1.10, zoom);
  });

  should("Zoom out from between values", async () => {
    const zoom = await nextZoomLevel(1.05, -1);
    assert.equal(1.00, zoom);
  });

  should("Zoom in past the maximum", async () => {
    const zoom = await nextZoomLevel(1.00, 15);
    assert.equal(5.00, zoom);
  });

  should("Zoom out past the minimum", async () => {
    const zoom = await nextZoomLevel(1.00, -15);
    assert.equal(0.25, zoom);
  });

  should("Zoom in from below the minimum", async () => {
    const lowZoom = 0.01; // Lowest non-broken Chrome zoom level
    const zoom = await nextZoomLevel(lowZoom, 1);
    assert.equal(0.25, zoom);
  });

  should("Zoom out from above the maximum", async () => {
    const highZoom = 9.99; // highest non-broken Chrome zoom level
    const zoom = await nextZoomLevel(highZoom, -1);
    assert.equal(5.00, zoom);
  });

  should("Zoom in from above the maximum", async () => {
    const highZoom = 9.99; // highest non-broken Chrome zoom level
    const zoom = await nextZoomLevel(highZoom, 1);
    assert.equal(5.00, zoom);
  });

  should("Zoom out from below the minimum", async () => {
    const lowZoom = 0.01; // lowest non-broken Chrome zoom level
    const zoom = await nextZoomLevel(lowZoom, -1);
    assert.equal(0.25, zoom);
  });

  should("Test Chrome 33% zoom in with float error", async () => {
    const floatZoom = 0.32999999999999996; // The value chrome actually gives for 33%.
    const zoom = await nextZoomLevel(floatZoom, 1);
    assert.equal(0.50, zoom);
  });

  should("Test Chrome 175% zoom in with float error", async () => {
    const floatZoom = 1.7499999999999998; // The value chrome actually gives for 175%.
    const zoom = await nextZoomLevel(floatZoom, 1);
    assert.equal(2.00, zoom);
  });
});

context("Selecting frames", () => {
  should("nextFrame", async () => {
    const focusedFrames = [];
    stub(chrome.webNavigation, "getAllFrames", () => [{ frameId: 1 }, { frameId: 2 }]);
    stub(chrome.tabs, "sendMessage", async (_tabId, message, options) => {
      if (message.handler == "getFocusStatus") {
        return { focused: options.frameId == 2, focusable: true };
      } else if (message.handler == "focusFrame") {
        focusedFrames.push(options.frameId);
      }
    });

    await BackgroundCommands.nextFrame(1, 0);
    assert.equal([1], focusedFrames);
  });
});

context("majorVersionHasIncreased", () => {
  should("return whether the major version has changed", () => {
    assert.equal(false, majorVersionHasIncreased(null));
    shoulda.stub(Utils, "getCurrentVersion", () => "2.0.1");
    assert.equal(false, majorVersionHasIncreased("2.0.0"));
    shoulda.stub(Utils, "getCurrentVersion", () => "2.1.0");
    assert.equal(true, majorVersionHasIncreased("2.0.0"));
  });
});

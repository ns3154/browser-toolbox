import "../test_helper.js";
import "../../../lib/browser_toolbox/tools/tool_contract.js";
import "../../../lib/browser_toolbox/tools/tool_registry.js";
import "../../../background_scripts/browser_toolbox/tool_input_token_store.js";
import "../../../background_scripts/browser_toolbox/tool_launcher.js";
import "../../../background_scripts/browser_toolbox/tool_context_menu_manager.js";

context("BrowserToolbox context menu manager", () => {
  should("rebuild stable configured and all-tool menu branches", async () => {
    const created = [];
    let clicked;
    const contextMenus = {
      create(properties) {
        created.push(properties);
      },
      removeAll(callback) {
        created.length = 0;
        callback();
      },
      onClicked: {
        addListener(listener) {
          clicked = listener;
        },
      },
    };
    const manager = new BrowserToolboxToolContextMenuManager.ToolContextMenuManager({
      contextMenus,
      settingsRepository: {
        getSettings: () => ({
          tools: {
            enabled: true,
            contextMenu: {
              enabled: true,
              toolIds: ["json.format", "text.diff", "codec.transform"],
            },
          },
        }),
      },
      openSettings: () => {},
    });
    assert.isTrue(await manager.reconcile());
    assert.isTrue(typeof clicked === "function");
    const ids = created.map((item) => item.id);
    assert.equal(ids.length, new Set(ids).size);
    assert.isTrue(ids.includes("browser-toolbox.root"));
    assert.isTrue(ids.includes("browser-toolbox.all-tools"));
    assert.isTrue(ids.includes("browser-toolbox.manage-tools"));
    assert.isTrue(ids.includes("browser-toolbox.configured-tool.json.format"));
    assert.isTrue(ids.includes("browser-toolbox.tool.table.convert"));
    assert.equal(4, created.filter((item) => item.parentId === "browser-toolbox.root").length - 2);
    assert.isTrue(
      created
        .filter((item) =>
          item.parentId === "browser-toolbox.root" && item.id.includes("configured-tool")
        )
        .every((item) => item.contexts.includes("all")),
    );
    assert.isTrue(
      created
        .filter((item) => item.parentId === "browser-toolbox.all-tools")
        .every((item) => item.contexts.includes("all")),
    );
    const toolIds = BrowserToolboxToolRegistry.list({ source: "selection", surface: "contextMenu" })
      .map((descriptor) => descriptor.id);
    await manager.reconcile({ tools: { contextMenu: { enabled: true, toolIds } } });
    assert.equal(
      toolIds.map(BrowserToolboxToolContextMenuManager.configuredToolIdForMenu),
      created.filter((item) => item.id.includes("configured-tool")).map((item) => item.id),
    );
    await manager.reconcile({ tools: { contextMenu: { enabled: true, toolIds: [] } } });
    assert.equal(0, created.filter((item) => item.id.includes("configured-tool")).length);
    assert.isTrue(created.some((item) => item.id === "browser-toolbox.all-tools"));
  });

  should("serialize overlapping reconciliations", async () => {
    const created = [];
    let activeCreates = 0;
    let maxActiveCreates = 0;
    const contextMenus = {
      create(properties, callback) {
        activeCreates++;
        maxActiveCreates = Math.max(maxActiveCreates, activeCreates);
        created.push(properties);
        queueMicrotask(() => {
          activeCreates--;
          callback?.();
        });
      },
      removeAll(callback) {
        created.length = 0;
        queueMicrotask(callback);
      },
      onClicked: { addListener() {} },
    };
    const manager = new BrowserToolboxToolContextMenuManager.ToolContextMenuManager({
      contextMenus,
      settingsRepository: {
        getSettings: () => ({
          tools: {
            enabled: true,
            contextMenu: { enabled: true, toolIds: ["json.format"] },
          },
        }),
      },
    });
    await Promise.all([manager.reconcile(), manager.reconcile()]);
    assert.equal(1, maxActiveCreates);
    assert.equal(created.length, new Set(created.map((item) => item.id)).size);
  });

  should("preserve selected input and open an empty tool page without selection", async () => {
    const originalGetURL = chrome.runtime.getURL;
    const originalCreateTab = chrome.tabs.create;
    const opened = [];
    chrome.runtime.getURL = (path) => `chrome-extension://test/${path}`;
    chrome.tabs.create = async (properties) => {
      opened.push(properties);
      return { id: 42 };
    };
    const manager = new BrowserToolboxToolContextMenuManager.ToolContextMenuManager({
      contextMenus: {},
      openSettings: () => {},
    });
    try {
      await manager.handleClick(
        {
          menuItemId: "browser-toolbox.tool.json.format",
          selectionText: '{"ok":true}',
        },
        { id: 7, index: 2 },
      );
      const selectedUrl = new URL(opened[0].url);
      assert.equal(selectedUrl.searchParams.get("source"), "selection");
      assert.isTrue(Boolean(selectedUrl.searchParams.get("inputToken")));
      assert.equal(opened[0].index, 3);

      await manager.handleClick(
        {
          menuItemId: "browser-toolbox.tool.json.format",
          selectionText: "",
        },
        { id: 7, index: 2 },
      );
      const emptyUrl = new URL(opened[1].url);
      assert.equal(emptyUrl.searchParams.get("source"), "selection");
      assert.equal(emptyUrl.searchParams.get("inputToken"), null);
      assert.equal(emptyUrl.searchParams.get("notice"), "empty-selection");
    } finally {
      chrome.runtime.getURL = originalGetURL;
      chrome.tabs.create = originalCreateTab;
    }
  });
});

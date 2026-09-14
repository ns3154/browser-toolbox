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
});

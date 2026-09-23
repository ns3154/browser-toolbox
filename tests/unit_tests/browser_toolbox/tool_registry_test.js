import "../test_helper.js";
import "../../../lib/browser_toolbox/tools/tool_contract.js";
import "../../../lib/browser_toolbox/tools/tool_registry.js";
import "../../../lib/browser_toolbox/tools/tool_registry_validator.js";

context("BrowserToolbox static tool registry", () => {
  should("expose stable, validated tool descriptors", () => {
    const registry = BrowserToolboxToolRegistry;
    assert.equal(
      [
        "json.format",
        "config.convert",
        "text.diff",
        "codec.transform",
        "time.convert",
        "id.generate",
        "password.generate",
        "table.convert",
      ],
      registry.TOOL_IDS,
    );
    assert.equal([], BrowserToolboxToolContract.validateRegistry(registry.entries));
    assert.isTrue(registry.get("json.format").localOnly);
    assert.isFalse(registry.has("json.format.v2"));
    assert.equal("developer", registry.get("config.convert").categoryId);
    assert.equal(["json.format", "text.diff", "codec.transform"], registry.DEFAULT_CONTEXT_MENU_TOOL_IDS);
    assert.equal("password.generate", registry.DEFAULT_ACTION_TOOL_IDS[5]);
  });

  should("allow every eligible action and context menu tool", () => {
    const registry = BrowserToolboxToolRegistry;
    const actionToolIds = registry.list({ source: "action", surface: "popup" })
      .map((descriptor) => descriptor.id);
    const contextToolIds = registry.list({ source: "selection", surface: "contextMenu" })
      .map((descriptor) => descriptor.id);
    assert.isTrue(actionToolIds.length > 6);
    assert.isTrue(registry.validateToolIds(actionToolIds, {
      source: "action",
      surface: "popup",
    }));
    assert.isTrue(registry.validateToolIds(contextToolIds, {
      source: "selection",
      surface: "contextMenu",
    }));
    assert.isFalse(registry.validateToolIds(["id.generate", "id.generate"]));
    assert.isFalse(registry.validateToolIds(["password.generate", "json.format"], {
      source: "selection",
    }));
    assert.isFalse(registry.validateToolIds(["table.convert"], {
      source: "action",
      surface: "popup",
    }));
    assert.isTrue(registry.validateToolIds(["table.convert"], {
      source: "selection",
      surface: "contextMenu",
    }));
    assert.equal(
      [],
      BrowserToolboxToolRegistryValidator.validateSettingsToolIds({
        tools: {
          pinnedIds: actionToolIds,
          contextMenu: { toolIds: contextToolIds },
        },
      }),
    );
  });
});

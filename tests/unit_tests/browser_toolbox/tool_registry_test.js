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

  should("limit configurable action and context menu tools", () => {
    const registry = BrowserToolboxToolRegistry;
    assert.isTrue(registry.validateToolIds(registry.DEFAULT_ACTION_TOOL_IDS, {
      max: 6,
      source: "action",
    }));
    assert.isTrue(registry.validateToolIds(registry.DEFAULT_CONTEXT_MENU_TOOL_IDS, {
      max: 3,
      source: "selection",
    }));
    assert.isFalse(registry.validateToolIds(["id.generate", "id.generate"], { max: 6 }));
    assert.isFalse(registry.validateToolIds(["password.generate", "json.format"], {
      max: 3,
      source: "selection",
    }));
    assert.isFalse(registry.validateToolIds(["table.convert"], {
      max: 6,
      source: "action",
      surface: "popup",
    }));
    assert.isTrue(registry.validateToolIds(["table.convert"], {
      max: 3,
      source: "selection",
      surface: "contextMenu",
    }));
    assert.equal(
      [],
      BrowserToolboxToolRegistryValidator.validateSettingsToolIds({
        tools: {
          pinnedIds: registry.DEFAULT_ACTION_TOOL_IDS,
          contextMenu: { toolIds: registry.DEFAULT_CONTEXT_MENU_TOOL_IDS },
        },
      }),
    );
  });
});

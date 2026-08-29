import "../test_helper.js";
import "../../../background_scripts/browser_toolbox/command_registry_adapter.js";

context("Command registry adapter", () => {
  should("expose upstream and BrowserToolbox command metadata", () => {
    const registry = BrowserToolboxCommandRegistry;
    const commands = registry.listCommands();
    assert.isTrue(commands.length > 0);
    assert.isTrue(Boolean(registry.getCommand("scrollDown")));
    assert.isTrue(Boolean(registry.getCommand("BrowserToolbox.openLinkForeground")));
    assert.equal(null, registry.getCommand("missing"));
    assert.isTrue(registry.validateBinding({ commandName: "scrollDown" }).ok);
    assert.isFalse(registry.validateBinding({ commandName: "missing" }).ok);
    assert.isFalse(
      registry.validateBinding({ commandName: "scrollDown", source: "unsupported" }).ok,
    );
    const custom = BrowserToolboxCreateCommandRegistry([
      {
        name: "upstreamCommand",
        desc: "Upstream",
        group: "tabs",
        background: true,
        topFrame: false,
        noRepeat: true,
        repeatLimit: 10,
        supportedInputs: ["keyboard"],
      },
    ]);
    assert.equal("background", custom[0].execution);
    assert.isTrue(custom[0].dangerous);
    const customRegistry = new BrowserToolboxCommandRegistryClass(custom);
    assert.isTrue(
      customRegistry.validateBinding({
        commandName: "upstreamCommand",
        source: "keyboard",
      }).ok,
    );
    assert.isFalse(
      customRegistry.validateBinding({
        commandName: "upstreamCommand",
        source: "mouseGesture",
      }).ok,
    );
    assert.isFalse(
      registry.validateBinding({
        commandName: "BrowserToolbox.openLinkForeground",
        source: "superDrag",
        context: "IMAGE",
      }).ok,
    );
    assert.isTrue(
      registry.validateBinding({
        commandName: "BrowserToolbox.openLinkForeground",
        source: "superDrag",
        context: "LINK",
      }).ok,
    );

    const fallback = BrowserToolboxCreateCommandRegistry([]);
    const fallbackLink = fallback.find((command) =>
      command.name === "BrowserToolbox.openLinkForeground"
    );
    const fallbackSearch = fallback.find((command) =>
      command.name === "BrowserToolbox.searchSelection"
    );
    assert.equal(["superDrag"], fallbackLink.supportedInputs);
    assert.equal(["link"], fallbackLink.requiredContext);
    assert.equal(["selection"], fallbackSearch.requiredContext);
    assert.equal("enum", fallbackSearch.optionSchema.disposition.type);

    assert.throwsError(() =>
      BrowserToolboxCreateCommandRegistry([
        { name: "duplicate", desc: "One" },
        { name: "duplicate", desc: "Two" },
      ])
    );
  });
});

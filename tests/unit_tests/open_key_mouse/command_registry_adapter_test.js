import "../test_helper.js";
import "../../../background_scripts/open_key_mouse/command_registry_adapter.js";

context("Command registry adapter", () => {
  should("expose upstream and OpenKeyMouse command metadata", () => {
    const registry = OpenKeyMouseCommandRegistry;
    const commands = registry.listCommands();
    assert.isTrue(commands.length > 0);
    assert.isTrue(Boolean(registry.getCommand("scrollDown")));
    assert.isTrue(Boolean(registry.getCommand("OpenKeyMouse.openLinkForeground")));
    assert.equal(null, registry.getCommand("missing"));
    assert.isTrue(registry.validateBinding({ commandName: "scrollDown" }).ok);
    assert.isFalse(registry.validateBinding({ commandName: "missing" }).ok);
    assert.isFalse(
      registry.validateBinding({ commandName: "scrollDown", source: "unsupported" }).ok,
    );
    const custom = OpenKeyMouseCreateCommandRegistry([
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
    const customRegistry = new OpenKeyMouseCommandRegistryClass(custom);
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
  });
});

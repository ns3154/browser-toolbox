import "../test_helper.js";
import "../../../lib/open_key_mouse/command_invocation.js";
import "../../../lib/open_key_mouse/settings_schema.js";
import "../../../lib/open_key_mouse/settings_validator.js";
import "../../../background_scripts/open_key_mouse/command_registry_adapter.js";

context("OpenKeyMouse command invocation", () => {
  should("create a validated invocation", () => {
    const invocation = OpenKeyMouseCommandInvocation.createInvocation(
      "scrollDown",
      { source: "gesture" },
      { type: "mouseGesture", pattern: "D" },
      { pageUrl: "https://example.com/", topFrame: true },
      2,
    );
    const result = OpenKeyMouseCommandInvocation.validateInvocation(
      invocation,
      OpenKeyMouseCommandRegistry,
    );
    assert.isTrue(result.ok);
    assert.equal(1, invocation.protocolVersion);
    assert.equal(2, invocation.count);
  });

  should("reject dangerous commands with excessive count", () => {
    const invocation = OpenKeyMouseCommandInvocation.createInvocation(
      "removeTab",
      {},
      { type: "mouseGesture" },
      {},
      11,
    );
    const result = OpenKeyMouseCommandInvocation.validateInvocation(
      invocation,
      OpenKeyMouseCommandRegistry,
    );
    assert.isFalse(result.ok);
    assert.equal("INVALID_OPTIONS", result.code);
  });

  should("reject executable data and unsafe URL schemes", () => {
    const invocation = OpenKeyMouseCommandInvocation.createInvocation(
      "OpenKeyMouse.openLinkForeground",
      {},
      { type: "superDrag" },
      { linkUrl: "javascript:alert(1)" },
    );
    invocation.options.callback = () => {};
    const result = OpenKeyMouseCommandInvocation.validateInvocation(
      invocation,
      OpenKeyMouseCommandRegistry,
    );
    assert.isFalse(result.ok);
    assert.equal("INVALID_OPTIONS", result.code);
  });
});

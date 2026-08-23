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

  should("validate boundaries, protocols and plain data", () => {
    const api = OpenKeyMouseCommandInvocation;
    assert.isTrue(api.isPlainData(null));
    assert.isTrue(api.isPlainData({ nested: ["ok", 1, true] }));
    assert.isFalse(api.isPlainData(new Date()));
    assert.isTrue(
      api.isPlainData({
        value: { value: { value: { value: { value: { value: null } } } } },
      }),
    );
    assert.isFalse(api.isAllowedUrl(""));
    assert.isFalse(api.isAllowedUrl("x".repeat(8193)));
    assert.isFalse(api.isAllowedUrl("http://[::1"));
    assert.isTrue(api.isAllowedUrl("file:///tmp/example"));
    assert.isTrue(api.isAllowedUrl("ftp://example.com/file"));
    assert.isTrue(api.isAllowedUrl("mailto:test@example.com"));
    assert.isFalse(api.isAllowedUrl("chrome-extension://other/pages/options.html"));
    assert.isFalse(api.isAllowedUrl("chrome-extension://own/pages/options.html", {
      allowExtension: false,
    }));
  });

  should("reject malformed invocation fields", () => {
    const api = OpenKeyMouseCommandInvocation;
    const valid = api.createInvocation("scrollDown", {}, { type: "ui" }, {});
    const check = (changes, code) => {
      const result = api.validateInvocation(
        Object.assign({}, valid, changes),
        OpenKeyMouseCommandRegistry,
      );
      assert.equal(code, result.code);
    };
    check(null, "OK");
    check({ protocolVersion: 2 }, "INVALID_OPTIONS");
    check({ requestId: "short" }, "INVALID_OPTIONS");
    check({ commandName: "x".repeat(129) }, "UNKNOWN_COMMAND");
    check({ commandName: "missing" }, "UNKNOWN_COMMAND");
    check({ count: 0 }, "INVALID_OPTIONS");
    check({ count: 51 }, "INVALID_OPTIONS");
    check({ source: { type: "unknown" } }, "INVALID_OPTIONS");
    check({ options: new Date() }, "INVALID_OPTIONS");
    check({ context: new Date() }, "INVALID_OPTIONS");
    check({ context: { imageUrl: "javascript:bad" } }, "BLOCKED_URL_SCHEME");
  });
});

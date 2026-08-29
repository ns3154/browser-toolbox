import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/command_invocation.js";
import "../../../lib/browser_toolbox/settings_schema.js";
import "../../../lib/browser_toolbox/regex_safety.js";
import "../../../lib/browser_toolbox/module_registry.js";
import "../../../lib/browser_toolbox/settings_validator.js";
import "../../../background_scripts/browser_toolbox/command_registry_adapter.js";

context("BrowserToolbox command invocation", () => {
  should("create a validated invocation", () => {
    const invocation = BrowserToolboxCommandInvocation.createInvocation(
      "scrollDown",
      { source: "gesture" },
      { type: "mouseGesture", pattern: "D" },
      { pageUrl: "https://example.com/", topFrame: true },
      2,
    );
    const result = BrowserToolboxCommandInvocation.validateInvocation(
      invocation,
      BrowserToolboxCommandRegistry,
    );
    assert.isTrue(result.ok);
    assert.equal(1, invocation.protocolVersion);
    assert.equal(2, invocation.count);
  });

  should("reject dangerous commands with excessive count", () => {
    const invocation = BrowserToolboxCommandInvocation.createInvocation(
      "removeTab",
      {},
      { type: "mouseGesture" },
      {},
      11,
    );
    const result = BrowserToolboxCommandInvocation.validateInvocation(
      invocation,
      BrowserToolboxCommandRegistry,
    );
    assert.isFalse(result.ok);
    assert.equal("INVALID_OPTIONS", result.code);
  });

  should("reject executable data and unsafe URL schemes", () => {
    const invocation = BrowserToolboxCommandInvocation.createInvocation(
      "BrowserToolbox.openLinkForeground",
      {},
      { type: "superDrag" },
      { linkUrl: "javascript:alert(1)" },
    );
    invocation.options.callback = () => {};
    const result = BrowserToolboxCommandInvocation.validateInvocation(
      invocation,
      BrowserToolboxCommandRegistry,
    );
    assert.isFalse(result.ok);
    assert.equal("INVALID_OPTIONS", result.code);
  });

  should("enforce input capability, page context and typed options", () => {
    const api = BrowserToolboxCommandInvocation;
    const missingContext = api.createInvocation(
      "BrowserToolbox.openLinkForeground",
      {},
      { type: "superDrag" },
      {},
    );
    assert.isFalse(api.validateInvocation(missingContext, BrowserToolboxCommandRegistry).ok);

    const valid = api.createInvocation(
      "BrowserToolbox.searchSelection",
      { disposition: "background" },
      { type: "superDrag" },
      { selectedText: "query" },
    );
    assert.isTrue(api.validateInvocation(valid, BrowserToolboxCommandRegistry).ok);
    valid.options.disposition = "sideways";
    assert.isFalse(api.validateInvocation(valid, BrowserToolboxCommandRegistry).ok);
    valid.options.disposition = "background";
    valid.options.keyword = "x".repeat(65);
    assert.isFalse(api.validateInvocation(valid, BrowserToolboxCommandRegistry).ok);

    const unsupported = api.createInvocation(
      "BrowserToolbox.openLinkForeground",
      {},
      { type: "mouseGesture" },
      { linkUrl: "https://example.com/" },
    );
    assert.isFalse(api.validateInvocation(unsupported, BrowserToolboxCommandRegistry).ok);
  });

  should("validate boundaries, protocols and plain data", () => {
    const api = BrowserToolboxCommandInvocation;
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
    const api = BrowserToolboxCommandInvocation;
    const valid = api.createInvocation("scrollDown", {}, { type: "ui" }, {});
    const check = (changes, code) => {
      const result = api.validateInvocation(
        Object.assign({}, valid, changes),
        BrowserToolboxCommandRegistry,
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

  should("reject missing or non-object command contexts without throwing", () => {
    const api = BrowserToolboxCommandInvocation;
    const valid = api.createInvocation("scrollDown", {}, { type: "ui" }, {});
    for (const context of [null, undefined, [], "invalid"]) {
      const result = api.validateInvocation(
        Object.assign({}, valid, { context }),
        BrowserToolboxCommandRegistry,
      );
      assert.isFalse(result.ok);
      assert.equal("INVALID_OPTIONS", result.code);
    }
  });
});

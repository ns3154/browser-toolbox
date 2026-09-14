import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/settings_schema.js";
import "../../../lib/browser_toolbox/regex_safety.js";
import "../../../lib/browser_toolbox/module_registry.js";
import "../../../lib/browser_toolbox/settings_validator.js";

context("BrowserToolbox settings validator", () => {
  const registry = { getCommand: (name) => name ? { name } : null };

  should("accept the complete default configuration", () => {
    const result = BrowserToolboxSettingsValidator.validate(
      BrowserToolboxSettingsSchema.DEFAULT_SETTINGS,
      registry,
    );
    assert.isTrue(result.ok);
    assert.equal("4-way", BrowserToolboxSettingsSchema.DEFAULT_SETTINGS.mouse.directionMode);
    assert.equal(
      [
        "L:goBack",
        "R:goForward",
        "U:scrollFullPageUp",
        "D:scrollFullPageDown",
        "D>R:removeTab",
        "L>U:restoreTab",
        "R>D:scrollToBottom",
        "R>U:scrollToTop",
        "U>D:reload",
        "U>D>U:reload:hard",
        "U>L:previousTab",
        "U>R:nextTab",
        "D>R>U:BrowserToolbox.newWindow",
        "U>R>D:BrowserToolbox.closeWindow",
        "R>D>L>U:BrowserToolbox.openSettings",
      ],
      BrowserToolboxSettingsSchema.DEFAULT_SETTINGS.mouse.bindings.map((binding) =>
        `${binding.pattern.join(">")}:${binding.commandName}${binding.options.hard ? ":hard" : ""}`
      ),
    );
  });

  should("reject duplicate enabled patterns and mutable privacy flags", () => {
    const settings = BrowserToolboxSettingsSchema.mergeSettings({
      mouse: {
        bindings: [
          { pattern: ["L"], commandName: "goBack", enabled: true },
          { pattern: ["L"], commandName: "goForward", enabled: true },
        ],
      },
      privacy: { telemetry: true },
    });
    const result = BrowserToolboxSettingsValidator.validate(settings, registry);
    assert.isFalse(result.ok);
    assert.isTrue(result.errors.some((error) => error.includes("Duplicate mouse binding")));
    assert.isTrue(result.errors.some((error) => error.includes("Privacy")));
  });

  should("reject every bounded configuration category", () => {
    const invalid = BrowserToolboxSettingsSchema.mergeSettings({
      schemaVersion: 99,
      general: { language: "bad" },
      mouse: {
        triggerButton: 9,
        directionMode: "bad",
        activationDistancePx: 0,
        bindings: [null, { pattern: [], commandName: "missing" }],
      },
      superDrag: { nativeBypassModifier: "Command", bindings: "bad" },
      wheel: {
        threshold: 9999,
        bindings: [{ button: "bad", direction: "bad", commandName: "missing" }],
      },
      rocker: { bindings: [{ sequence: "bad", commandName: "missing" }] },
      cursor: { localAssetId: "bad", hotspotX: -1, hotspotY: 128 },
      siteRules: [
        {},
        { pattern: "example", modules: { mouse: "bad" } },
        { pattern: "[", matchType: "regex" },
        { pattern: "^(a+)+$", matchType: "regex" },
        { pattern: "example", matchType: "wildcard", enabled: "yes" },
      ],
      keyboard: { keyMappings: "x".repeat(256 * 1024 + 1) },
      searchEngines: "x".repeat(256 * 1024 + 1),
      exclusionRules: [{}],
      privacy: { telemetry: true, remoteConfig: true, backgroundNetwork: true },
    });
    const result = BrowserToolboxSettingsValidator.validate(invalid, { getCommand: () => null });
    assert.isFalse(result.ok);
    assert.isTrue(result.errors.length >= 10);
    assert.isTrue(result.errors.some((error) => error.includes("regular expression")));
    assert.isTrue(result.errors.some((error) => error.includes("triggerButton")));
    assert.isTrue(result.errors.some((error) => error.includes("nativeBypassModifier")));
    assert.isTrue(result.errors.some((error) => error.includes("too complex")));
    assert.isTrue(result.errors.some((error) => error.includes("match type")));
    let threw = false;
    try {
      BrowserToolboxSettingsValidator.assertValid(invalid, { getCommand: () => null });
    } catch (_) {
      threw = true;
    }
    assert.isTrue(threw);
  });

  should("reject commands that are not supported by the binding input", () => {
    const settings = BrowserToolboxSettingsSchema.mergeSettings({
      mouse: {
        bindings: [{ pattern: ["L"], commandName: "keyboardOnly", enabled: true }],
      },
    });
    const restrictedRegistry = {
      getCommand: (name) => name === "keyboardOnly" ? { name } : null,
      validateBinding: ({ commandName, source }) =>
        commandName === "keyboardOnly" && source === "mouseGesture"
          ? { ok: false, error: "keyboardOnly does not support mouseGesture." }
          : { ok: true },
    };
    const result = BrowserToolboxSettingsValidator.validate(settings, restrictedRegistry);
    assert.isFalse(result.ok);
    assert.isTrue(result.errors.some((error) => error.includes("does not support")));
  });

  should("reject malformed scalar flags and binding metadata", () => {
    const settings = BrowserToolboxSettingsSchema.mergeSettings({
      general: { enabled: "yes" },
      keyboard: { enabled: 1 },
      mouse: {
        suppressContextMenuAfterActivation: "yes",
        bindings: [{
          id: 1,
          enabled: "yes",
          pattern: ["L"],
          commandName: "goBack",
          options: null,
        }],
      },
      superDrag: {
        bindings: [{
          context: "UNKNOWN",
          pattern: ["R"],
          commandName: "goBack",
          options: {},
        }],
      },
      siteRules: [{
        pattern: "https://example.com/*",
        modules: { unknownModule: false },
      }],
    });
    const result = BrowserToolboxSettingsValidator.validate(settings, registry);
    assert.isFalse(result.ok);
    assert.isTrue(result.errors.some((error) => error.includes("general.enabled")));
    assert.isTrue(result.errors.some((error) => error.includes("binding.options")));
    assert.isTrue(result.errors.some((error) => error.includes("superDrag binding")));
    assert.isTrue(result.errors.some((error) => error.includes("Unknown site rule module")));
  });

  should("ignore prototype pollution keys in imported settings", () => {
    const imported = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"polluted":true},' +
        '"mouse":{"__proto__":{"enabled":false}}}',
    );
    const merged = BrowserToolboxSettingsSchema.mergeSettings(imported);
    assert.equal(undefined, Object.prototype.polluted);
    assert.isTrue(merged.general.enabled);
    assert.isTrue(merged.mouse.enabled);
    assert.equal(Object.prototype, Object.getPrototypeOf(merged));
    assert.isFalse(Object.hasOwn(merged, "__proto__"));
  });

  should("return validation errors for non-array binding patterns without throwing", () => {
    for (const malformedPattern of ["L", 1, {}, null]) {
      const settings = BrowserToolboxSettingsSchema.mergeSettings({
        mouse: {
          bindings: [{ pattern: malformedPattern, commandName: "goBack", options: {} }],
        },
      });
      const result = BrowserToolboxSettingsValidator.validate(settings, registry);
      assert.isFalse(result.ok);
      assert.isTrue(result.errors.some((error) => error.includes("invalid pattern")));
    }
  });

  should("accept every supported native drag bypass modifier", () => {
    for (const nativeBypassModifier of BrowserToolboxSettingsValidator.NATIVE_BYPASS_MODIFIERS) {
      const settings = BrowserToolboxSettingsSchema.mergeSettings({
        superDrag: { nativeBypassModifier },
      });
      assert.isTrue(
        BrowserToolboxSettingsValidator.validate(settings, registry).ok,
        nativeBypassModifier,
      );
    }
  });

  should("validate bounded site profile overrides", () => {
    const valid = BrowserToolboxSettingsSchema.mergeSettings({
      siteRules: [{
        pattern: "https://editor.example.com/*",
        profile: {
          preset: "editor",
          name: "Editor mode",
          mouse: { enabled: false, activationDistancePx: 24, showTrail: false },
          superDrag: { enabled: false, nativeBypassModifier: "Control" },
          wheel: { threshold: 160, cooldownMs: 240, continuousTabSwitching: true },
          rocker: { enabled: false },
        },
      }],
    });
    assert.isTrue(BrowserToolboxSettingsValidator.validate(valid, registry).ok);
    const invalid = BrowserToolboxSettingsSchema.mergeSettings({
      siteRules: [{
        pattern: "https://editor.example.com/*",
        profile: {
          preset: "unknown",
          mouse: { activationDistancePx: 0, unexpected: true },
          wheel: { cooldownMs: 6000 },
        },
      }],
    });
    const result = BrowserToolboxSettingsValidator.validate(invalid, registry);
    assert.isFalse(result.ok);
    assert.isTrue(result.errors.some((error) => error.includes("preset")));
    assert.isTrue(result.errors.some((error) => error.includes("activationDistancePx")));
    assert.isTrue(result.errors.some((error) => error.includes("cooldownMs")));
  });
});

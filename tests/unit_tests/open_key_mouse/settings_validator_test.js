import "../test_helper.js";
import "../../../lib/open_key_mouse/settings_schema.js";
import "../../../lib/open_key_mouse/settings_validator.js";

context("OpenKeyMouse settings validator", () => {
  const registry = { getCommand: (name) => name ? { name } : null };

  should("accept the complete default configuration", () => {
    const result = OpenKeyMouseSettingsValidator.validate(
      OpenKeyMouseSettingsSchema.DEFAULT_SETTINGS,
      registry,
    );
    assert.isTrue(result.ok);
  });

  should("reject duplicate enabled patterns and mutable privacy flags", () => {
    const settings = OpenKeyMouseSettingsSchema.mergeSettings({
      mouse: {
        bindings: [
          { pattern: ["L"], commandName: "goBack", enabled: true },
          { pattern: ["L"], commandName: "goForward", enabled: true },
        ],
      },
      privacy: { telemetry: true },
    });
    const result = OpenKeyMouseSettingsValidator.validate(settings, registry);
    assert.isFalse(result.ok);
    assert.isTrue(result.errors.some((error) => error.includes("Duplicate mouse binding")));
    assert.isTrue(result.errors.some((error) => error.includes("Privacy")));
  });

  should("reject every bounded configuration category", () => {
    const invalid = OpenKeyMouseSettingsSchema.mergeSettings({
      schemaVersion: 99,
      general: { language: "bad" },
      mouse: {
        directionMode: "bad",
        activationDistancePx: 0,
        bindings: [null, { pattern: [], commandName: "missing" }],
      },
      superDrag: { bindings: "bad" },
      wheel: {
        threshold: 9999,
        bindings: [{ button: "bad", direction: "bad", commandName: "missing" }],
      },
      rocker: { bindings: [{ sequence: "bad", commandName: "missing" }] },
      cursor: { localAssetId: "bad", hotspotX: -1, hotspotY: 128 },
      siteRules: [{}, { pattern: "example", modules: { mouse: "bad" } }],
      keyboard: { keyMappings: "x".repeat(256 * 1024 + 1) },
      searchEngines: "x".repeat(256 * 1024 + 1),
      exclusionRules: [{}],
      privacy: { telemetry: true, remoteConfig: true, backgroundNetwork: true },
    });
    const result = OpenKeyMouseSettingsValidator.validate(invalid, { getCommand: () => null });
    assert.isFalse(result.ok);
    assert.isTrue(result.errors.length >= 10);
    let threw = false;
    try {
      OpenKeyMouseSettingsValidator.assertValid(invalid, { getCommand: () => null });
    } catch (_) {
      threw = true;
    }
    assert.isTrue(threw);
  });
});

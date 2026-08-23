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
});

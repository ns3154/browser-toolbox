import "../test_helper.js";
import "../../../lib/open_key_mouse/settings_schema.js";
import "../../../lib/open_key_mouse/settings_validator.js";
import "../../../background_scripts/open_key_mouse/settings_migrations.js";

context("Settings migrations", () => {
  should("migrate three schema generations sequentially", () => {
    const migrated = OpenKeyMouseSettingsMigrations.migrate({
      schemaVersion: 0,
      gestureBindings: [{ pattern: ["L"], commandName: "goBack" }],
    });
    assert.equal(3, migrated.schemaVersion);
    assert.equal(["L"], migrated.mouse.bindings[0].pattern);
    assert.isFalse(migrated.privacy.telemetry);
  });

  should("keep immutable privacy flags disabled", () => {
    const migrated = OpenKeyMouseSettingsMigrations.migrate({
      schemaVersion: 2,
      privacy: { telemetry: true },
    });
    assert.equal(
      { telemetry: false, remoteConfig: false, backgroundNetwork: false },
      migrated.privacy,
    );
  });
});

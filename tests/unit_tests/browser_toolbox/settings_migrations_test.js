import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/settings_schema.js";
import "../../../lib/browser_toolbox/module_registry.js";
import "../../../lib/browser_toolbox/settings_validator.js";
import "../../../background_scripts/browser_toolbox/settings_migrations.js";

context("Settings migrations", () => {
  should("migrate three schema generations sequentially", () => {
    const migrated = BrowserToolboxSettingsMigrations.migrate({
      schemaVersion: 0,
      gestureBindings: [{ pattern: ["R"], commandName: "OpenKeyMouse.newWindow" }],
    });
    assert.equal(6, migrated.schemaVersion);
    assert.equal(["R"], migrated.mouse.bindings[0].pattern);
    assert.equal("BrowserToolbox.newWindow", migrated.mouse.bindings[0].commandName);
    assert.isFalse(migrated.privacy.telemetry);
    assert.equal(
      BrowserToolboxSettingsSchema.DEFAULT_SITE_RULES,
      migrated.siteRules,
    );
    assert.equal({}, migrated.mouse.bindings[0].options);
  });

  should("keep immutable privacy flags disabled", () => {
    const migrated = BrowserToolboxSettingsMigrations.migrate({
      schemaVersion: 2,
      privacy: { telemetry: true },
    });
    assert.equal(
      { telemetry: false, remoteConfig: false, backgroundNetwork: false },
      migrated.privacy,
    );
  });

  should("rewrite legacy command names to the BrowserToolbox namespace", () => {
    const migrated = BrowserToolboxSettingsMigrations.migrate({
      schemaVersion: 3,
      siteRules: [{ pattern: "^https://example\\.com/", matchType: "regex" }],
      mouse: {
        bindings: [{ pattern: ["R"], commandName: "OpenKeyMouse.newWindow" }],
      },
      superDrag: {
        bindings: [{ pattern: ["R"], commandName: "OpenKeyMouse.openLinkForeground" }],
      },
    });
    assert.equal("BrowserToolbox.newWindow", migrated.mouse.bindings[0].commandName);
    assert.equal(
      "BrowserToolbox.openLinkForeground",
      migrated.superDrag.bindings[0].commandName,
    );
    assert.equal(6, migrated.schemaVersion);
    assert.equal("regex", migrated.siteRules[0].matchType);
    assert.isTrue(migrated.siteRules[0].enabled);
    assert.equal("browser-toolbox-settings", BrowserToolboxSettingsMigrations.EXPORT_FORMAT);
    assert.equal("open-key-mouse-settings", BrowserToolboxSettingsMigrations.LEGACY_EXPORT_FORMAT);
  });

  should("leave malformed bindings for validation instead of throwing", () => {
    const migrated = BrowserToolboxSettingsMigrations.migrate({
      schemaVersion: 4,
      mouse: { bindings: [null, "invalid", { pattern: ["L"], commandName: "goBack" }] },
      wheel: { bindings: "invalid" },
    });
    assert.equal([null, "invalid"], migrated.mouse.bindings.slice(0, 2));
    assert.equal("invalid", migrated.wheel.bindings);
    assert.equal({}, migrated.mouse.bindings[2].options);
  });

  should("remove diagonal bindings when migrating to four-way gestures", () => {
    const migrated = BrowserToolboxSettingsMigrations.migrate({
      schemaVersion: 5,
      mouse: {
        bindings: [
          { pattern: ["UR"], commandName: "goForward" },
          { pattern: ["R", "D"], commandName: "scrollToBottom" },
        ],
      },
      superDrag: {
        bindings: [{ pattern: ["DL"], commandName: "copySelection" }],
      },
    });
    assert.equal("4-way", migrated.mouse.directionMode);
    assert.equal([["R", "D"]], migrated.mouse.bindings.map((binding) => binding.pattern));
    assert.equal([], migrated.superDrag.bindings);
  });

  should("parse and migrate canonical and legacy export wrappers", () => {
    const migrations = globalThis.BrowserToolboxSettingsMigrations;
    const payload = migrations.createExportPayload({
      schemaVersion: 0,
      gestureBindings: [{ pattern: ["R"], commandName: "OpenKeyMouse.newWindow" }],
    }, {
      extensionVersion: "0.0.0",
      exportedAt: "2026-08-23T00:00:00.000Z",
    });
    const parsed = migrations.migrateExportPayload(payload);
    assert.isTrue(parsed.ok);
    assert.equal(6, parsed.settings.schemaVersion);
    assert.equal("BrowserToolbox.newWindow", parsed.settings.mouse.bindings[0].commandName);
    assert.equal([], payload.localAssets);

    const legacy = {
      format: migrations.LEGACY_EXPORT_FORMAT,
      settings: { schemaVersion: 4 },
    };
    assert.isTrue(migrations.parseExportPayload(legacy).ok);
    assert.equal(null, migrations.parseExportPayload({ format: "other", settings: {} }));
    assert.equal(
      "unsupported-format-version",
      migrations.parseExportPayload({
        format: migrations.EXPORT_FORMAT,
        formatVersion: 2,
        settings: {},
      }).code,
    );
    assert.equal(
      "invalid-settings",
      migrations.parseExportPayload({ format: migrations.EXPORT_FORMAT, settings: [] }).code,
    );
  });

  should("report unknown export fields before the schema drops them", () => {
    const migrations = globalThis.BrowserToolboxSettingsMigrations;
    const parsed = migrations.parseExportPayload({
      format: migrations.EXPORT_FORMAT,
      formatVersion: 1,
      settings: {
        schemaVersion: 4,
        general: { enabled: true, futureGeneralOption: true },
        mouse: {
          bindings: [{
            pattern: ["L"],
            commandName: "goBack",
            options: {},
            futureBindingFlag: true,
          }],
        },
        futureSection: { enabled: true },
      },
      localAssets: [{ id: "cursor", data: "data:image/png;base64,AA==" }],
      futureWrapperField: "preserve-in-report",
    });
    assert.isTrue(parsed.ok);
    assert.equal(
      [
        "futureWrapperField",
        "settings.futureSection",
        "settings.general.futureGeneralOption",
        "settings.mouse.bindings[0].futureBindingFlag",
        "localAssets",
      ],
      parsed.unknown,
    );
    assert.equal(
      [
        "settings.futureSection",
        "settings.general.futureGeneralOption",
        "settings.mouse.bindings[0].futureBindingFlag",
      ],
      parsed.preserved,
    );
    assert.equal(["futureWrapperField", "localAssets"], parsed.ignored);
    const migrated = migrations.migrateExportPayload({
      format: migrations.EXPORT_FORMAT,
      formatVersion: 1,
      settings: { schemaVersion: 4, futureSection: { enabled: true } },
    });
    assert.equal(["settings.futureSection"], migrated.unknown);
    assert.equal(["settings.futureSection"], migrated.preserved);
    assert.isTrue(Object.hasOwn(migrated.settings, "futureSection"));
  });

  should("preserve unknown tool fields while normalizing known tool settings", () => {
    const migrated = BrowserToolboxSettingsMigrations.migrate({
      schemaVersion: 4,
      tools: {
        futureToolPolicy: { mode: "next" },
        contextMenu: { toolIds: ["json.format"], futureContextFlag: true },
        documentFormatter: {
          autoFormat: { json: false, futureFormat: true },
          json: { defaultSort: "descending", futureJsonOption: 7 },
          futureFormatterOption: "keep",
        },
      },
    });
    assert.equal({ mode: "next" }, migrated.tools.futureToolPolicy);
    assert.isTrue(migrated.tools.contextMenu.futureContextFlag);
    assert.isTrue(migrated.tools.documentFormatter.autoFormat.futureFormat);
    assert.equal(7, migrated.tools.documentFormatter.json.futureJsonOption);
    assert.equal("keep", migrated.tools.documentFormatter.futureFormatterOption);
    assert.isFalse(migrated.tools.documentFormatter.autoFormat.json);
    assert.equal("descending", migrated.tools.documentFormatter.json.defaultSort);
  });
});

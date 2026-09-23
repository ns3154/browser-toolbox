import "../test_helper.js";
import "../../../pages/settings_error_formatter.js";

context("Settings error formatter", () => {
  const message = (key) => key;

  should("preserve rollback failures alongside either localized sync quota error", () => {
    for (
      const [quota, key] of [["item", "syncQuotaItemExceeded"], ["total", "syncQuotaTotalExceeded"]]
    ) {
      const error = Object.assign(new Error("Storage quota failed"), {
        code: "browser-toolbox-sync-quota",
        quota,
        rollbackErrors: [new Error("Vimium rollback failed")],
      });
      assert.equal(
        `${key}\nsettingsRecoveryFailed`,
        BrowserToolboxSettingsErrorFormatter.format(error, { message }),
      );
      error.rollbackErrors = [];
      assert.equal(key, BrowserToolboxSettingsErrorFormatter.format(error, { message }));
    }
  });

  should(
    "keep conflict fields and append recovery status without exposing raw rollback details",
    () => {
      const error = Object.assign(new Error("Conflict"), {
        code: "browser-toolbox-settings-conflict",
        rollbackErrors: [new Error("Storage unavailable")],
      });
      assert.equal(
        "settingsConflict\nsettingsConflictFields: Vimium: keyMappings\nsettingsRecoveryFailed",
        BrowserToolboxSettingsErrorFormatter.format(error, {
          message,
          conflictDetails: ["Vimium: keyMappings"],
        }),
      );
    },
  );

  should(
    "preserve an ordinary failure and append recovery status only when recovery failed",
    () => {
      const error = new Error("Save failed");
      assert.equal("Save failed", BrowserToolboxSettingsErrorFormatter.format(error, { message }));
      error.rollbackErrors = [new Error("Rollback failed")];
      assert.equal(
        "Save failed\nsettingsRecoveryFailed",
        BrowserToolboxSettingsErrorFormatter.format(error, { message }),
      );
    },
  );
});

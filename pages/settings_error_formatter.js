// 设置保存错误同时保留主失败原因和补偿失败提示，避免本地化时丢失恢复状态。
(function () {
  function format(error, { message, conflictDetails = [] }) {
    let text = error?.message || String(error);
    if (error?.code === "browser-toolbox-sync-quota") {
      text = message(error.quota === "total" ? "syncQuotaTotalExceeded" : "syncQuotaItemExceeded");
    } else if (error?.code === "browser-toolbox-settings-conflict") {
      text = [
        message("settingsConflict"),
        conflictDetails.length > 0
          ? `${message("settingsConflictFields")}: ${conflictDetails.join("; ")}`
          : "",
      ].filter(Boolean).join("\n");
    }
    if (error?.code === "CONFIGURATION_BACKUP_QUOTA") {
      text = message("configurationBackupQuota");
    } else if (error?.code === "CONFIGURATION_LOCAL_QUOTA") {
      text = message("configurationLocalQuota");
    } else if (error?.code === "CONFIGURATION_EXISTING_RULES_UNSUPPORTED") {
      const fields = Array.isArray(error.conflicts)
        ? error.conflicts.filter((field) => typeof field === "string").slice(0, 21)
        : [];
      text = [
        message("configurationExistingRulesProtected"),
        fields.length ? `${message("settingsConflictFields")}: ${fields.join(", ")}` : "",
      ].filter(Boolean).join("\n");
    } else if (
      /^(CONFIGURATION_|UNSUPPORTED_CONFIGURATION_|INCOMPLETE_CONFIGURATION_)/.test(
        error?.code || "",
      )
    ) {
      text = message(
        error.code.includes("CONFLICT") ? "configurationConflict" : "configurationUnavailable",
      );
    }
    if (error?.rollbackErrors?.length > 0) text += `\n${message("settingsRecoveryFailed")}`;
    return text;
  }

  globalThis.BrowserToolboxSettingsErrorFormatter = Object.freeze({ format });
})();

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
    if (error?.rollbackErrors?.length > 0) text += `\n${message("settingsRecoveryFailed")}`;
    return text;
  }

  globalThis.BrowserToolboxSettingsErrorFormatter = Object.freeze({ format });
})();

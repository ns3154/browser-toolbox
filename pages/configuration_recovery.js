// SPDX-License-Identifier: GPL-3.0-or-later
// 仅检查本机状态并在用户主动操作时下载脱敏摘要，不启动后台恢复。
(function () {
  const i18n = globalThis.BrowserToolboxI18n;
  const diagnostics = globalThis.BrowserToolboxRecoveryDiagnostics;
  const message = (key) => i18n.message(key);
  const records = {
    configuration: "recovery-configuration",
    legacyRollback: "recovery-rollback",
    syncPublish: "recovery-sync",
  };

  function recordText(record) {
    if (record.status === "absent") return message("recoveryStateAbsent");
    if (record.status === "unsupported") return message("recoveryStateUnsupported");
    if (record.status !== "present") return message("recoveryStateInvalid");
    const key = record.phase === "COMMITTED"
      ? "recoveryStateCommitted"
      : record.phase === "ABORTED"
      ? "recoveryStateAborted"
      : "recoveryStatePending";
    const text = message(key);
    return record.hasConflicts ? `${text} · ${message("recoveryConflictLabel")}` : text;
  }

  function render(report) {
    for (const [name, id] of Object.entries(records)) {
      document.getElementById(id).textContent = report.status === "available"
        ? recordText(report.records[name])
        : message("recoveryReadUnavailable");
    }
    document.getElementById("recovery-compatibility-conflicts").textContent =
      report.status === "available"
        ? message("recoveryCompatibilityConflictCount").replace(
          "$1",
          String(report.compatibilityConflictCount),
        )
        : message("recoveryReadUnavailable");
    document.getElementById("recovery-summary").textContent = message(
      report.status !== "available"
        ? "recoveryReadUnavailable"
        : report.transitionBlocksWrites
        ? "recoveryBlocked"
        : "recoveryNoBlock",
    );
  }

  function download(report) {
    const blob = new Blob([JSON.stringify(report, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = "browser-toolbox-diagnostics.json";
      link.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function conflictText(result, kind) {
    if (
      !result || result.kind !== kind || !["COMMITTED", "ABORTED"].includes(result.phase) ||
      result.writeAllowed !== false || result.releaseAllowed !== false ||
      result.lineageVerified !== false
    ) throw new Error("INVALID_CONFIGURATION_RECOVERY");
    const lines = [];
    if (kind === "legacy-rollback") {
      const labels = {
        unchanged: "recoveryConflictUnchanged",
        before: "recoveryConflictBefore",
        after: "recoveryConflictAfter",
        external: "recoveryConflictOther",
      };
      if (!result.fields || typeof result.fields !== "object" || Array.isArray(result.fields)) {
        throw new Error("INVALID_CONFIGURATION_RECOVERY");
      }
      let unchanged = 0;
      for (const [field, state] of Object.entries(result.fields).sort()) {
        if (!Object.hasOwn(labels, state)) throw new Error("INVALID_CONFIGURATION_RECOVERY");
        if (state === "unchanged") unchanged++;
        else lines.push(`${field}: ${message(labels[state])}`);
      }
      lines.push(`${message("recoveryConflictUnchanged")}: ${unchanged}`);
    } else {
      const labels = {
        absent: "recoveryConflictAbsent",
        matching: "recoveryConflictMatching",
        external: "recoveryConflictDifferent",
      };
      if (
        !Object.hasOwn(labels, result.index) || !result.chunks ||
        ![result.chunks.matching, result.chunks.absent, result.chunks.external].every((value) =>
          Number.isSafeInteger(value) && value >= 0
        ) || typeof result.syncBaseChanged !== "boolean" ||
        typeof result.localDomainChanged !== "boolean"
      ) throw new Error("INVALID_CONFIGURATION_RECOVERY");
      lines.push(`${message("recoveryConflictIndex")}: ${message(labels[result.index])}`);
      lines.push(
        `${
          message("recoveryConflictChunks")
        }: ${result.chunks.matching} / ${result.chunks.absent} / ${result.chunks.external}`,
      );
      lines.push(
        message(result.syncBaseChanged ? "recoveryOtherSyncChanged" : "recoveryOtherSyncSame"),
      );
      lines.push(message(result.localDomainChanged ? "recoveryLocalChanged" : "recoveryLocalSame"));
    }
    return lines.join("\n");
  }

  document.addEventListener("DOMContentLoaded", () => {
    i18n.apply(document);
    const inspectButton = document.getElementById("recovery-inspect");
    const exportButton = document.getElementById("recovery-export");
    const exportStatus = document.getElementById("recovery-export-status");
    const rollbackButton = document.getElementById("recovery-inspect-rollback-conflict");
    const syncButton = document.getElementById("recovery-inspect-sync-conflict");
    const conflictResult = document.getElementById("recovery-conflict-result");
    let busy = false;
    let lastReport = null;
    const terminal = (name) => {
      const record = lastReport?.records?.[name];
      return lastReport?.status === "available" && record?.status === "present" &&
        ["COMMITTED", "ABORTED"].includes(record.phase);
    };
    const updateControls = () => {
      inspectButton.disabled = exportButton.disabled = busy;
      rollbackButton.disabled = busy || !terminal("legacyRollback");
      syncButton.disabled = busy || !terminal("syncPublish");
    };
    const run = async (shouldExport = false) => {
      if (busy) return;
      busy = true;
      updateControls();
      document.querySelector(".recovery-card").setAttribute("aria-busy", "true");
      exportStatus.textContent = "";
      conflictResult.textContent = message("recoveryConflictSelect");
      delete conflictResult.dataset.status;
      try {
        let version = null;
        try {
          version = chrome.runtime.getManifest().version;
        } catch (_) {
          // 扩展版本不可读时仍允许导出不含版本的诊断。
        }
        const report = await diagnostics.inspect(globalThis.chrome?.storage?.local, version);
        lastReport = report;
        render(report);
        if (shouldExport) {
          download(report);
          exportStatus.textContent = message("recoveryExported");
        }
      } catch (_) {
        lastReport = null;
        if (shouldExport) exportStatus.textContent = message("recoveryExportFailed");
        else render({ status: "unavailable" });
      } finally {
        busy = false;
        updateControls();
        document.querySelector(".recovery-card").removeAttribute("aria-busy");
      }
    };
    const inspectConflict = async (kind) => {
      if (busy) return;
      busy = true;
      updateControls();
      conflictResult.dataset.status = "loading";
      conflictResult.textContent = message("recoveryConflictLoading");
      let timeout;
      try {
        const response = await Promise.race([
          chrome.runtime.sendMessage({
            handler: "browserToolbox.configuration",
            action: "inspect-transition-conflict",
            input: { kind },
          }),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("CONFIGURATION_UNAVAILABLE")), 5000);
          }),
        ]);
        if (!response?.ok) throw new Error("CONFIGURATION_UNAVAILABLE");
        conflictResult.textContent = conflictText(response.value, kind);
        conflictResult.dataset.status = "ready";
      } catch (_) {
        conflictResult.textContent = message("recoveryConflictUnavailable");
        conflictResult.dataset.status = "error";
      } finally {
        clearTimeout(timeout);
        busy = false;
        updateControls();
      }
    };
    inspectButton.addEventListener("click", () => run());
    exportButton.addEventListener("click", () => run(true));
    rollbackButton.addEventListener("click", () => inspectConflict("legacy-rollback"));
    syncButton.addEventListener("click", () => inspectConflict("keyboard-sync-publish"));
    globalThis.BrowserToolboxTheme?.applyStoredTheme?.(document);
    globalThis.BrowserToolboxTheme?.watchTheme?.(document);
    run();
  });
})();

// SPDX-License-Identifier: GPL-3.0-or-later
// 所有设置页面共用后台配置入口；读请求可去重，有副作用的提交不自动重发。
(function () {
  class ConfigurationClient {
    constructor(runtime = globalThis.chrome?.runtime) {
      this.runtime = runtime;
    }

    get enabled() {
      return Boolean(globalThis.BrowserToolboxConfigurationWriterInstance) ||
        typeof this.runtime?.id === "string" && !globalThis.isUnitTests &&
          !globalThis.vimiumDomTestsAreRunning;
    }

    async request(action, input = {}) {
      const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
      if (writer) {
        if (action === "read") return writer.read(input.minimumRevision || 0);
        if (action === "preview") return writer.preview();
        if (action === "export-conflict") return writer.exportCompatibilityConflict();
        if (action === "list-conflict-observations") {
          return writer.listCompatibilityConflictObservations();
        }
        if (action === "export-conflict-observation") {
          return writer.exportCompatibilityConflictObservation(input.key);
        }
        if (action === "capture-conflict-observation") {
          return writer.captureCurrentCompatibilityConflict();
        }
        if (action === "review-conflict-observation") {
          return writer.reviewCompatibilityConflictObservation(input.key);
        }
        if (action === "prepare-conflict-candidate") {
          return writer.prepareCompatibilityConflictCandidate(
            input.key,
            input.recordDigest,
            input.choices,
          );
        }
        if (action === "resolve") return writer.resolve(input.choice);
        if (action === "rollback") return writer.rollback();
        if (action === "export") return writer.exportConfiguration();
        if (action === "commit") return writer.commit(input);
        if (action === "import") return writer.importConfiguration(input);
        if (action === "list-import-backups") return writer.listImportBackups();
        if (action === "export-import-backup") return writer.exportImportBackup(input.key);
        if (action === "export-import-cursor") return writer.exportImportBackupCursor(input.key);
        if (action === "list-local-cursors") {
          return writer.listLocalCursorAssets(input.after ?? null);
        }
        if (action === "read-local-cursor") return writer.readLocalCursorAsset(input.key);
        if (action === "preview-import-restore") {
          return writer.previewImportBackupRestore(input.key);
        }
        throw new Error("INVALID_CONFIGURATION_ACTION");
      }
      let response;
      try {
        response = await this.runtime.sendMessage({
          handler: "browserToolbox.configuration",
          action,
          input,
        });
      } catch (failure) {
        const store = globalThis.BrowserToolboxConfigurationStore;
        if (action !== "export" || !store?.exportStoredConfiguration) throw failure;
        return store.exportStoredConfiguration({
          local: chrome.storage.local,
          defaults: Settings.defaultOptions,
          validateToolbox: (value) => BrowserToolboxSettingsValidator.assertValid(value),
        });
      }
      if (!response?.ok) {
        const error = new Error(response?.code || "CONFIGURATION_UNAVAILABLE");
        for (const key of ["code", "conflicts", "quota", "requiredBytes", "limitBytes"]) {
          if (response?.[key] != null) error[key] = response[key];
        }
        throw error;
      }
      return response.value;
    }

    read() {
      return this.request("read", { minimumRevision: this.minimumRevision || 0 });
    }

    commit(input) {
      return this.request("commit", input);
    }

    importConfiguration(input) {
      return this.request("import", input);
    }
  }
  globalThis.BrowserToolboxConfigurationClient = ConfigurationClient;
  globalThis.BrowserToolboxConfigurationClientInstance ||= new ConfigurationClient();
})();

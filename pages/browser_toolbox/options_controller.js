// SPDX-License-Identifier: GPL-3.0-or-later
import "../../lib/types.js";
import "../../lib/utils.js";
import "../../lib/keyboard_utils.js";
import "../../lib/settings.js";
import "../../lib/browser_toolbox/configuration_client.js";
import "../../lib/i18n.js";
import "../../lib/browser_toolbox/value_utils.js";
import "../../background_scripts/browser_toolbox/settings_storage.js";
import "../settings_error_formatter.js";
import {
  bindOptionsForm,
  getSettingsFromForm,
  maintainNewTabUrlView,
  setFormFromSettings,
  showValidationErrors,
} from "../options_form.js";
import {
  formatLegacyBackupFields,
  formatLegacyBackupPreview,
  inspectLegacyBackup,
  serializeLegacyBackup,
} from "./legacy_settings_backup.js";

export async function startOptionsController() {
  const client = BrowserToolboxConfigurationClientInstance;
  const save = document.querySelector("#save");
  const form = document.querySelector("#settings-grid-container");
  const download = document.querySelector("#download-backup");
  const upload = document.querySelector("#upload-backup");
  const status = document.createElement("div");
  status.id = "browser-toolbox-options-status";
  status.setAttribute("role", "status");
  save.before(status);
  const message = (key) => BrowserToolboxI18n.message(key);
  let baseline;
  let dirty = false;
  let busy = true;
  let downloadUrl;

  function setState(label) {
    form.inert = busy || !baseline;
    save.disabled = busy || !dirty || !baseline;
    save.textContent = message(label);
  }

  function showError(error) {
    if (
      ["UNSUPPORTED_LEGACY_BACKUP_RULE_FIELDS", "INVALID_LEGACY_BACKUP_FIELDS"].includes(
        error?.code,
      )
    ) {
      status.textContent = formatLegacyBackupFields(error, message);
      return;
    }
    status.textContent = BrowserToolboxSettingsErrorFormatter.format(error, {
      message,
      conflictDetails: error?.conflicts?.flatMap((item) => item.paths || [item]) || [],
    });
  }

  async function commit(getPatch, { beforeImport = false } = {}) {
    if (busy || !baseline) return;
    const preserveDraft = beforeImport && dirty;
    busy = true;
    status.textContent = "";
    setState("saving");
    try {
      // 导入应以确认前最新已提交值为基线，表单草稿仍保留自己的旧基线。
      const commitBaseline = beforeImport ? await client.read() : baseline;
      const legacyPatch = await getPatch();
      if (legacyPatch === null) return;
      const input = {
        legacyPatch,
        baseline: { keyboard: commitBaseline.keyboard, revision: commitBaseline.revision },
      };
      const result =
        await (beforeImport ? client.importConfiguration(input) : client.commit(input));
      if (preserveDraft) {
        // 导入后的提交状态与旧表单基线分开，后续保存仍可检测同字段冲突。
        status.textContent = message("importSavedWithDraft");
      } else {
        setFormFromSettings(result.keyboard);
        baseline = result;
        dirty = false;
        status.textContent = message("saved");
      }
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
      setState(
        dirty ? "saveChanges" : status.textContent === message("saved") ? "saved" : "noChanges",
      );
    }
  }

  function saveForm() {
    if (!dirty || busy || showValidationErrors({ reveal: true })) return;
    const { settingsVersion: _version, ...values } = getSettingsFromForm();
    return commit(() => values);
  }

  form.inert = true;
  try {
    await BrowserToolboxI18n.applyStoredLocale(document);
    document.querySelector("#shortcut-to-save-all").textContent = KeyboardUtils.platform === "Mac"
      ? "Cmd-Enter"
      : "Ctrl-Enter";
    const snapshot = await client.read();
    setFormFromSettings(snapshot.keyboard);
    baseline = snapshot;
  } catch (error) {
    showError(error);
    return;
  }

  bindOptionsForm(() => {
    maintainNewTabUrlView();
    dirty = true;
    status.textContent = "";
    setState("saveChanges");
  });
  save.addEventListener("click", saveForm);
  document.addEventListener("keydown", (event) => {
    if (
      event.isComposing || event.keyCode === 229 || event.repeat ||
      event.key !== "Enter" || !(event.metaKey || event.ctrlKey)
    ) return;
    event.preventDefault();
    saveForm();
  }, true);
  globalThis.addEventListener("beforeunload", (event) => {
    if (dirty || busy) event.preventDefault();
  });
  download.addEventListener("click", () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(
      new Blob([serializeLegacyBackup(getSettingsFromForm())], {
        type: "application/json",
      }),
    );
    download.href = downloadUrl;
  });
  upload.addEventListener("change", () => {
    const file = upload.files[0];
    upload.value = "";
    if (file) {
      commit(async () => {
        try {
          if (file.size > 1024 * 1024) throw new Error();
          const report = inspectLegacyBackup(await file.text());
          if (!globalThis.confirm(formatLegacyBackupPreview(report, message))) return null;
          return report.patch;
        } catch (failure) {
          if (
            ["UNSUPPORTED_LEGACY_BACKUP_RULE_FIELDS", "INVALID_LEGACY_BACKUP_FIELDS"].includes(
              failure?.code,
            )
          ) {
            throw failure;
          }
          throw new Error(message("invalidSettings"));
        }
      }, { beforeImport: true });
    }
  });
  busy = false;
  setState("noChanges");
}

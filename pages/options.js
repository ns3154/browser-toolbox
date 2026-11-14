import "./all_content_scripts.js";
import "../lib/browser_toolbox/theme.js";
import "./settings_error_formatter.js";
import { Commands } from "../background_scripts/commands.js";
import {
  bindOptionsForm,
  getOptionEl,
  getSettingsFromForm,
  maintainNewTabUrlView,
  setFormFromSettings,
  showValidationErrors,
} from "./options_form.js";
import {
  formatLegacyBackupFields,
  formatLegacyBackupPreview,
  inspectLegacyBackup,
  serializeLegacyBackup,
} from "./browser_toolbox/legacy_settings_backup.js";

export { getOptionEl };

let formBaseline = null;
let formEditVersion = 0;
let formDirty = false;
let saveInProgress = false;

export async function init() {
  await Settings.onLoaded();
  await BrowserToolboxI18n.applyStoredLocale(document);
  await globalThis.BrowserToolboxTheme?.applyStoredTheme?.(document);
  globalThis.BrowserToolboxTheme?.watchTheme?.(document);

  const shortcutLabel = document.querySelector("#shortcut-to-save-all");
  shortcutLabel.textContent = KeyboardUtils.platform == "Mac" ? "Cmd-Enter" : "Ctrl-Enter";

  const saveButton = document.querySelector("#save");

  const onUpdated = () => {
    formEditVersion++;
    formDirty = true;
    maintainNewTabUrlView();
    saveButton.disabled = saveInProgress;
    if (!saveInProgress) saveButton.textContent = "Save changes";
  };

  saveButton.addEventListener("click", () => saveOptions());

  document.querySelector("#download-backup").addEventListener(
    "click",
    () => onDownloadBackupClicked(),
    true,
  );
  document.querySelector("#upload-backup").addEventListener(
    "change",
    (event) => onUploadBackupClicked(event),
  );

  globalThis.onbeforeunload = () => {
    if (saveInProgress || formDirty) {
      return "You have unsaved changes to options.";
    }
  };

  document.addEventListener("keydown", (event) => {
    // Firefox on Mac doesn't pass ctrl-enter to our page because MacOS Sequoia treats it as a
    // shortcut for right click; typing it shows a context menu. So, we also allow cmd-enter to save
    // all options. Note that ctrl-enter still works on Chrome for some reason.
    const isCtrlEnter = event.ctrlKey && event.keyCode === 13;
    const isCmdEnter = event.metaKey && event.keyCode === 13;
    if (isCtrlEnter || isCmdEnter) {
      saveOptions();
    }
  });

  bindOptionsForm(onUpdated);
  formBaseline = Settings.getSettings();
  setFormFromSettings(formBaseline);
  formDirty = false;
}

export async function saveOptions() {
  if (saveInProgress) return;
  const hasErrors = showValidationErrors({ reveal: true });
  if (hasErrors) {
    return;
  }

  const submitted = getSettingsFromForm();
  const baseline = structuredClone(formBaseline || Settings.getSettings());
  const submittedVersion = formEditVersion;
  const button = document.querySelector("#save");
  const upload = document.querySelector("#upload-backup");
  saveInProgress = true;
  button.disabled = true;
  upload.disabled = true;
  button.textContent = BrowserToolboxI18n.message("saving");
  try {
    const configuration = globalThis.BrowserToolboxConfigurationClientInstance;
    await Settings.setSettings(submitted, configuration?.enabled ? { baseline } : {});
    if (formEditVersion === submittedVersion) {
      formBaseline = Settings.getSettings();
      setFormFromSettings(formBaseline);
      formDirty = false;
      button.disabled = true;
      button.textContent = "Saved";
    } else {
      // 保存期间的新输入保留在表单中，下一次合并应以本次提交值为基线。
      formBaseline = { ...baseline, ...structuredClone(submitted) };
      formDirty = true;
      button.disabled = false;
      button.textContent = "Save changes";
    }
  } catch (failure) {
    const known =
      /^(browser-toolbox-settings-conflict|browser-toolbox-sync-quota|CONFIGURATION_|UNSUPPORTED_CONFIGURATION_|INCOMPLETE_CONFIGURATION_)/
        .test(failure?.code || "");
    const message = known
      ? BrowserToolboxSettingsErrorFormatter.format(failure, {
        message: BrowserToolboxI18n.message,
        conflictDetails: failure?.conflicts?.flatMap((item) => item.paths || [item]) || [],
      })
      : BrowserToolboxI18n.message("configurationUnavailable");
    button.disabled = false;
    button.textContent = "Save changes";
    formDirty = true;
    alert(message);
  } finally {
    saveInProgress = false;
    upload.disabled = false;
  }
}

export function prepareBackupSettings() {
  return serializeLegacyBackup(getSettingsFromForm());
}

function onDownloadBackupClicked() {
  const settings = prepareBackupSettings();
  const blob = new Blob([settings]);
  document.querySelector("#download-backup").href = URL.createObjectURL(blob);
}

function onUploadBackupClicked(event) {
  if (saveInProgress) {
    event.target.value = "";
    return;
  }
  if (document.activeElement) {
    document.activeElement.blur();
  }

  const files = event.target.files;
  if (files.length === 1) {
    const file = files[0];
    const button = document.querySelector("#save");
    let imported = false;
    saveInProgress = true;
    button.disabled = true;
    button.textContent = BrowserToolboxI18n.message("saving");
    event.target.disabled = true;
    const finish = () => {
      saveInProgress = false;
      event.target.value = "";
      event.target.disabled = false;
      button.disabled = !formDirty;
      button.textContent = formDirty ? "Save changes" : imported ? "Saved" : "No changes";
    };
    const reader = new FileReader();
    reader.onerror = () => {
      alert(BrowserToolboxI18n.message("invalidSettings"));
      finish();
    };
    reader.onload = async () => {
      try {
        const report = inspectLegacyBackup(reader.result);
        const baseline = Settings.getSettings();
        if (!globalThis.confirm(formatLegacyBackupPreview(report, BrowserToolboxI18n.message))) {
          return;
        }
        await Settings.setSettings({
          ...report.patch,
          settingsVersion: baseline.settingsVersion,
        }, { baseline, beforeImport: true });
        imported = true;
        if (!formDirty) {
          formBaseline = Settings.getSettings();
          setFormFromSettings(formBaseline);
        }
        alert(
          formDirty
            ? BrowserToolboxI18n.message("importSavedWithDraft")
            : "Settings have been restored from the backup.",
        );
      } catch (failure) {
        const message =
          ["UNSUPPORTED_LEGACY_BACKUP_RULE_FIELDS", "INVALID_LEGACY_BACKUP_FIELDS"].includes(
              failure?.code,
            )
            ? formatLegacyBackupFields(failure, BrowserToolboxI18n.message)
            : /^(browser-toolbox-settings-conflict|browser-toolbox-sync-quota|CONFIGURATION_|UNSUPPORTED_CONFIGURATION_|INCOMPLETE_CONFIGURATION_)/
                .test(failure?.code || "")
            ? BrowserToolboxSettingsErrorFormatter.format(failure, {
              message: BrowserToolboxI18n.message,
              conflictDetails: failure?.conflicts?.flatMap((item) => item.paths || [item]) || [],
            })
            : BrowserToolboxI18n.message("invalidSettings");
        alert(message);
      } finally {
        finish();
      }
    };
    reader.readAsText(file);
  }
}

export async function startOptionsPage() {
  await Settings.onLoaded();
  DomUtils.injectUserCss();
  await Commands.init();
  await init();
}

const testEnv = globalThis.window == null ||
  globalThis.window.location.search.includes("dom_tests=true");
if (!testEnv) {
  document.addEventListener("DOMContentLoaded", startOptionsPage);
}

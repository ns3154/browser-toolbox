import "../lib/utils.js";
import "../lib/dom_utils.js";
import "../lib/settings.js";
import "../lib/i18n.js";
import "../lib/open_key_mouse/command_invocation.js";
import "../lib/open_key_mouse/message_protocol.js";
import "../lib/open_key_mouse/settings_schema.js";
import "../lib/open_key_mouse/settings_validator.js";
import "../lib/open_key_mouse/site_rule_matcher.js";
import "../background_scripts/open_key_mouse/settings_migrations.js";
import "../background_scripts/open_key_mouse/settings_repository.js";

import * as bgUtils from "../background_scripts/bg_utils.js";
import { ExclusionRulesEditor } from "./exclusion_rules_editor.js";

const ActionPage = {
  async init() {
    OpenKeyMouseI18n.apply(document);
    // Is it possible for the current tab's URL to change while this action popup is open?
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    this.tabUrl = activeTab.url;
    await this.initOpenKeyMouseControls(activeTab);

    const hideUI = () => {
      document.querySelector("#dialog-body").style.display = "none";
      document.querySelector("footer").style.display = "none";
    };

    // In Firefox, prompt the user if they haven't enabled the "all hosts" permission. Vimium needs
    // this permission to work correctly, and as of 2023-11-06, Firefox does not grant this
    // permission without user consent, and doesn't make it clear that the user needs to do
    // anything. See #4348 for discussion, and https://stackoverflow.com/q/76083327 for
    // implementation notes.
    const permission = { origins: ["<all_urls>"] };
    if (bgUtils.isFirefox()) {
      const hasAllHostsPermission = await browser.permissions.contains(permission);
      if (!hasAllHostsPermission) {
        hideUI();
        document.querySelector("#grant-hosts-permission").addEventListener("click", async (e) => {
          browser.permissions.request(permission);
          // We close the action page because if the user clicks on this button once, clicks "deny"
          // on the browser's permissions dialog, and then clicks on the button a second time, the
          // browser permissions dialog will now be shown *under* the action page!
          globalThis.close();
        });
        document.querySelector("#firefox-missing-permissions-error").style.display = "block";
        return;
      }
    }

    if (!await this.isVimiumInstalledInTab(activeTab.id)) {
      hideUI();
      document.querySelector("#not-enabled-error").style.display = "block";
      return;
    }

    document.querySelector("#optionsLink").href = chrome.runtime.getURL("pages/options.html");

    const saveButton = document.querySelector("#save");
    saveButton.addEventListener("click", (e) => this.onSave());

    document.querySelector("#cancel").addEventListener("click", () => globalThis.close());

    const onUpdated = () => {
      saveButton.disabled = false;
      saveButton.textContent = "Save changes";
      this.syncEnabledKeysCaption();
      this.showValidationErrors();
    };

    const defaultPatternForNewRules = this.generateDefaultPattern(this.tabUrl);

    document.querySelector("#add-first-rule").addEventListener(
      "click",
      () => {
        ExclusionRulesEditor.addRow(defaultPatternForNewRules);
        this.showExclusionRulesEditor();
        onUpdated();
      },
    );

    ExclusionRulesEditor.defaultPatternForNewRules = defaultPatternForNewRules;
    ExclusionRulesEditor.init();
    ExclusionRulesEditor.addEventListener("input", onUpdated);
    const rules = Settings.get("exclusionRules").filter((r) =>
      this.tabUrl.match(this.getPatternRegExp(r.pattern))
    );
    ExclusionRulesEditor.setForm(rules);
    this.syncEnabledKeysCaption();

    if (rules.length > 0) this.showExclusionRulesEditor();
  },

  async initOpenKeyMouseControls(activeTab) {
    const container = document.querySelector("#open-key-mouse-controls");
    if (!container || !activeTab) return;
    const repository = globalThis.OpenKeyMouseSettingsRepositoryInstance;
    await repository.ensureLoaded();
    const settings = repository.getEffectiveSettings(activeTab.url || "");
    OpenKeyMouseI18n.setLocale(settings.general.language);
    OpenKeyMouseI18n.apply(document);
    const modules = settings.effectiveModules || {};
    container.style.display = "block";
    document.querySelector("#okm-settings-link").href = chrome.runtime.getURL(
      "pages/mouse_options.html",
    );
    const status = document.querySelector("#open-key-mouse-site-status");
    status.textContent = modules.enabled === false
      ? (OpenKeyMouseI18n.message("disabled"))
      : OpenKeyMouseI18n.message("allModulesEnabled");
    const controls = [
      ["#okm-toggle-keyboard", "keyboard", "OpenKeyMouse.toggleKeyboard"],
      ["#okm-toggle-mouse", "mouse", "OpenKeyMouse.toggleMouseGestures"],
      ["#okm-toggle-drag", "superDrag", "OpenKeyMouse.toggleSuperDrag"],
      ["#okm-toggle-wheel", "wheel", null],
    ];
    for (const [selector, moduleName, commandName] of controls) {
      const input = document.querySelector(selector);
      input.checked = modules[moduleName] !== false;
      input.addEventListener("change", async () => {
        if (commandName) {
          const invocation = OpenKeyMouseCommandInvocation.createInvocation(
            commandName,
            {},
            { type: "ui" },
            { tabId: activeTab.id, pageUrl: activeTab.url || "", topFrame: true },
          );
          await chrome.runtime.sendMessage({ handler: "openKeyMouse.invoke", invocation });
        } else {
          await repository.setSessionOverrides(Object.assign({}, repository.sessionOverrides, {
            wheel: input.checked,
          }));
        }
        const refreshed = repository.getEffectiveSettings(activeTab.url || "");
        status.textContent = refreshed.effectiveModules?.[moduleName] === false
          ? OpenKeyMouseI18n.message("disabled")
          : OpenKeyMouseI18n.message("enabled");
      });
    }
    document.querySelector("#okm-disable-session").addEventListener("click", async () => {
      await repository.setSessionOverrides({
        enabled: false,
        keyboard: false,
        mouse: false,
        superDrag: false,
        wheel: false,
        rocker: false,
        cursor: false,
      });
      for (const [selector] of controls) document.querySelector(selector).checked = false;
      status.textContent = OpenKeyMouseI18n.message("disabled");
    });
  },

  async isVimiumInstalledInTab(tabId) {
    try {
      // There is no handler in our content script for this message, but that's OK. We just want to
      // see if sending any message triggers an error.
      await chrome.tabs.sendMessage(tabId, { handler: "isVimiumInstalledInTab" });
      return true;
    } catch {
      // If there's no content script running in the activeTab, we'll get a connection error.
      return false;
    }
  },

  showValidationErrors() {
    const rows = document.querySelectorAll(".rule");
    for (const row of rows) {
      const pattern = row.querySelector("input[name=pattern]").value;
      const regExp = this.getPatternRegExp(pattern);
      const validationEl = row.querySelector(".validationMessage");
      const patternMatchesUrl = this.tabUrl.match(regExp);
      if (patternMatchesUrl) {
        row.classList.remove("validationError");
        validationEl.textContent = "";
      } else {
        row.classList.add("validationError");
        validationEl.textContent = "Pattern does not match the current URL";
      }
    }
  },

  showExclusionRulesEditor() {
    document.querySelector("#exclusions-container").style.display = "block";
    document.querySelector("#add-first-rule-container").style.display = "none";
  },

  syncEnabledKeysCaption() {
    let caption = "All";
    const rules = ExclusionRulesEditor.getRules();
    if (rules.length > 0) {
      const hasBlankPassKeysRule = rules.find((r) => r.passKeys.length == 0);
      caption = hasBlankPassKeysRule ? "No" : "Some";
    }
    document.querySelector("#how-many-enabled").textContent = caption;
  },

  async onSave() {
    let rules = await Settings.get("exclusionRules");
    // Remove any rules which match the current URL, and replace them with the contents of this dialog.
    rules = rules.filter((r) => !this.tabUrl.match(this.getPatternRegExp(r.pattern)));
    rules = rules.concat(ExclusionRulesEditor.getRules());
    Settings.set("exclusionRules", rules);
    const el = document.querySelector("#save");
    el.disabled = true;
    el.textContent = "Saved";
  },

  getPatternRegExp(patternStr) {
    return new RegExp("^" + patternStr.replace(/\*/g, ".*") + "$");
  },

  // Returns an exclusion pattern which matches the domain of the given URL.
  // This is used as the default starter pattern when the "Add rule" button is clicked.
  generateDefaultPattern(url) {
    if (/^https?:\/\/./.test(url)) {
      // The common use case is to disable Vimium at the domain level.
      // Generate "https?://www.example.com/*" from "http://www.example.com/path/to/page.html".
      // Note: IPV6 host addresses will contain "[" and "]" (which must be escaped).
      const hostname = url.split("/", 3).slice(1).join("/").replace("[", "\\[").replace(
        "]",
        "\\]",
      );
      return "https?:/" + hostname + "/*";
    } else if (/^[a-z]{3,}:\/\/./.test(url)) {
      // Anything else which seems to be a URL.
      return url.split("/", 3).join("/") + "/*";
    } else {
      return url + "*";
    }
  },
};

document.addEventListener("DOMContentLoaded", async () => {
  await Settings.onLoaded();
  ActionPage.init();
});

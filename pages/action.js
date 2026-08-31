import "../lib/utils.js";
import "../lib/dom_utils.js";
import "../lib/settings.js";
import "../lib/i18n.js";
import "../lib/browser_toolbox/value_utils.js";
import "../lib/browser_toolbox/tools/tool_contract.js";
import "../lib/browser_toolbox/tools/tool_registry.js";
import "../lib/browser_toolbox/tools/tool_registry_validator.js";
import "../lib/browser_toolbox/tools/tool_icons.js";
import "../lib/browser_toolbox/command_invocation.js";
import "../lib/browser_toolbox/message_protocol.js";
import "../lib/browser_toolbox/settings_schema.js";
import "../lib/browser_toolbox/regex_safety.js";
import "../lib/browser_toolbox/module_registry.js";
import "../lib/browser_toolbox/settings_validator.js";
import "../lib/browser_toolbox/site_rule_matcher.js";
import "../lib/browser_toolbox/settings_policy.js";
import "../background_scripts/browser_toolbox/settings_migrations.js";
import "../background_scripts/browser_toolbox/settings_storage.js";
import "../background_scripts/browser_toolbox/vimium_settings_adapter.js";
import "../background_scripts/browser_toolbox/settings_repository.js";

import * as bgUtils from "../background_scripts/bg_utils.js";

const vimiumSettings = globalThis.BrowserToolboxVimiumSettingsAdapterInstance;
const moduleRegistry = globalThis.BrowserToolboxModuleRegistry;
const toolRegistry = globalThis.BrowserToolboxToolRegistry;

const ActionPage = {
  async init() {
    await this.loadLocalePreference();
    BrowserToolboxI18n.apply(document);
    this.renderIcons();
    // Is it possible for the current tab's URL to change while this action popup is open?
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    this.tabUrl = activeTab?.url || "";
    this.setStaticPageLinks();
    await this.initToolControls(activeTab);

    const hideUI = () => {
      document.querySelector("#browser-toolbox-controls").style.display = "none";
      document.querySelector("#browser-toolbox-enhancement-summary").style.display = "none";
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

    if (!activeTab || !await this.isVimiumInstalledInTab(activeTab.id)) {
      hideUI();
      document.querySelector("#not-enabled-error").style.display = "block";
      return;
    }

    await this.initBrowserToolboxControls(activeTab);
  },

  async loadLocalePreference() {
    try {
      const locale = await globalThis.BrowserToolboxSettingsRepositoryInstance.getStoredLocale();
      BrowserToolboxI18n.setLocale(locale);
    } catch (_) {
      // 存储不可用时继续使用浏览器界面语言，不影响动作页打开。
    }
  },

  setStaticPageLinks() {
    const settingsUrl = chrome.runtime.getURL("pages/mouse_options.html");
    const toolsUrl = chrome.runtime.getURL("pages/mouse_options.html#toolsOverview");
    for (
      const selector of ["#browser-toolbox-settings-link", "#browser-toolbox-settings-footer-link"]
    ) {
      const link = document.querySelector(selector);
      if (link) link.href = settingsUrl;
    }
    const toolSettingsLink = document.querySelector("#browser-toolbox-tool-settings-link");
    if (toolSettingsLink) toolSettingsLink.href = toolsUrl;
  },

  renderIcons() {
    const iconFactory = globalThis.BrowserToolboxToolIcons;
    if (!iconFactory?.createIcon) return;
    for (const slot of document.querySelectorAll("[data-toolbox-icon]")) {
      const icon = iconFactory.createIcon(slot.dataset.toolboxIcon, {
        className: "browser-toolbox-ui-icon",
      });
      slot.replaceChildren(icon);
    }
  },

  async initBrowserToolboxControls(activeTab) {
    const container = document.querySelector("#browser-toolbox-controls");
    if (!container || !activeTab) return;
    const repository = globalThis.BrowserToolboxSettingsRepositoryInstance;
    await repository.ensureLoaded();
    const settings = repository.getEffectiveSettings(activeTab.url || "");
    BrowserToolboxI18n.setLocale(settings.general.language);
    BrowserToolboxI18n.apply(document);
    container.style.display = "block";
    document.querySelector("#browser-toolbox-enhancement-summary").style.display = "block";
    this.setStaticPageLinks();
    document.querySelector("#browser-toolbox-all-tools")?.addEventListener("click", async () => {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("pages/mouse_options.html#toolsOverview"),
      });
      globalThis.close();
    });
    document.querySelector("#browser-toolbox-open-help")?.addEventListener(
      "click",
      async () => {
        try {
          // 复用现有的顶层 showHelp 路由，让帮助页在当前网页中正确建立 UIComponent 通道。
          await chrome.tabs.sendMessage(
            activeTab.id,
            {
              handler: "runInTopFrame",
              sourceFrameId: 0,
              registryEntry: { command: "showHelp", options: {} },
            },
            { frameId: 0 },
          );
        } finally {
          globalThis.close();
        }
      },
    );
    const status = document.querySelector("#browser-toolbox-site-status");
    const siteBadge = document.querySelector("#browser-toolbox-site-badge");
    const disableSessionButton = document.querySelector("#browser-toolbox-disable-session");
    let statusError = "";
    const controls = [
      ["#browser-toolbox-toggle-keyboard", "keyboard", "BrowserToolbox.toggleKeyboard"],
      ["#browser-toolbox-toggle-mouse", "mouse", "BrowserToolbox.toggleMouseGestures"],
      ["#browser-toolbox-toggle-drag", "superDrag", "BrowserToolbox.toggleSuperDrag"],
      ["#browser-toolbox-toggle-wheel", "wheel", null],
    ];
    const renderStatus = (effectiveSettings) => {
      const effectiveModules = effectiveSettings?.effectiveModules || {};
      const disabled = moduleRegistry.entries({ siteRule: true })
        .filter((module) => effectiveModules[module.id] === false)
        .map((module) => BrowserToolboxI18n.message(module.labelKey));
      const pageEnabled = effectiveModules.enabled !== false;
      const sessionDisabled = repository.sessionOverrides?.enabled === false;
      if (status) {
        status.textContent = statusError ||
          (disabled.length > 0
            ? `${BrowserToolboxI18n.message("siteRuleDisabledModules")}: ${disabled.join(", ")}`
            : BrowserToolboxI18n.message("allModulesEnabled"));
      }
      if (siteBadge) {
        siteBadge.textContent = BrowserToolboxI18n.message(pageEnabled ? "active" : "inactive");
        siteBadge.classList.toggle("is-disabled", !pageEnabled);
      }
      if (disableSessionButton && disableSessionButton.dataset.busy !== "true") {
        disableSessionButton.disabled = sessionDisabled;
        disableSessionButton.textContent = BrowserToolboxI18n.message(
          sessionDisabled ? "sessionDisabled" : "disableForSession",
        );
        disableSessionButton.removeAttribute("aria-busy");
      }
      for (const [selector, moduleName] of controls) {
        const input = document.querySelector(selector);
        if (!input) continue;
        const enabled = moduleName === "wheel"
          ? effectiveModules.wheel !== false && effectiveModules.rocker !== false
          : effectiveModules[moduleName] !== false;
        input.checked = enabled;
        const statusLabel = input.closest(".browser-toolbox-enhancement-card")?.querySelector(
          ".browser-toolbox-module-status",
        );
        if (statusLabel) {
          statusLabel.textContent = BrowserToolboxI18n.message(enabled ? "enabled" : "disabled");
          statusLabel.classList.toggle("is-disabled", !enabled);
        }
      }
    };
    renderStatus(settings);
    repository.addEventListener(() =>
      renderStatus(repository.getEffectiveSettings(activeTab.url || ""))
    );
    for (const [selector, moduleName, commandName] of controls) {
      const input = document.querySelector(selector);
      input.addEventListener("change", async () => {
        let reportedEnabled;
        if (commandName) {
          const invocation = BrowserToolboxCommandInvocation.createInvocation(
            commandName,
            {},
            { type: "ui" },
            { tabId: activeTab.id, pageUrl: activeTab.url || "", topFrame: true },
          );
          const result = await chrome.runtime.sendMessage({
            handler: "browserToolbox.invoke",
            invocation,
          });
          if (typeof result?.data?.enabled === "boolean") reportedEnabled = result.data.enabled;
        } else {
          const enabled = input.checked;
          await repository.setSessionOverrides(Object.assign({}, repository.sessionOverrides, {
            wheel: enabled,
            rocker: enabled,
          }));
        }
        const refreshed = repository.getEffectiveSettings(activeTab.url || "");
        if (typeof reportedEnabled === "boolean") {
          refreshed.effectiveModules[moduleName] = reportedEnabled;
          if (moduleName === "wheel") refreshed.effectiveModules.rocker = reportedEnabled;
        }
        renderStatus(refreshed);
        const moduleEnabled = moduleName === "wheel"
          ? refreshed.effectiveModules?.wheel !== false &&
            refreshed.effectiveModules?.rocker !== false
          : refreshed.effectiveModules?.[moduleName] !== false;
        const actualEnabled = reportedEnabled ?? moduleEnabled;
        input.checked = actualEnabled;
      });
    }
    disableSessionButton.addEventListener(
      "click",
      async () => {
        if (disableSessionButton.dataset.busy === "true") return;
        statusError = "";
        disableSessionButton.dataset.busy = "true";
        disableSessionButton.disabled = true;
        disableSessionButton.setAttribute("aria-busy", "true");
        disableSessionButton.textContent = BrowserToolboxI18n.message("disabling");
        try {
          await repository.setSessionOverrides({
            enabled: false,
            keyboard: false,
            mouse: false,
            superDrag: false,
            wheel: false,
            rocker: false,
            cursor: false,
          });
        } catch (error) {
          statusError = BrowserToolboxI18n.message("sessionDisableFailed");
          console.error("BrowserToolbox: failed to disable the current session", error);
        } finally {
          delete disableSessionButton.dataset.busy;
          renderStatus(repository.getEffectiveSettings(activeTab.url || ""));
        }
      },
    );
  },

  async initToolControls(activeTab) {
    const panel = document.querySelector("#browser-toolbox-tools");
    const buttons = document.querySelector("#browser-toolbox-tool-buttons");
    if (!panel || !buttons) return;
    const repository = globalThis.BrowserToolboxSettingsRepositoryInstance;
    let settings;
    try {
      await repository.ensureLoaded();
      settings = repository.getSettings();
    } catch (_) {
      settings = globalThis.BrowserToolboxSettingsSchema.DEFAULT_SETTINGS;
    }
    if (settings.tools?.enabled === false) return;
    const configured = settings.tools?.pinnedIds || toolRegistry.DEFAULT_ACTION_TOOL_IDS;
    buttons.replaceChildren();
    for (const toolId of configured.slice(0, 6)) {
      const descriptor = toolRegistry.get(toolId);
      if (
        !descriptor || !descriptor.allowedSources.includes("action") || !descriptor.surfaces.popup
      ) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "browser-toolbox-tool-card";
      button.dataset.toolId = toolId;
      const icon = globalThis.BrowserToolboxToolIcons?.createIcon(descriptor.icon, {
        className: "browser-toolbox-tool-icon",
      });
      const copy = document.createElement("span");
      copy.className = "browser-toolbox-tool-card-copy";
      const title = document.createElement("strong");
      title.textContent = BrowserToolboxI18n.message(descriptor.titleKey);
      const description = document.createElement("small");
      description.textContent = BrowserToolboxI18n.message(descriptor.descriptionKey);
      copy.append(title, description);
      const arrow = document.createElement("span");
      arrow.className = "browser-toolbox-tool-card-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.append(globalThis.BrowserToolboxToolIcons.createIcon("chevron", {
        className: "browser-toolbox-tool-card-arrow-icon",
      }));
      button.append(icon, copy, arrow);
      button.title = BrowserToolboxI18n.message(descriptor.descriptionKey);
      button.addEventListener("click", async () => {
        const invocation = BrowserToolboxCommandInvocation.createInvocation(
          "BrowserToolbox.openTool",
          { toolId, source: "action" },
          { type: "ui" },
          Object.assign(
            { pageUrl: activeTab?.url || "", topFrame: true },
            Number.isInteger(activeTab?.id) ? { tabId: activeTab.id } : {},
          ),
        );
        const result = await chrome.runtime.sendMessage({
          handler: "browserToolbox.invoke",
          invocation,
        });
        if (result?.ok !== false) globalThis.close();
      });
      buttons.append(button);
    }
    panel.style.display = buttons.children.length > 0 ? "block" : "none";
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
};

document.addEventListener("DOMContentLoaded", async () => {
  await vimiumSettings.onLoaded();
  ActionPage.init();
});

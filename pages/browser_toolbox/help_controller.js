// SPDX-License-Identifier: GPL-3.0-or-later
// 独立控制器只处理帮助页面；键盘、授权和配置事务继续由各自唯一所有者承载。
import "../../lib/i18n.js";
import "../../lib/browser_toolbox/configuration_client.js";
import { allCommands } from "../../background_scripts/all_commands.js";

const moduleLabels = Object.freeze({
  keyboard: "keyboard",
  mouse: "mouseGestures",
  superDrag: "superDrag",
  wheel: "wheelRocker",
  rocker: "rocker",
  cursor: "cursor",
});
export class HelpController {
  constructor({
    page = globalThis,
    post,
    client = globalThis.BrowserToolboxConfigurationClientInstance,
    mappings = () => chrome.storage.session.get("commandToOptionsToKeys"),
    locale = (snapshot) => {
      BrowserToolboxI18n.setLocale(snapshot.toolboxSource?.value?.general?.language || "auto");
      BrowserToolboxI18n.apply(page.document);
    },
    activate = (element) => globalThis.DomUtils?.simulateClick(element),
  }) {
    Object.assign(this, { page, post, client, mappings, locale, activate });
    this.document = page.document;
    this.dialogElement = this.document.querySelector("#dialog");
    this.revision = 0;
    this.removers = [];
    this.listen(this.document.querySelector("#close"), "click", (event) => {
      event.preventDefault();
      this.hide();
    });
    for (const name of ["click", "auxclick"]) {
      this.listen(this.document.querySelector("#options-page"), name, (event) => {
        if (event.button > 1) return;
        event.preventDefault();
        chrome.runtime.sendMessage({ handler: "openOptionsPageInNewTab" })
          .catch(() => this.lastErrorCode = "OPTIONS_UNAVAILABLE");
      });
    }
    this.listen(this.document.querySelector("#toggle-advanced a"), "click", (event) => {
      event.preventDefault();
      this.toggleAdvancedCommands().catch(() => {});
    });
    this.listen(this.document.documentElement, "click", (event) => {
      if (!this.dialogElement.contains(event.target)) this.hide();
    });
    this.listen(page, "pagehide", () => this.destroy());
  }
  listen(target, type, callback) {
    target.addEventListener(type, callback);
    this.removers.push(() => target.removeEventListener(type, callback));
  }
  async handle(message) {
    if (this.closed) return;
    if (message.name === "show") return this.show(message);
    if (message.name === "hide") return this.hide();
    if (message.name === "hidden") {
      this.revision++;
      this.visible = false;
      globalThis.HUD?.abandon();
    }
  }
  async show(message) {
    const revision = ++this.revision;
    this.visible = true;
    this.interactionId = message.interactionId;
    try {
      const [snapshot, mapping] = await Promise.all([
        this.client.read(),
        this.mappings(),
      ]);
      if (this.closed || !this.visible || revision !== this.revision) return false;
      // 配置快照已选择同步或本地权威来源，页面不能再单读sync覆盖用户语言。
      await this.locale(snapshot);
      if (this.closed || !this.visible || revision !== this.revision) return false;
      this.snapshot = snapshot;
      this.lastErrorCode = null;
      this.document.querySelector("#vimium-version").textContent =
        chrome.runtime.getManifest().version;
      this.renderRows(mapping.commandToOptionsToKeys || {});
      this.renderSummary(message.browserToolbox);
      this.showAdvancedCommands(snapshot.keyboard.helpDialog_showAdvancedCommands === true);
      // 沿用可滚动容器的激活语义，不给原模板增加可见焦点边框或新的Tab停靠点。
      this.activate(this.dialogElement);
      globalThis.Mode?.setIndicator();
      return true;
    } catch (_) {
      if (this.closed || revision !== this.revision) return false;
      this.lastErrorCode = "HELP_CONFIGURATION_UNAVAILABLE";
      this.document.querySelector("#browser-toolbox-help-status").textContent = BrowserToolboxI18n
        .message("browserToolboxStatusUnavailable");
      return false;
    }
  }
  renderRows(mapping) {
    for (const container of this.dialogElement.querySelectorAll("[data-group]")) {
      container.replaceChildren();
      for (const command of allCommands.filter((item) => item.group === container.dataset.group)) {
        for (const [options, keys] of Object.entries(mapping[command.name] || {})) {
          const row = this.document.querySelector("template#row").content.cloneNode(true);
          row.querySelector(".row").classList.toggle(
            "advanced",
            Boolean(command.advanced || command.name === "reload" && options.includes("hard")),
          );
          const keyName = `command_${command.name.replaceAll(".", "_")}`;
          const description = BrowserToolboxI18n.hasMessage(keyName)
            ? BrowserToolboxI18n.message(keyName)
            : command.desc;
          const label = row.querySelector(".help-description");
          const limit = 40 - description.length;
          const argument = options.length <= limit
            ? options
            : options.slice(0, Math.max(0, limit - 3)) + "...";
          label.textContent = description + (options ? ` (${argument})` : "");
          if (argument !== options) label.title = `${description} (${options})`;
          for (
            const key of [...keys].sort((a, b) => {
              a = a.replace("<", "~");
              b = b.replace("<", "~");
              return a < b ? -1 : a > b ? 1 : 0;
            })
          ) {
            const block = this.document.querySelector("template#keys").content.cloneNode(true);
            block.querySelector(".key").textContent = key;
            row.querySelector(".key-bindings").append(block);
          }
          container.append(row);
        }
      }
    }
  }
  renderSummary(summary) {
    const get = (id) => this.document.getElementById(id);
    const available = summary?.stateAvailable === true;
    const disabled = (summary?.disabledModules || []).filter((id) => moduleLabels[id])
      .map((id) => BrowserToolboxI18n.message(moduleLabels[id]));
    get("browser-toolbox-help-status").textContent = !available
      ? BrowserToolboxI18n.message("browserToolboxStatusUnavailable")
      : disabled.length
      ? `${BrowserToolboxI18n.message("browserToolboxDisabledModules")}: ${disabled.join(", ")}`
      : BrowserToolboxI18n.message("browserToolboxAllModulesEnabled");
    const pattern = available && typeof summary.matchedRule?.pattern === "string"
      ? summary.matchedRule.pattern
      : "";
    get("browser-toolbox-help-rule").hidden = !pattern;
    get("browser-toolbox-help-no-rule").hidden = !available || Boolean(pattern);
    get("browser-toolbox-help-vimium-excluded").hidden = !available || !summary.vimiumExcluded;
    get("browser-toolbox-help-rule-value").textContent = pattern
      ? `${
        BrowserToolboxI18n.message(
          summary.matchedRule.matchType === "regex" ? "siteRuleRegex" : "siteRuleGlob",
        )
      } — ${pattern}`
      : "";
  }
  showAdvancedCommands(visible) {
    this.advanced = visible;
    this.dialogElement.classList.toggle("show-advanced", visible);
    this.document.querySelector("#toggle-advanced a").textContent = BrowserToolboxI18n.message(
      visible ? "hideAdvancedCommands" : "showAdvancedCommands",
    );
  }
  async toggleAdvancedCommands() {
    if (this.closed || !this.visible || !this.snapshot || this.saving) return false;
    this.saving = true;
    const revision = this.revision;
    const visible = !this.advanced;
    const container = this.document.querySelector("#container");
    const before = container.scrollHeight;
    try {
      const snapshot = await this.client.commit({
        baseline: { keyboard: this.snapshot.keyboard },
        legacyPatch: { helpDialog_showAdvancedCommands: visible },
      });
      if (this.closed || revision !== this.revision) return false;
      this.snapshot = snapshot;
      this.showAdvancedCommands(visible);
      container.scrollTop += Math.max(0, container.scrollHeight - before);
      return true;
    } catch (_) {
      if (!this.closed && revision === this.revision) this.lastErrorCode = "HELP_PREFERENCE_FAILED";
      return false;
    } finally {
      this.saving = false;
    }
  }
  hide() {
    this.revision++;
    this.visible = false;
    this.post({
      name: "hide",
      ...(this.interactionId ? { interactionId: this.interactionId } : {}),
    });
  }
  destroy() {
    this.closed = true;
    this.visible = false;
    this.revision++;
    for (const remove of this.removers.splice(0)) remove();
    this.snapshot = null;
  }
}

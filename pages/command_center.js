import "../lib/browser_toolbox/command_invocation.js";

// 命令中心只通过 Runtime 命令协议执行操作，不直接执行页面脚本或读取页面内容。
(function () {
  const commandCenterApi = globalThis.BrowserToolboxCommandCenter;
  const invocationApi = globalThis.BrowserToolboxCommandInvocation;
  const toolRegistry = globalThis.BrowserToolboxToolRegistry;
  const i18n = globalThis.BrowserToolboxI18n;
  const settings = [
    {
      id: "mouse",
      hash: "#mouse",
      titleKey: "commandCenterMouseSettings",
      descriptionKey: "commandCenterMouseSettingsDescription",
    },
    {
      id: "siteRules",
      hash: "#siteRules",
      titleKey: "commandCenterSiteRules",
      descriptionKey: "commandCenterSiteRulesDescription",
    },
    {
      id: "tools",
      hash: "#toolsOverview",
      titleKey: "commandCenterToolSettings",
      descriptionKey: "commandCenterToolSettingsDescription",
    },
  ];
  const state = {
    entries: [],
    filtered: [],
    selectedIndex: 0,
    tab: null,
  };

  function message(key) {
    return i18n?.message?.(key) || key;
  }

  function localized(key, fallback) {
    const value = message(key);
    return value === key ? fallback : value;
  }

  function tabLabel(tab) {
    if (!tab) return message("commandCenterNoTarget");
    return tab.title || tab.url || message("untitledTab");
  }

  async function findTargetTab() {
    const requested = Number(new URLSearchParams(location.search).get("tabId"));
    if (Number.isInteger(requested) && requested >= 0) {
      try {
        const tab = await chrome.tabs.get(requested);
        if (tab?.id != null) return tab;
      } catch (_) {
        // 来源标签页可能在打开命令中心后关闭，继续寻找当前活动标签页。
      }
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentPage = location.href;
    return tabs.find((tab) => tab.url !== currentPage && !tab.url?.includes("/pages/command_center.html")) || null;
  }

  function iconName(entry) {
    if (entry.kind === "tool") return toolRegistry?.get(entry.toolId)?.icon || "grid";
    if (entry.kind === "setting") return "settings";
    return entry.dangerous ? "warning" : "command";
  }

  function renderIcon(entry) {
    const icon = globalThis.BrowserToolboxToolIcons?.createIcon?.(iconName(entry), {
      className: "browser-toolbox-command-result-icon-svg",
    });
    if (icon) return icon;
    const fallback = document.createElement("span");
    fallback.textContent = entry.kind === "tool" ? "▦" : "›";
    return fallback;
  }

  function groupLabel(entry) {
    if (entry.kind === "tool") return message("commandCenterTools");
    if (entry.kind === "setting") return message("commandCenterSettings");
    return message("commandCenterCommands");
  }

  function select(index, { focus = false } = {}) {
    if (state.filtered.length === 0) {
      state.selectedIndex = 0;
      return;
    }
    state.selectedIndex = (index + state.filtered.length) % state.filtered.length;
    for (const [itemIndex, button] of [...document.querySelectorAll("[data-entry-id]")].entries()) {
      const selected = itemIndex === state.selectedIndex;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", String(selected));
      if (selected) button.id = "command-center-selected";
      else if (button.id === "command-center-selected") button.removeAttribute("id");
    }
    if (focus) document.querySelector("#command-center-selected")?.focus();
  }

  function render() {
    const root = document.querySelector("#command-center-results");
    const status = document.querySelector("#command-center-status");
    if (!root || !status) return;
    root.replaceChildren();
    const query = document.querySelector("#command-center-search")?.value || "";
    state.filtered = commandCenterApi.searchEntries(state.entries, query);
    state.selectedIndex = Math.min(state.selectedIndex, Math.max(0, state.filtered.length - 1));
    if (state.filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "browser-toolbox-command-empty";
      empty.textContent = query.trim() ? message("commandCenterNoResults") : message("commandCenterEmpty");
      root.appendChild(empty);
      status.textContent = "";
      return;
    }
    status.textContent = `${state.filtered.length} ${message("commandCenterResultCount")}`;
    let lastGroup = "";
    state.filtered.forEach((entry, index) => {
      const group = groupLabel(entry);
      if (group !== lastGroup) {
        const heading = document.createElement("div");
        heading.className = "browser-toolbox-command-group";
        heading.textContent = group;
        heading.setAttribute("aria-hidden", "true");
        root.appendChild(heading);
        lastGroup = group;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "browser-toolbox-command-result";
      button.dataset.entryId = entry.id;
      button.dataset.entryIndex = String(index);
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === state.selectedIndex));
      if (entry.dangerous) button.classList.add("is-danger");
      if (index === state.selectedIndex) {
        button.classList.add("is-selected");
        button.id = "command-center-selected";
      }
      const icon = document.createElement("span");
      icon.className = "browser-toolbox-command-result-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.appendChild(renderIcon(entry));
      const copy = document.createElement("span");
      copy.className = "browser-toolbox-command-result-copy";
      const title = document.createElement("strong");
      title.className = "browser-toolbox-command-result-title";
      title.textContent = entry.title;
      const description = document.createElement("span");
      description.className = "browser-toolbox-command-result-description";
      description.textContent = entry.description;
      copy.append(title, description);
      const meta = document.createElement("span");
      meta.className = "browser-toolbox-command-result-meta";
      const category = document.createElement("span");
      category.className = "browser-toolbox-command-result-category";
      category.textContent = entry.category;
      meta.appendChild(category);
      if (entry.dangerous) {
        const danger = document.createElement("span");
        danger.className = "browser-toolbox-command-result-danger";
        danger.textContent = "!";
        danger.title = message("dangerousCommandWarning");
        meta.appendChild(danger);
      }
      button.append(icon, copy, meta);
      button.addEventListener("mouseenter", () => select(index));
      button.addEventListener("click", () => execute(entry));
      root.appendChild(button);
    });
  }

  function setError(error) {
    const status = document.querySelector("#command-center-status");
    if (!status) return;
    status.className = "browser-toolbox-command-status is-error";
    status.textContent = error || message("commandCenterExecuteFailed");
  }

  async function execute(entry) {
    if (!entry) return;
    if (entry.dangerous && !globalThis.confirm(message("commandCenterDangerousConfirm"))) return;
    try {
      if (entry.kind === "setting") {
        await chrome.tabs.create({
          url: chrome.runtime.getURL(`pages/mouse_options.html${entry.hash}`),
        });
        globalThis.close();
        return;
      }
      const context = { pageUrl: state.tab?.url || "", topFrame: true };
      if (state.tab?.id != null) context.tabId = state.tab.id;
      const options = entry.kind === "tool"
        ? { toolId: entry.toolId, source: "command" }
        : {};
      const invocation = invocationApi.createInvocation(
        entry.kind === "tool" ? "BrowserToolbox.openTool" : entry.commandName,
        options,
        { type: "ui" },
        context,
      );
      const result = await chrome.runtime.sendMessage({ handler: "browserToolbox.invoke", invocation });
      if (!result?.ok) throw new Error(result?.message || message("commandCenterExecuteFailed"));
      globalThis.close();
    } catch (error) {
      setError(error.message);
    }
  }

  function installEvents() {
    const input = document.querySelector("#command-center-search");
    input?.addEventListener("input", () => {
      state.selectedIndex = 0;
      render();
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        select(state.selectedIndex + 1, { focus: true });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        select(state.selectedIndex - 1, { focus: true });
      } else if (event.key === "Enter") {
        event.preventDefault();
        execute(state.filtered[state.selectedIndex]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        globalThis.close();
      }
    });
    document.querySelector("#command-center-close")?.addEventListener("click", () => globalThis.close());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.activeElement !== input) globalThis.close();
    });
  }

  async function init() {
    await i18n?.applyStoredLocale?.(document);
    i18n?.apply?.(document);
    state.tab = await findTargetTab();
    document.querySelector("#command-center-context").textContent = tabLabel(state.tab);
    const commands = await chrome.runtime.sendMessage({ handler: "browserToolbox.commandRegistry" });
    if (!Array.isArray(commands)) throw new Error(message("commandCenterLoadFailed"));
    const localize = (key) => message(key);
    state.entries = commandCenterApi.createEntries({
      commands,
      tools: toolRegistry?.list?.({ source: "command" }) || [],
      settings: settings.map((setting) => ({
        ...setting,
        title: localized(setting.titleKey, setting.id),
        description: localized(setting.descriptionKey, ""),
      })),
      localize,
    });
    installEvents();
    render();
    document.querySelector("#command-center-search")?.focus();
  }

  globalThis.BrowserToolboxCommandCenterPage = Object.freeze({
    createEntries: commandCenterApi.createEntries,
    searchEntries: commandCenterApi.searchEntries,
    render,
  });
  document.addEventListener("DOMContentLoaded", () =>
    init().catch((error) => setError(error.message))
  );
})();

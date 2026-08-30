import "../lib/browser_toolbox/value_utils.js";
import "../lib/browser_toolbox/tools/tool_contract.js";
import "../lib/browser_toolbox/tools/tool_registry.js";
import "../lib/browser_toolbox/tools/tool_registry_validator.js";
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

// 标签页列表只使用 tabs API，不申请 management 权限，也不保存标签历史。
(function () {
  const LOCALE_READ_TIMEOUT_MS = 500;
  let tabs = [];

  function fuzzyScore(text, query) {
    const normalizedText = text.toLowerCase();
    const normalizedQuery = query.toLowerCase();
    let index = 0;
    for (const char of normalizedQuery) {
      index = normalizedText.indexOf(char, index);
      if (index < 0) return -1;
      index++;
    }
    return normalizedQuery.length * 10 - index;
  }

  function score(tab, query) {
    if (!query) return 0;
    const candidates = [];
    let parsedUrl;
    try {
      parsedUrl = tab.url ? new URL(tab.url) : null;
    } catch (_) {
      parsedUrl = null;
    }
    const isExtensionUrl = parsedUrl?.protocol.endsWith("-extension:");
    // 某些浏览器会把扩展 URL 临时暴露为标题，不能把其中的随机 ID当作搜索文本。
    if (!isExtensionUrl || tab.title !== tab.url) candidates.push(tab.title || "");
    if (parsedUrl) {
      const url = parsedUrl;
      // 扩展 ID 是随机值，不应参与用户搜索；普通网页再按 URL 组件分别匹配。
      if (!url.protocol.endsWith("-extension:")) candidates.push(url.hostname);
      candidates.push(url.pathname, url.search, url.hash);
    } else if (tab.url) {
      candidates.push(tab.url);
    }
    return Math.max(...candidates.map((text) => fuzzyScore(text, query)));
  }

  function filterTabs(value, query) {
    const normalizedQuery = String(query || "").trim();
    return value.map((tab) => ({ tab, score: score(tab, normalizedQuery) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score || a.tab.index - b.tab.index)
      .map(({ tab }) => tab);
  }

  // 标签页搜索算法独立暴露给性能回归和页面测试；真实标签数据仍只来自 tabs API。
  const tabListApi = Object.freeze({ fuzzyScore, score, filterTabs });
  globalThis.BrowserToolboxTabList = tabListApi;

  async function render() {
    const query = document.querySelector("#query").value.trim();
    const list = document.querySelector("#tabs");
    list.replaceChildren();
    for (const tab of filterTabs(tabs, query)) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.tabId = String(tab.id);
      button.textContent = (tab.pinned ? "📌 " : "") +
        (tab.title || tab.url || BrowserToolboxI18n.message("untitledTab"));
      item.appendChild(button);
      list.appendChild(item);
    }
  }

  function tabFromEvent(event, list) {
    const button = event.target?.closest?.("button[data-tab-id]");
    if (!button || !list.contains(button)) return null;
    return tabs.find((tab) => String(tab.id) === button.dataset.tabId) || null;
  }

  function installListInteractions(list) {
    // 列表使用事件委托，避免标签数量增长时为每个按钮创建长期闭包监听器。
    list.addEventListener("click", async (event) => {
      const tab = tabFromEvent(event, list);
      if (!tab) return;
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      window.close();
    });
    list.addEventListener("auxclick", async (event) => {
      if (event.button !== 1) return;
      const tab = tabFromEvent(event, list);
      if (!tab) return;
      event.preventDefault();
      await chrome.tabs.remove(tab.id);
      tabs = tabs.filter((item) => item.id !== tab.id);
      render();
    });
  }

  globalThis.BrowserToolboxTabListPage = Object.freeze({ filterTabs, installListInteractions });

  globalThis.document?.addEventListener?.("DOMContentLoaded", async () => {
    const locale = await Promise.race([
      globalThis.BrowserToolboxSettingsRepositoryInstance.getStoredLocale().catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), LOCALE_READ_TIMEOUT_MS)),
    ]);
    // 语言偏好只是显示增强项；存储事件竞争或浏览器暂时变慢时，不能阻塞标签页列表。
    if (locale) BrowserToolboxI18n.setLocale(locale);
    BrowserToolboxI18n.apply(document);
    tabs = await chrome.tabs.query({});
    const list = document.querySelector("#tabs");
    installListInteractions(list);
    document.querySelector("#query").addEventListener("input", render);
    render();
  });
})();

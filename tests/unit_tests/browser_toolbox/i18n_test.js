import "../test_helper.js";
import "../../../background_scripts/browser_toolbox/settings_storage.js";
import "../../../lib/i18n.js";

context("BrowserToolbox internationalization", () => {
  teardown(() => BrowserToolboxI18n.setLocale("auto"));

  should("switch the new UI catalog between English and Simplified Chinese", () => {
    BrowserToolboxI18n.setLocale("en");
    assert.equal("Save", BrowserToolboxI18n.message("save"));
    assert.equal(
      "Gesture arrows (for example, ↑ · →)",
      BrowserToolboxI18n.message("patternInput"),
    );
    assert.equal("See permissions help", BrowserToolboxI18n.message("seePermissionsHelp"));
    assert.equal("Refresh", BrowserToolboxI18n.message("command_reload"));
    assert.equal("Right", BrowserToolboxI18n.message("gestureDirectionRight"));
    assert.equal(
      "This matching pattern is used by another rule; the later configured rule takes precedence for overlapping fields.",
      BrowserToolboxI18n.message("siteRuleDuplicateWarning"),
    );
    BrowserToolboxI18n.setLocale("zh_CN");
    assert.equal("保存", BrowserToolboxI18n.message("save"));
    assert.equal("手势箭头（例如 ↑ · →）", BrowserToolboxI18n.message("patternInput"));
    assert.equal("查看权限帮助", BrowserToolboxI18n.message("seePermissionsHelp"));
    assert.equal("复制链接网址", BrowserToolboxI18n.message("command_BrowserToolbox_copyLinkUrl"));
    assert.equal("刷新", BrowserToolboxI18n.message("command_reload"));
    assert.equal("向右", BrowserToolboxI18n.message("gestureDirectionRight"));
    assert.equal(
      "没有浏览器工具箱站点规则匹配此网址。",
      BrowserToolboxI18n.message("siteRuleNoMatchingRules"),
    );
  });

  should("apply the user's stored locale instead of only the browser UI locale", async () => {
    const previousStore = chrome.storage.sync.store;
    chrome.storage.sync.store = {
      browserToolboxSettings: { general: { language: "zh_CN" } },
    };
    try {
      const root = {
        querySelectorAll: () => [],
        documentElement: {},
      };
      await BrowserToolboxI18n.applyStoredLocale(root);
      assert.equal("zh_CN", BrowserToolboxI18n.locale());
      assert.equal("保存", BrowserToolboxI18n.message("save"));
    } finally {
      chrome.storage.sync.store = previousStore;
    }
  });

  should("read the legacy stored locale through the compatibility layer", async () => {
    const previousStore = chrome.storage.sync.store;
    chrome.storage.sync.store = {
      openKeyMouseSettings: { general: { language: "zh_CN" } },
    };
    try {
      const root = {
        querySelectorAll: () => [],
        documentElement: {},
      };
      await BrowserToolboxI18n.applyStoredLocale(root);
      assert.equal("zh_CN", BrowserToolboxI18n.locale());
      assert.equal("保存", BrowserToolboxI18n.message("save"));
    } finally {
      chrome.storage.sync.store = previousStore;
    }
  });
});

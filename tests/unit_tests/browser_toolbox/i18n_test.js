import "../test_helper.js";
import "../../../background_scripts/browser_toolbox/settings_storage.js";
import "../../../lib/i18n.js";
import { synchronizeCatalogs } from "../../../scripts/sync_i18n.js";

context("BrowserToolbox internationalization", () => {
  teardown(() => BrowserToolboxI18n.setLocale("auto"));

  should(
    "keep every packaged translation and its synchronous runtime catalog identical",
    async () => {
      const { locales, messageCount } = await synchronizeCatalogs({ check: true });
      assert.equal(["en", "es", "ja", "zh_CN", "zh_TW"], locales.sort());
      assert.isTrue(messageCount > 800);
      for (const locale of locales) {
        const messages = JSON.parse(
          await Deno.readTextFile(
            new URL(`../../../_locales/${locale}/messages.json`, import.meta.url),
          ),
        );
        BrowserToolboxI18n.setLocale(locale);
        for (const [key, { message }] of Object.entries(messages)) {
          assert.equal(message, BrowserToolboxI18n.message(key));
          assert.isTrue(BrowserToolboxI18n.hasMessage(key));
        }
      }
    },
  );

  should(
    "resolve regional and script locales without merging Traditional into Simplified Chinese",
    () => {
      const cases = {
        "zh": "zh_CN",
        "zh-CN": "zh_CN",
        "zh-SG": "zh_CN",
        "zh-Hans-HK": "zh_CN",
        "zh_TW": "zh_TW",
        "zh-HK": "zh_TW",
        "zh-MO": "zh_TW",
        "ZH_hant_CN": "zh_TW",
        "ja-JP": "ja",
        "es-ES": "es",
        "es-MX": "es",
        "es-419": "es",
        "en-GB": "en",
        "fr-FR": "en",
        "jargon": "en",
      };
      for (const [input, expected] of Object.entries(cases)) {
        assert.equal(expected, BrowserToolboxI18n.setLocale(input));
      }
    },
  );

  should("follow the browser language again after clearing a manual language choice", () => {
    const previousI18n = chrome.i18n;
    try {
      chrome.i18n = { getUILanguage: () => "zh-HK" };
      BrowserToolboxI18n.setLocale("es");
      assert.equal("Guardar", BrowserToolboxI18n.message("save"));
      BrowserToolboxI18n.setLocale("auto");
      assert.equal("zh_TW", BrowserToolboxI18n.locale());
      assert.equal("儲存", BrowserToolboxI18n.message("save"));
      chrome.i18n.getUILanguage = () => "ja-JP";
      assert.equal("ja", BrowserToolboxI18n.locale());
      assert.equal("キャンセル", BrowserToolboxI18n.message("cancel"));
      chrome.i18n.getUILanguage = () => "fr-FR";
      assert.equal("Save", BrowserToolboxI18n.message("save"));
    } finally {
      chrome.i18n = previousI18n;
    }
  });

  should("restore all new languages and expose a valid document language tag", async () => {
    const previousStore = chrome.storage.sync.store;
    try {
      for (
        const [locale, tag, save] of [
          ["zh_TW", "zh-TW", "儲存"],
          ["ja", "ja", "保存"],
          ["es", "es", "Guardar"],
        ]
      ) {
        chrome.storage.sync.store = {
          browserToolboxSettings: { general: { language: locale } },
        };
        const element = { dataset: { i18n: "save" }, textContent: "" };
        const root = {
          querySelectorAll: (selector) => selector === "[data-i18n]" ? [element] : [],
          documentElement: {},
        };
        await BrowserToolboxI18n.applyStoredLocale(root);
        assert.equal(locale, BrowserToolboxI18n.locale());
        assert.equal(tag, root.documentElement.lang);
        assert.equal(save, element.textContent);
      }
    } finally {
      chrome.storage.sync.store = previousStore;
    }
  });

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

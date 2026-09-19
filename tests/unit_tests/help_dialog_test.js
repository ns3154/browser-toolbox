import * as testHelper from "./test_helper.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import "../../background_scripts/completion/completers.js";
import "../../lib/i18n.js";
import { allCommands } from "../../background_scripts/all_commands.js";
import { HelpDialogPage } from "../../pages/help_dialog_page.js";

context("help dialog", () => {
  setup(async () => {
    await testHelper.jsdomStub("pages/help_dialog_page.html");
    HelpDialogPage.dialogElement = null;
    await Settings.onLoaded();
    stub(chrome.storage.session, "get", async (key) => {
      if (key == "commandToOptionsToKeys") {
        const data = {
          "reload": {
            "": ["a"],
            "hard": ["b"],
          },
        };
        return { commandToOptionsToKeys: data };
      }
    });
  });

  teardown(() => {
    BrowserToolboxI18n.setLocale("auto");
    HelpDialogPage.dialogElement = null;
  });

  should("getRowsForDialog includes one row per command-options pair", () => {
    const config = {
      "reload": {
        "": ["a"],
        "hard": ["b", "c"],
      },
    };
    const result = HelpDialogPage.getRowsForDialog(config);
    const rows = result["navigation"]
      .filter((row) => row[0].name == "reload");
    assert.equal(2, rows.length);
    assert.equal(["reload", "", ["a"]], [rows[0][0].name, rows[0][1], rows[0][2]]);
    assert.equal(["reload", "hard", ["b", "c"]], [rows[1][0].name, rows[1][1], rows[1][2]]);
  });

  should("have a section in the help dialog for every group", async () => {
    // This test is to prevent code editing errors, where a command is added but doesn't have a
    // corresponding group in the help dialog.
    HelpDialogPage.init();
    await HelpDialogPage.show();
    const groups = Array.from(new Set(allCommands.map((c) => c.group))).sort();
    const groupsInDialog = Array.from(
      HelpDialogPage.dialogElement.querySelectorAll("div[data-group]"),
    )
      .map((e) => e.dataset.group)
      .sort();
    assert.equal(groups, groupsInDialog);
  });

  should("localize the Browser Toolbox group heading from the stored preference", async () => {
    const previousStore = chrome.storage.sync.store;
    chrome.storage.sync.store = {
      browserToolboxSettings: { general: { language: "zh_CN" } },
    };
    try {
      HelpDialogPage.init();
      await HelpDialogPage.show();
      assert.equal(
        "浏览器工具箱设置",
        HelpDialogPage.dialogElement.querySelector('[data-i18n="browserToolboxSettings"]')
          .textContent,
      );
    } finally {
      chrome.storage.sync.store = previousStore;
    }
  });

  should("render the current Browser Toolbox state in the help dialog", async () => {
    HelpDialogPage.init();
    await HelpDialogPage.show({
      browserToolbox: {
        stateAvailable: true,
        disabledModules: ["mouse", "wheel"],
        matchedRule: {
          matchType: "regex",
          pattern: "^https://example\\.com/",
        },
        vimiumExcluded: true,
      },
    });

    const dialog = HelpDialogPage.dialogElement;
    assert.isTrue(
      dialog.querySelector("#browser-toolbox-help-status").textContent.includes(
        "Disabled modules on this page",
      ),
    );
    assert.isTrue(
      dialog.querySelector("#browser-toolbox-help-status").textContent.includes("Mouse Gestures"),
    );
    assert.isTrue(
      dialog.querySelector("#browser-toolbox-help-status").textContent.includes("Wheel & Rocker"),
    );
    assert.equal(false, dialog.querySelector("#browser-toolbox-help-rule").hidden);
    assert.isTrue(
      dialog.querySelector("#browser-toolbox-help-rule-value").textContent.includes(
        "Regular expression",
      ),
    );
    assert.isTrue(
      dialog.querySelector("#browser-toolbox-help-rule-value").textContent.includes(
        "^https://example\\.com/",
      ),
    );
    assert.equal(false, dialog.querySelector("#browser-toolbox-help-vimium-excluded").hidden);
  });

  should("expose accessible dialog semantics and localized controls", async () => {
    const previousStore = chrome.storage.sync.store;
    chrome.storage.sync.store = {
      browserToolboxSettings: { general: { language: "zh_CN" } },
    };
    try {
      HelpDialogPage.init();
      await HelpDialogPage.show({ browserToolbox: { stateAvailable: true } });

      const dialog = HelpDialogPage.dialogElement;
      const status = dialog.querySelector("#browser-toolbox-help-status");
      const sections = [...dialog.querySelectorAll("section")];
      assert.equal("zh-CN", document.documentElement.lang);
      assert.equal("dialog", dialog.getAttribute("role"));
      assert.equal("true", dialog.getAttribute("aria-modal"));
      assert.equal(
        "browser-toolbox-help-dialog-title",
        dialog.getAttribute("aria-labelledby"),
      );
      assert.equal("browser-toolbox-help-intro", dialog.getAttribute("aria-describedby"));
      assert.equal("关闭", dialog.querySelector("#close").getAttribute("aria-label"));
      assert.equal("status", status.getAttribute("role"));
      assert.equal("polite", status.getAttribute("aria-live"));
      assert.isTrue(
        sections.every((section) => section.getAttribute("aria-labelledby")),
      );
      assert.isTrue(
        status.textContent.includes("当前页面已启用浏览器工具箱的全部模块"),
      );
    } finally {
      chrome.storage.sync.store = previousStore;
    }
  });
});

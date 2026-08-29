import * as testHelper from "./test_helper.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import "../../lib/utils.js";
import "../../lib/settings.js";
import "../../lib/i18n.js";
import { allCommands } from "../../background_scripts/all_commands.js";
import * as commandListing from "../../pages/command_listing.js";

context("command listing", () => {
  setup(async () => {
    await testHelper.jsdomStub("pages/command_listing.html");
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

  teardown(() => BrowserToolboxI18n.setLocale("auto"));

  should("have a section in the html for every group", async () => {
    // This is to prevent editing errors, where a new command group is added, and we forget to add a
    // corresponding group to the command listing.
    await commandListing.populatePage();
    const groups = Array.from(new Set(allCommands.map((c) => c.group))).sort();
    const groupsInPage = Array.from(globalThis.document.querySelectorAll("h2[data-group]"))
      .map((e) => e.dataset.group)
      .sort();
    assert.equal(groups, groupsInPage);
  });

  should("have one entry per command", async () => {
    await commandListing.populatePage();
    const rows = globalThis.document.querySelectorAll(".command");
    assert.equal(allCommands.length, rows.length);
  });

  should("localize the Browser Toolbox group heading from the stored preference", async () => {
    const previousStore = chrome.storage.sync.store;
    chrome.storage.sync.store = {
      browserToolboxSettings: { general: { language: "zh_CN" } },
    };
    try {
      await commandListing.populatePage();
      assert.equal("浏览器工具箱设置", document.querySelector("#settings").textContent);
    } finally {
      chrome.storage.sync.store = previousStore;
    }
  });

  should("show key mappings for mapped commands", async () => {
    const getKeys = (commandName) => {
      const el = globalThis.document.querySelector(`.command#${commandName}`);
      if (!el) throw new Error(`${commandName} el not found.`);
      const keys = Array.from(el.querySelectorAll(".key")).map((el) => el.textContent);
      return keys;
    };
    await commandListing.populatePage();
    assert.equal(["a", "b"], getKeys("reload"));
    // This command isn't bound in our stubbed test environment:
    assert.equal([], getKeys("scrollDown"));
  });
});

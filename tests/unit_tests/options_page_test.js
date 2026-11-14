import * as testHelper from "./test_helper.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import "../../lib/i18n.js";
import * as optionsPage from "../../pages/options.js";

context("options page", () => {
  setup(async () => {
    await testHelper.jsdomStub("pages/options.html");
    await optionsPage.init();
  });

  teardown(async () => {
    BrowserToolboxI18n.setLocale("auto");
    await Settings.clear();
  });

  should("localize the Browser Toolbox entry point", () => {
    BrowserToolboxI18n.setLocale("zh_CN");
    BrowserToolboxI18n.apply(document);
    assert.equal(
      "浏览器工具箱的鼠标、拖拽、滚轮和隐私设置",
      document.querySelector('a[href="mouse_options.html"]').textContent,
    );
  });

  should("populate the form fields with the settings", () => {
    const settings = Settings.getSettings();
    const field = optionsPage.getOptionEl("keyMappings");
    assert.isTrue(Settings.defaultOptions.keyMappings.length > 0);
    assert.equal(Settings.defaultOptions.keyMappings, settings.keyMappings);
    assert.equal(settings.keyMappings, field.value);
  });

  should("show validation errors for invalid fields on save", async () => {
    const el = optionsPage.getOptionEl("keyMappings");
    assert.isFalse(el.classList.contains("validation-error"));
    assert.equal(0, document.querySelectorAll(".validation-message").length);

    el.value = "invalid-mapping-statement";
    await optionsPage.saveOptions();
    assert.isTrue(el.classList.contains("validation-error"));

    const messageEls = document.querySelectorAll(".validation-message");
    assert.equal(1, messageEls.length);
    assert.isTrue(messageEls[0].innerHTML.includes(el.value));
  });

  should("保存时定位第一个错误字段，普通失焦校验不抢焦点或滚动", async () => {
    const mapping = optionsPage.getOptionEl("keyMappings");
    const search = optionsPage.getOptionEl("searchEngines");
    const calls = [];
    mapping.scrollIntoView = (options) => calls.push(["keyMappings", options]);
    search.scrollIntoView = (options) => calls.push(["searchEngines", options]);
    mapping.value = "invalid-mapping-statement";
    search.value = "invalid-search-engine";

    mapping.focus();
    search.focus();
    assert.equal([], calls);
    assert.equal(search, document.activeElement);

    await optionsPage.saveOptions();
    assert.equal(1, calls.length);
    assert.equal("keyMappings", calls[0][0]);
    assert.equal(mapping, document.activeElement);
    assert.isTrue(mapping.classList.contains("validation-error"));
    assert.isTrue(search.classList.contains("validation-error"));
  });

  should("保存时先显示隐藏的错误字段再滚动定位", async () => {
    const field = optionsPage.getOptionEl("linkHintNumbers");
    const container = document.querySelector("#link-hint-numbers-container");
    let displayAtScroll;
    field.scrollIntoView = () => displayAtScroll = container.style.display;
    assert.equal("none", container.style.display);
    field.value = "1";

    await optionsPage.saveOptions();
    assert.equal("", displayAtScroll);
    assert.equal(field, document.activeElement);
    assert.isTrue(field.classList.contains("validation-error"));
  });

  should("show exclusion rule editor for exclusion rules", async () => {
    const rule = {
      passKeys: "",
      pattern: "example.com",
    };
    await Settings.set("exclusionRules", [rule]);
    await optionsPage.init();
    const el = document.querySelector("#exclusion-rules input[name=pattern]");
    assert.equal("example.com", el.value);
  });

  should("保存其他设置和导出时保留排除规则的未知字段", async () => {
    const rule = {
      pattern: "https://example.invalid/*",
      passKeys: "j",
      futurePolicy: { mode: "synthetic", enabled: false },
    };
    await Settings.set("exclusionRules", [rule]);
    await optionsPage.init();
    optionsPage.getOptionEl("smoothScroll").checked = false;
    assert.equal([rule], JSON.parse(optionsPage.prepareBackupSettings()).exclusionRules);
    await optionsPage.saveOptions();
    assert.equal([rule], Settings.get("exclusionRules"));
    assert.isFalse(Settings.get("smoothScroll"));
  });

  should("附加字段规则只读且有提示，普通规则仍可编辑和删除", async () => {
    const protectedRule = { pattern: "https://protected.invalid/*", passKeys: "", enabled: false };
    const normalRule = { pattern: "https://normal.invalid/*", passKeys: "k" };
    await Settings.set("exclusionRules", [protectedRule, normalRule]);
    await optionsPage.init();
    const rows = document.querySelectorAll("#exclusion-rules tr.rule");
    assert.isTrue(rows[0].querySelector('[name="pattern"]').readOnly);
    assert.isTrue(rows[0].querySelector('[name="passKeys"]').readOnly);
    assert.isTrue(rows[0].querySelector(".remove").disabled);
    assert.isTrue(Boolean(rows[0].querySelector(".exclusion-preserved-warning")?.textContent));
    assert.isFalse(rows[1].querySelector('[name="pattern"]').readOnly);
    rows[0].querySelector('[name="pattern"]').value = "";
    rows[0].querySelector(".remove").click();
    rows[1].querySelector('[name="pattern"]').value = "https://changed.invalid/*";
    await optionsPage.saveOptions();
    assert.equal(
      [protectedRule, { passKeys: "k", pattern: "https://changed.invalid/*" }],
      Settings.get("exclusionRules"),
    );
  });

  should("空匹配式规则若含附加字段，也不会在保存其他设置时被过滤", async () => {
    const rule = { pattern: "", passKeys: "", futurePolicy: "保留原值" };
    await Settings.set("exclusionRules", [rule]);
    await optionsPage.init();
    optionsPage.getOptionEl("smoothScroll").checked = false;
    await optionsPage.saveOptions();
    assert.equal([rule], Settings.get("exclusionRules"));
  });

  context("backup", () => {
    should("exclude settings which are default values", () => {
      const settings = JSON.parse(optionsPage.prepareBackupSettings());
      // This should exclude all values which are defaults.
      assert.equal(["settingsVersion"], Object.keys(settings));
    });

    should("include settings which have changed from the default", () => {
      optionsPage.getOptionEl("keyMappings").value = "map a scrollUp";
      const settings = JSON.parse(optionsPage.prepareBackupSettings());
      assert.equal(["keyMappings", "settingsVersion"], Object.keys(settings));
      assert.equal("map a scrollUp", settings.keyMappings);
    });

    should("export settings with sorted keys", () => {
      optionsPage.getOptionEl("linkHintCharacters").value = "abcd";
      optionsPage.getOptionEl("keyMappings").value = "map a scrollUp";
      const settings = JSON.parse(optionsPage.prepareBackupSettings());
      assert.equal(["keyMappings", "linkHintCharacters", "settingsVersion"], Object.keys(settings));
    });

    should("include exclusion rules", async () => {
      const rule = {
        passKeys: "",
        pattern: "example.com",
      };
      await Settings.set("exclusionRules", [rule]);
      await optionsPage.init();
      const settings = JSON.parse(optionsPage.prepareBackupSettings());
      assert.equal([rule], settings["exclusionRules"]);
    });
  });
});

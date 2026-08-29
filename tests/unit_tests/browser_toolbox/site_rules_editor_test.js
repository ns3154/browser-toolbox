/**
 * 网站规则编辑器的单元测试。
 * 测试输入为 glob、正则和模块规则，输出为校验及行操作断言。
 */
import "../test_helper.js";
import * as testHelper from "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/regex_safety.js";
import "../../../lib/browser_toolbox/module_registry.js";
import "../../../lib/browser_toolbox/site_rule_matcher.js";
import "../../../pages/site_rules_editor.js";

context("Site rules editor", () => {
  let editor;
  let rules;

  setup(async () => {
    await testHelper.jsdomStub("pages/mouse_options.html");
    rules = [{
      id: "rule-test",
      matchType: "regex",
      pattern: "^(a+)+$",
      enabled: true,
      modules: {},
    }];
    editor = new BrowserToolboxSiteRulesEditor.SiteRulesEditor({
      body: document.querySelector("#site-rules"),
      getRules: () => rules,
      message: (key) => key,
      onChange: () => {},
      documentRef: document,
    });
  });

  should("show a localized complexity error while editing an unsafe regex", () => {
    editor.render();
    const input = document.querySelector("#site-rules input[data-field='pattern']");
    const error = document.querySelector(".browser-toolbox-site-rule-error");
    assert.equal("true", input.getAttribute("aria-invalid"));
    assert.equal("validationRegexComplexity", error.textContent);
    assert.isFalse(error.hidden);
  });

  should("clear the row error immediately after the pattern becomes valid", () => {
    editor.render();
    const input = document.querySelector("#site-rules input[data-field='pattern']");
    const error = document.querySelector(".browser-toolbox-site-rule-error");
    input.value = "^https://example\\.com/";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal("^https://example\\.com/", rules[0].pattern);
    assert.isFalse(input.hasAttribute("aria-invalid"));
    assert.isTrue(error.hidden);
    assert.equal("", error.textContent);
  });

  should("validate patterns through the same matcher and safety modules as saving", () => {
    const api = BrowserToolboxSiteRulesEditor;
    assert.equal(
      null,
      api.validatePattern({
        pattern: "https://*.example.com/*",
        matchType: "glob",
      }),
    );
    assert.equal(
      { key: "validationInvalidRegex", code: "invalid" },
      api.validatePattern({ pattern: "[", matchType: "regex" }),
    );
  });

  should("render a disable toggle for every registered input module", () => {
    rules = [{
      id: "all-modules",
      pattern: "https://example.com/*",
      matchType: "glob",
      enabled: true,
      modules: {},
    }];
    editor.render();
    assert.equal(
      BrowserToolboxModuleRegistry.ids({ siteRule: true }),
      [...document.querySelectorAll("#site-rules [data-module]")]
        .map((element) => element.dataset.module),
    );
  });

  should("show a non-blocking warning for duplicate matching patterns", () => {
    rules = [
      { id: "first", pattern: "https://*.example.com/*", matchType: "glob", modules: {} },
      { id: "second", pattern: "https://*.example.com/*", matchType: "glob", modules: {} },
    ];
    editor.render();
    const warnings = Array.from(
      document.querySelectorAll(".browser-toolbox-site-rule-warning"),
    );
    assert.equal(2, warnings.length);
    assert.isTrue(warnings.every((warning) => !warning.hidden));
    assert.equal("siteRuleDuplicateWarning", warnings[0].textContent);
  });

  should("refresh duplicate warnings without replacing the edited input", () => {
    rules = [
      { id: "first", pattern: "https://first.example/*", matchType: "glob", modules: {} },
      { id: "second", pattern: "https://second.example/*", matchType: "glob", modules: {} },
    ];
    editor.render();
    const input = document.querySelector("tr[data-rule-id='second'] input[data-field='pattern']");
    input.value = "https://first.example/*";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(
      input,
      document.querySelector("tr[data-rule-id='second'] input[data-field='pattern']"),
    );
    assert.isTrue(
      Array.from(document.querySelectorAll(".browser-toolbox-site-rule-warning"))
        .every((warning) => !warning.hidden),
    );
  });
});

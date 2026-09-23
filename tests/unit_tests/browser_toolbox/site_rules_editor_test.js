/**
 * 网站规则编辑器的单元测试。
 * 测试输入为 glob、正则和模块规则，输出为校验及行操作断言。
 */
import "../test_helper.js";
import * as testHelper from "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/regex_safety.js";
import "../../../lib/browser_toolbox/module_registry.js";
import "../../../lib/browser_toolbox/settings_schema.js";
import "../../../lib/browser_toolbox/site_rule_matcher.js";
import "../../../pages/site_rules_editor.js";

context("Site rules editor", () => {
  let editor;
  let rules;

  should("validate shortcut origins without accepting paths, credentials, or wildcards", () => {
    const parse = BrowserToolboxSiteRulesEditor.parseSiteOrigin;
    assert.equal("https://example.com", parse("https://example.com"));
    assert.equal("http://localhost:8080", parse("http://localhost:8080"));
    assert.equal("http://[::1]:8080", parse("http://[::1]:8080"));
    for (
      const input of [
        "https://example.com/private",
        "https://example.com?secret=1",
        "https://example.com#secret",
        "https://user:pass@example.com",
        "chrome://settings",
        "file:///tmp/test",
        "https://*.example.com",
        "https://example.com/*",
        "invalid",
        null,
      ]
    ) assert.equal(null, parse(input));
  });

  should(
    "prepare an origin rule without changing existing rules or duplicating an exact match",
    () => {
      const api = BrowserToolboxSiteRulesEditor;
      const currentRules = [{
        id: "wildcard",
        pattern: "https://*.example.com/*",
        modules: { mouse: false },
      }];
      const prepared = api.prepareSiteRuleDraft(currentRules, "https://www.example.com");
      assert.isTrue(prepared.created);
      assert.equal("https://www.example.com/*", prepared.rule.pattern);
      assert.equal(2, currentRules.length);
      assert.equal({ mouse: false }, currentRules[0].modules);
      prepared.rule.modules.keyboard = false;
      const existing = api.prepareSiteRuleDraft(currentRules, "https://www.example.com");
      assert.isFalse(existing.created);
      assert.equal(prepared.rule.id, existing.rule.id);
      assert.equal({ keyboard: false }, existing.rule.modules);
      assert.equal(2, currentRules.length);
      assert.equal(null, api.prepareSiteRuleDraft(currentRules, "https://example.com/private"));
      assert.equal(2, currentRules.length);
    },
  );

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

  should("render and persist a built-in site profile preset", () => {
    rules = [{
      id: "profile-rule",
      pattern: "https://editor.example.com/*",
      matchType: "glob",
      modules: {},
    }];
    editor.render();
    const preset = document.querySelector(
      "#site-rules [data-profile-section='meta'][data-profile-field='preset']",
    );
    assert.isTrue(Boolean(preset));
    assert.equal(
      ["", "balanced", "editor", "reading", "custom"],
      [...preset.options].map((option) => option.value),
    );
    preset.value = "editor";
    preset.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal("editor", rules[0].profile.preset);
    assert.isFalse(rules[0].profile.mouse.enabled);
    assert.isFalse(rules[0].profile.superDrag.enabled);
    assert.equal(
      "editor",
      document.querySelector("#site-rules [data-profile-field='preset']").value,
    );

    const triggerButton = document.querySelector(
      "#site-rules [data-profile-section='mouse'][data-profile-field='triggerButton']",
    );
    triggerButton.value = "1";
    triggerButton.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(1, rules[0].profile.mouse.triggerButton);
  });
});

/**
 * 设置有效策略的单元测试。
 * 测试输入为全局设置、站点规则和会话覆盖，输出为有效模块状态断言。
 */
import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/settings_schema.js";
import "../../../lib/browser_toolbox/regex_safety.js";
import "../../../lib/browser_toolbox/module_registry.js";
import "../../../lib/browser_toolbox/settings_validator.js";
import "../../../lib/browser_toolbox/site_rule_matcher.js";
import "../../../lib/browser_toolbox/settings_policy.js";

context("Settings policy", () => {
  should("validate session overrides at the policy boundary", () => {
    const policy = globalThis.BrowserToolboxSettingsPolicy;
    assert.equal(
      { mouse: false },
      policy.validateSessionOverrides({ mouse: false, unknown: true }),
    );
    assert.throwsError(() => policy.validateSessionOverrides({ unknown: true }, { strict: true }));
    assert.throwsError(() => policy.validateSessionOverrides({ cursor: "yes" }));
  });

  should("compose site rules, Vimium exclusions and session overrides", () => {
    const schema = globalThis.BrowserToolboxSettingsSchema;
    const policy = globalThis.BrowserToolboxSettingsPolicy;
    const settings = schema.mergeSettings({
      siteRules: [{
        pattern: "^https://example\\.com/",
        matchType: "regex",
        modules: { mouse: false },
      }],
      exclusionRules: [{ pattern: "https://example.com/*", passKeys: "" }],
    });
    const effective = policy.withEffectiveSettings(settings, "https://example.com/page", {
      sessionOverrides: { mouse: true, cursor: false },
    });

    assert.isFalse(settings.effectiveModules != null);
    assert.isTrue(effective.effectiveModules.mouse);
    assert.isFalse(effective.effectiveModules.keyboard);
    assert.isFalse(effective.effectiveModules.cursor);
  });

  should("let the global switch disable every module last", () => {
    const schema = globalThis.BrowserToolboxSettingsSchema;
    const policy = globalThis.BrowserToolboxSettingsPolicy;
    const settings = schema.mergeSettings({ general: { enabled: false } });
    const modules = policy.resolveEffectiveModules(settings, "https://example.com/", {
      sessionOverrides: { mouse: true, keyboard: true },
    });
    assert.isFalse(modules.enabled);
    for (const name of globalThis.BrowserToolboxModuleRegistry.ids({ siteRule: true })) {
      assert.isFalse(modules[name]);
    }
  });

  should("apply built-in high-conflict rules while keeping them removable", () => {
    const schema = globalThis.BrowserToolboxSettingsSchema;
    const policy = globalThis.BrowserToolboxSettingsPolicy;
    const defaultSettings = schema.clone(schema.DEFAULT_SETTINGS);
    const docsModules = policy.resolveEffectiveModules(
      defaultSettings,
      "https://docs.google.com/document/d/example",
    );
    assert.isTrue(docsModules.keyboard);
    assert.isFalse(docsModules.mouse);
    assert.isFalse(docsModules.superDrag);

    defaultSettings.siteRules = defaultSettings.siteRules.filter((rule) =>
      rule.id !== "builtin-google-docs"
    );
    const afterRemoval = policy.resolveEffectiveModules(
      defaultSettings,
      "https://docs.google.com/document/d/example",
    );
    assert.isTrue(afterRemoval.mouse);
  });

  should("apply the most specific site profile before resolving module defaults", () => {
    const schema = globalThis.BrowserToolboxSettingsSchema;
    const policy = globalThis.BrowserToolboxSettingsPolicy;
    const settings = schema.mergeSettings({
      mouse: { activationDistancePx: 10, showTrail: true },
      siteRules: [
        {
          pattern: "https://*.example.com/*",
          profile: { preset: "reading", mouse: { activationDistancePx: 14, showTrail: false } },
        },
        {
          pattern: "https://docs.example.com/*",
          profile: { mouse: { enabled: false } },
        },
      ],
    });
    const effective = policy.withEffectiveSettings(settings, "https://docs.example.com/page");
    assert.equal(14, effective.mouse.activationDistancePx);
    assert.isFalse(effective.mouse.showTrail);
    assert.isFalse(effective.effectiveModules.mouse);
    assert.equal("reading", effective.effectiveSiteProfile.preset);
    assert.equal(false, effective.effectiveSiteProfile.mouse.enabled);
  });
});

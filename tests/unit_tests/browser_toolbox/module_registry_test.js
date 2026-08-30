/**
 * 模块注册表的单元测试。
 * 测试输入为模块元数据，输出为模块清单和默认状态断言。
 */
import "../test_helper.js";
import "../../../lib/browser_toolbox/module_registry.js";

context("BrowserToolbox module registry", () => {
  should("keep site-rule and session capabilities aligned", () => {
    assert.equal(
      ["keyboard", "mouse", "superDrag", "wheel", "rocker", "cursor", "documentFormatter"],
      BrowserToolboxModuleRegistry.ids({ siteRule: true }),
    );
    assert.equal(
      ["enabled", "keyboard", "mouse", "superDrag", "wheel", "rocker", "cursor"],
      BrowserToolboxModuleRegistry.SESSION_OVERRIDE_KEYS,
    );
    assert.isTrue(BrowserToolboxModuleRegistry.has("mouse"));
    assert.isFalse(BrowserToolboxModuleRegistry.has("unknown"));
  });

  should("derive defaults and disable every registered module", () => {
    const defaults = BrowserToolboxModuleRegistry.enabledDefaults({
        keyboard: { enabled: false },
        mouse: { enabled: true },
        tools: { documentFormatter: { enabled: false } },
    });
    assert.equal(
      {
        keyboard: false,
        mouse: true,
        superDrag: true,
        wheel: true,
        rocker: true,
        cursor: true,
        documentFormatter: false,
      },
      defaults,
    );
    BrowserToolboxModuleRegistry.disableAll(defaults);
    assert.equal(
      {
        keyboard: false,
        mouse: false,
        superDrag: false,
        wheel: false,
        rocker: false,
        cursor: false,
        documentFormatter: false,
      },
      defaults,
    );
  });
});

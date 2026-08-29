/**
 * 设置变更摘要的单元测试。
 * 测试输入为新旧设置快照，输出为稳定的差异路径和摘要断言。
 */
import "../test_helper.js";
import "../../../pages/settings_change_summary.js";

context("Settings change summary", () => {
  const summary = () => globalThis.BrowserToolboxSettingsChangeSummary;

  should("separate added, changed, and removed settings", () => {
    const result = summary().summarize(
      { general: { enabled: true }, obsolete: true },
      { general: { enabled: false }, added: true },
    );
    assert.equal(["added"], result.added);
    assert.equal(["general.enabled"], result.changed);
    assert.equal(["obsolete"], result.removed);
  });

  should("summarize binding arrays by stable ids", () => {
    const result = summary().summarize(
      { mouse: { bindings: [{ id: "old", enabled: true }, { id: "keep", enabled: true }] } },
      { mouse: { bindings: [{ id: "keep", enabled: false }, { id: "new", enabled: true }] } },
    );
    assert.equal(["mouse.bindings[new]"], result.added);
    assert.equal(["mouse.bindings[keep].enabled"], result.changed);
    assert.equal(["mouse.bindings[old]"], result.removed);
  });

  should("treat arrays without stable ids as one changed setting", () => {
    const result = summary().summarize(
      { exclusionRules: [{ pattern: "a" }] },
      { exclusionRules: [{ pattern: "b" }] },
    );
    assert.equal(["exclusionRules"], result.changed);
  });

  should("format the first path segment with a localized label", () => {
    assert.equal(
      "Mouse Gestures › activationDistancePx",
      summary().formatPath("mouse.activationDistancePx", { mouse: "Mouse Gestures" }),
    );
  });
});

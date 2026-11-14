// SPDX-License-Identifier: GPL-3.0-or-later
import "../test_helper.js";
import "../../../lib/settings.js";
import { inspectLegacyBackup } from "../../../pages/browser_toolbox/legacy_settings_backup.js";

context("旧键盘备份的字段检查", () => {
  should("报告忽略的顶层字段并保持旧版本迁移与显式空值", () => {
    const result = inspectLegacyBackup(JSON.stringify({
      settingsVersion: "2.3",
      newTabUrl: "about:newtab",
      searchEngines: "",
      exclusionRules: [],
      smoothScroll: false,
      unrelatedHistory: "合成敏感正文",
    }));
    assert.equal(["unrelatedHistory"], result.ignoredFields);
    assert.equal(["exclusionRules", "searchEngines", "smoothScroll"], result.recognizedFields);
    assert.equal(["newTabDestination"], result.convertedFields);
    assert.equal([], result.errorFields);
    assert.isFalse(result.truncated);
    assert.isFalse(JSON.stringify(result.ignoredFields).includes("合成敏感正文"));
    assert.equal("", result.patch.searchEngines);
    assert.equal([], result.patch.exclusionRules);
    assert.equal(false, result.patch.smoothScroll);
    assert.equal("browserNewTabPage", result.patch.newTabDestination);
    assert.isFalse(Object.hasOwn(result.patch, "unrelatedHistory"));
  });

  should("无效已识别字段在预览前报告字段路径，不提交或回显原值", () => {
    let failure;
    try {
      inspectLegacyBackup(JSON.stringify({
        settingsVersion: "2.4.2",
        scrollStepSize: "synthetic-private-value",
        exclusionRules: [{ pattern: "x" }],
      }));
    } catch (caught) {
      failure = caught;
    }
    assert.equal("INVALID_LEGACY_BACKUP_FIELDS", failure?.code);
    assert.equal(["exclusionRules[0]", "scrollStepSize"], failure?.conflicts);
    assert.isFalse(JSON.stringify(failure.conflicts).includes("synthetic-private-value"));
  });

  should("当前版本中不再迁移的旧新标签字段明确列为忽略", () => {
    const result = inspectLegacyBackup(JSON.stringify({
      settingsVersion: "2.4.2",
      newTabUrl: "https://example.invalid/ignored",
    }));
    assert.equal(["newTabUrl"], result.ignoredFields);
    assert.equal([], result.recognizedFields);
    assert.equal([], result.convertedFields);
  });

  should("排除规则的额外字段不能被表单静默丢弃", () => {
    let failure;
    try {
      inspectLegacyBackup(JSON.stringify({
        settingsVersion: "2.4.2",
        exclusionRules: [{ pattern: "https://example.invalid/*", passKeys: "", enabled: false }],
      }));
    } catch (caught) {
      failure = caught;
    }
    assert.equal("UNSUPPORTED_LEGACY_BACKUP_RULE_FIELDS", failure?.code);
    assert.equal(["exclusionRules[0].enabled"], failure?.conflicts);
  });

  should("旧版字符串编码规则解码后仍须检查未表达字段", () => {
    let failure;
    try {
      inspectLegacyBackup(JSON.stringify({
        exclusionRules: JSON.stringify([{ pattern: "x", passKeys: "", futureMode: true }]),
      }));
    } catch (caught) {
      failure = caught;
    }
    assert.equal("UNSUPPORTED_LEGACY_BACKUP_RULE_FIELDS", failure?.code);
    assert.equal(["exclusionRules[0].futureMode"], failure?.conflicts);
  });

  should("未知字段列表有界且不回显任意内容", () => {
    const input = { settingsVersion: "2.4.2" };
    for (let index = 0; index < 30; index++) input[`future${index}`] = "合成隐私正文";
    input["<不可信字段>"] = "合成隐私正文";
    const result = inspectLegacyBackup(JSON.stringify(input));
    assert.isTrue(result.truncated);
    assert.equal(20, result.ignoredFields.length);
    assert.isFalse(JSON.stringify(result.ignoredFields).includes("合成隐私正文"));
    assert.isFalse(JSON.stringify(result.ignoredFields).includes("<不可信字段>"));
  });
});

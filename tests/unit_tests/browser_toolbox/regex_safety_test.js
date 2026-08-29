/**
 * 站点规则正则安全分析的单元测试。
 * 测试输入为合法、非法和超复杂正则，输出为稳定的安全分类。
 */
import "../test_helper.js";
import "../../../lib/browser_toolbox/regex_safety.js";

context("BrowserToolbox regex safety", () => {
  const api = () => globalThis.BrowserToolboxRegexSafety;

  should("classify empty, oversized, and syntactically invalid patterns", () => {
    assert.equal("empty", api().analyze(null).reason);
    assert.equal("too-long", api().analyze("x".repeat(api().MAX_PATTERN_LENGTH + 1)).reason);
    assert.equal("syntax", api().analyze("[").reason);
  });

  should("reject bounded quantifier and alternative complexity", () => {
    assert.equal(
      "too-many-quantifiers",
      api().analyze(Array.from({ length: api().MAX_QUANTIFIERS + 1 }, () => "a*").join(""))
        .reason,
    );
    assert.equal(
      "too-many-alternatives",
      api().analyze(Array.from({ length: api().MAX_ALTERNATIONS + 2 }, () => "a").join("|")).reason,
    );
  });

  should("reject deeply nested groups and accept bounded expressions", () => {
    const depth = api().MAX_GROUP_DEPTH + 1;
    const nested = "(".repeat(depth) + "a" + ")".repeat(depth);
    assert.equal("too-deep", api().analyze(nested).reason);
    assert.isTrue(api().analyze("^https://example\\.com/(docs|editor)/$").ok);
  });
});

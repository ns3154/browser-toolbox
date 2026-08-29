// 站点规则正则安全检查：保留正则表达能力，同时拒绝明显的灾难性回溯形态。
/**
 * 正则安全分析结果。
 * @typedef {Object} BrowserToolboxRegexAnalysis
 * @property {boolean} ok 是否可以编译和使用。
 * @property {string|null} code 稳定分类。
 * @property {string|null} reason 机器可读原因。
 */
(function () {
  const MAX_PATTERN_LENGTH = 2048;
  const MAX_QUANTIFIERS = 32;
  const MAX_ALTERNATIONS = 64;
  const MAX_GROUP_DEPTH = 32;
  const NESTED_QUANTIFIER = /(?:\([^()\n]*[+*?][^()\n]*\)|\[[^\]\n]+\][+*?])\s*(?:[+*?]|\{\d)/;

  function unescaped(pattern) {
    return pattern.replace(/\\./g, "");
  }

  /**
   * 在编译前检查正则语法、长度和明显高风险结构。
   * @param {unknown} pattern 用户提供的正则。
   * @returns {BrowserToolboxRegexAnalysis} 分析结果。
   */
  function analyze(pattern) {
    if (typeof pattern !== "string" || pattern.length === 0) {
      return { ok: false, code: "invalid", reason: "empty" };
    }
    if (pattern.length > MAX_PATTERN_LENGTH) {
      return { ok: false, code: "length", reason: "too-long" };
    }
    try {
      new RegExp(pattern, "i");
    } catch (_) {
      return { ok: false, code: "invalid", reason: "syntax" };
    }
    const plain = unescaped(pattern);
    const quantifiers = plain.match(/[*+?]|\{\d/g) || [];
    if (quantifiers.length > MAX_QUANTIFIERS) {
      return { ok: false, code: "complexity", reason: "too-many-quantifiers" };
    }
    if ((plain.match(/\|/g) || []).length > MAX_ALTERNATIONS) {
      return { ok: false, code: "complexity", reason: "too-many-alternatives" };
    }
    if (NESTED_QUANTIFIER.test(pattern)) {
      return { ok: false, code: "complexity", reason: "nested-quantifier" };
    }
    let depth = 0;
    let maximumDepth = 0;
    for (const character of plain) {
      if (character === "(") {
        depth += 1;
        maximumDepth = Math.max(maximumDepth, depth);
      } else if (character === ")") {
        depth = Math.max(0, depth - 1);
      }
    }
    if (maximumDepth > MAX_GROUP_DEPTH) {
      return { ok: false, code: "complexity", reason: "too-deep" };
    }
    return { ok: true, code: null, reason: null };
  }

  globalThis.BrowserToolboxRegexSafety = Object.freeze({
    MAX_PATTERN_LENGTH,
    MAX_QUANTIFIERS,
    MAX_ALTERNATIONS,
    MAX_GROUP_DEPTH,
    analyze,
  });
})();

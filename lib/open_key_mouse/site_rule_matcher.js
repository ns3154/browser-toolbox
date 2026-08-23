// 站点规则匹配器。规则只根据顶层页面 URL 决定，避免 iframe 绕过用户的禁用设置。
(function () {
  function escapeRegExp(value) {
    return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }

  function compile(pattern) {
    if (typeof pattern !== "string" || pattern.length === 0 || pattern.length > 2048) return null;
    try {
      const source = pattern.split("*").map(escapeRegExp).join(".*");
      return new RegExp(`^${source}$`, "i");
    } catch (_) {
      return null;
    }
  }

  function specificity(pattern) {
    return pattern.replace(/\*/g, "").length * 100 - (pattern.match(/\*/g) || []).length;
  }

  function matches(rule, url) {
    return Boolean(compile(rule?.pattern)?.test(url));
  }

  function resolve(rules, url, defaults = {}) {
    const result = Object.assign({}, defaults);
    const matchesWithIndex = (rules || []).map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => matches(rule, url))
      .sort((a, b) =>
        specificity(a.rule.pattern) - specificity(b.rule.pattern) || a.index - b.index
      );
    for (const { rule } of matchesWithIndex) {
      if (rule.modules) Object.assign(result, rule.modules);
      if (rule.passKeys != null) result.passKeys = rule.passKeys;
      if (rule.enabled === false) result.enabled = false;
      if (rule.enabled === true) result.enabled = true;
    }
    return result;
  }

  function effectiveRule(rules, url) {
    const matched = (rules || []).map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => matches(rule, url))
      .sort((a, b) =>
        specificity(b.rule.pattern) - specificity(a.rule.pattern) || b.index - a.index
      );
    return matched[0]?.rule || null;
  }

  // Vimium 的 exclusion pattern 本身允许使用正则字符（例如 https?://），这里只复用其
  // 公开的 glob 约定，不执行任何配置中的脚本或表达式。
  function exclusionState(rules, url) {
    const matched = (rules || []).filter((rule) => {
      if (!rule?.pattern || typeof rule.pattern !== "string") return false;
      try {
        return new RegExp(`^${rule.pattern.replace(/\*/g, ".*")}$`).test(url);
      } catch (_) {
        return false;
      }
    });
    if (matched.some((rule) => !rule.passKeys)) return { disabled: true, passKeys: "" };
    return {
      disabled: false,
      passKeys: [...new Set(matched.flatMap((rule) => String(rule.passKeys || "").split(/\s+/)))]
        .join(""),
    };
  }

  globalThis.OpenKeyMouseSiteRuleMatcher = Object.freeze({
    compile,
    specificity,
    matches,
    resolve,
    effectiveRule,
    exclusionState,
  });
})();

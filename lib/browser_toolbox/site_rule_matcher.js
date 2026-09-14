// 站点规则匹配器。规则只根据顶层页面 URL 决定，避免 iframe 绕过用户的禁用设置。
/**
 * 站点规则的最小输入形状。
 * @typedef {Object} BrowserToolboxSiteRule
 * @property {string} [id] 规则 ID。
 * @property {string} [matchType] glob 或 regex。
 * @property {string} pattern 匹配式。
 * @property {boolean} [enabled] 规则总开关。
 * @property {Object<string, boolean>} [modules] 模块覆盖。
 * @property {string} [passKeys] Vimium 允许键。
 */
/**
 * 规则解释结果。
 * @typedef {Object} BrowserToolboxSiteRuleExplanation
 * @property {Array<Object>} matchedRules 命中的规则及原始索引。
 * @property {BrowserToolboxSiteRule|null} effectiveRule 最高优先级规则。
 * @property {Object} effective 合成后的模块状态。
 */
(function () {
  const moduleRegistry = globalThis.BrowserToolboxModuleRegistry;
  const DEFAULT_MATCH_TYPE = "glob";
  const MATCH_TYPES = Object.freeze(["glob", "regex"]);
  const MODULE_NAMES = Object.freeze(moduleRegistry.ids({ siteRule: true }));
  const compileCache = new Map();
  const MAX_COMPILE_CACHE_ENTRIES = 256;

  function regexIsSafe(pattern) {
    const safety = globalThis.BrowserToolboxRegexSafety;
    return !safety || safety.analyze(pattern).ok;
  }

  function escapeRegExp(value) {
    return value.replace(/[?+.{}()|[\]^$\\]/g, "\\$&");
  }

  /**
   * 编译 glob 或正则匹配式，并使用有界缓存。
   * @param {unknown} pattern 匹配式。
   * @param {string} [matchType] 匹配方式。
   * @returns {RegExp|null} 编译结果。
   */
  function compile(pattern, matchType = DEFAULT_MATCH_TYPE) {
    if (typeof pattern !== "string" || pattern.length === 0 || pattern.length > 2048) return null;
    if (!MATCH_TYPES.includes(matchType)) return null;
    if (matchType === "regex" && !regexIsSafe(pattern)) return null;
    const cacheKey = matchType + "\u0000" + pattern;
    if (compileCache.has(cacheKey)) return compileCache.get(cacheKey);
    try {
      const compiled = matchType === "regex"
        ? new RegExp(pattern, "i")
        : new RegExp("^" + pattern.split("*").map(escapeRegExp).join(".*") + "$", "i");
      if (compileCache.size >= MAX_COMPILE_CACHE_ENTRIES) {
        compileCache.delete(compileCache.keys().next().value);
      }
      compileCache.set(cacheKey, compiled);
      return compiled;
    } catch (_) {
      return null;
    }
  }

  function specificity(ruleOrPattern) {
    const isLegacyPattern = typeof ruleOrPattern === "string";
    const pattern = isLegacyPattern ? ruleOrPattern : ruleOrPattern?.pattern;
    const matchType = isLegacyPattern
      ? DEFAULT_MATCH_TYPE
      : ruleOrPattern?.matchType || DEFAULT_MATCH_TYPE;
    if (typeof pattern !== "string" || matchType === "regex") return 0;
    return pattern.replace(/\*/g, "").length * 100 - (pattern.match(/\*/g) || []).length;
  }

  function compileRule(rule) {
    return compile(rule?.pattern, rule?.matchType || DEFAULT_MATCH_TYPE);
  }

  function matches(rule, url) {
    return Boolean(compileRule(rule)?.test(url));
  }

  function applyMatchedRules(matchesWithIndex, defaults = {}) {
    const result = Object.assign({}, defaults);
    // matchingRules 按“最具体、配置靠后”排序；反转后按低优先级到高优先级合并，
    // 保证解释视图和实际运行时得到完全相同的覆盖结果。
    for (const { rule } of [...matchesWithIndex].reverse()) {
      if (rule.modules) Object.assign(result, rule.modules);
      if (rule.passKeys != null) result.passKeys = rule.passKeys;
      if (rule.enabled === false) {
        result.enabled = false;
        for (const name of MODULE_NAMES) {
          if (Object.hasOwn(result, name)) result[name] = false;
        }
      } else if (rule.enabled === true) {
        result.enabled = true;
      }
    }
    return result;
  }

  function isRecord(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
  }

  /**
   * 按与模块规则相同的优先级合并站点配置档；字段级合并允许窄规则只覆盖一个阈值。
   * @param {Array<Object>} matchesWithIndex 命中规则及索引。
   * @param {Object} [defaults] 默认配置档。
   * @returns {Object|null} 合并后的配置档或空值。
   */
  function applyMatchedProfiles(matchesWithIndex, defaults = {}) {
    const result = Object.assign({}, defaults);
    let found = false;
    for (const { rule } of [...matchesWithIndex].reverse()) {
      const profile = rule?.profile;
      if (!isRecord(profile)) continue;
      found = true;
      for (const name of ["mouse", "superDrag", "wheel", "rocker"]) {
        if (!isRecord(profile[name])) continue;
        result[name] = Object.assign({}, result[name] || {}, profile[name]);
      }
      for (const name of ["preset", "name"]) {
        if (profile[name] != null) result[name] = profile[name];
      }
    }
    return found ? result : null;
  }

  /**
   * 计算 URL 命中的最终模块状态。
   * @param {Array<BrowserToolboxSiteRule>} rules 规则列表。
   * @param {string} url 顶层页面 URL。
   * @param {Object} [defaults] 默认状态。
   * @returns {Object} 最终状态。
   */
  function resolve(rules, url, defaults = {}) {
    return applyMatchedRules(matchingRules(rules, url), defaults);
  }

  function effectiveRule(rules, url) {
    const matched = matchingRules(rules, url);
    return matched[0]?.rule || null;
  }

  function effectiveProfile(rules, url) {
    return applyMatchedProfiles(matchingRules(rules, url));
  }

  function matchingRules(rules, url) {
    return (rules || []).map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => matches(rule, url))
      .sort((a, b) => specificity(b.rule) - specificity(a.rule) || b.index - a.index);
  }

  function matchingKey(rule) {
    if (typeof rule?.pattern !== "string" || rule.pattern.length === 0) return null;
    return `${rule.matchType || DEFAULT_MATCH_TYPE}\u0000${rule.pattern}`;
  }

  function diagnose(rules) {
    const source = Array.isArray(rules) ? rules : [];
    const groups = new Map();
    source.forEach((rule, index) => {
      const key = matchingKey(rule);
      if (key == null) return;
      const indexes = groups.get(key) || [];
      indexes.push(index);
      groups.set(key, indexes);
    });
    return source.map((rule, index) => {
      const indexes = groups.get(matchingKey(rule)) || [];
      const duplicateIndexes = indexes.filter((duplicateIndex) => duplicateIndex !== index);
      return {
        index,
        duplicateIndexes,
        hasDuplicate: duplicateIndexes.length > 0,
      };
    });
  }

  /**
   * 返回规则命中与覆盖顺序解释。
   * @param {Array<BrowserToolboxSiteRule>} rules 规则列表。
   * @param {string} url 顶层页面 URL。
   * @param {Object} [defaults] 默认状态。
   * @returns {BrowserToolboxSiteRuleExplanation} 解释结果。
   */
  function explain(rules, url, defaults = {}) {
    const matched = matchingRules(rules, url);
    return {
      matchedRules: matched,
      effectiveRule: matched[0]?.rule || null,
      effective: applyMatchedRules(matched, defaults),
      effectiveProfile: applyMatchedProfiles(matched),
    };
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

  globalThis.BrowserToolboxSiteRuleMatcher = Object.freeze({
    DEFAULT_MATCH_TYPE,
    MATCH_TYPES,
    MODULE_NAMES,
    compile,
    compileRule,
    specificity,
    matches,
    applyMatchedRules,
    matchingRules,
    diagnose,
    resolve,
    effectiveRule,
    applyMatchedProfiles,
    effectiveProfile,
    explain,
    exclusionState,
  });
})();

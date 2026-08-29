// BrowserToolbox 有效设置策略：只计算运行时状态，不读取或写入浏览器存储。
/**
 * 运行时各模块的有效开关。
 * @typedef {Object} BrowserToolboxEffectiveModules
 * @property {boolean} enabled 全局开关。
 * @property {boolean} keyboard 键盘模块。
 * @property {boolean} mouse 鼠标轨迹模块。
 * @property {boolean} superDrag 超级拖拽模块。
 * @property {boolean} wheel 滚轮模块。
 * @property {boolean} rocker 摇杆模块。
 * @property {boolean} cursor 自定义指针模块。
 */
(function () {
  const schema = globalThis.BrowserToolboxSettingsSchema;
  const matcher = globalThis.BrowserToolboxSiteRuleMatcher;
  const moduleRegistry = globalThis.BrowserToolboxModuleRegistry;

  /**
   * 校验会话级模块覆盖。
   * @param {unknown} overrides 待校验覆盖映射。
   * @param {Object} [options] 是否严格拒绝未知键。
   * @returns {Object<string, boolean>} 有效覆盖映射。
   */
  function validateSessionOverrides(overrides, { strict = false } = {}) {
    const allowed = new Set(moduleRegistry.SESSION_OVERRIDE_KEYS);
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      throw new Error("Session overrides must contain only module booleans.");
    }
    const next = {};
    for (const [key, value] of Object.entries(overrides)) {
      if (!allowed.has(key)) {
        if (strict) throw new Error("Session overrides must contain only module booleans.");
        continue;
      }
      if (typeof value !== "boolean") {
        throw new Error("Session overrides must contain only module booleans.");
      }
      next[key] = value;
    }
    return schema.clone(next);
  }

  /**
   * 按全局设置、站点规则、Vimium 排除规则和会话覆盖合成最终状态。
   * @param {Object} settings BrowserToolbox 设置。
   * @param {string} [url] 顶层页面 URL。
   * @param {Object} [options] 外部排除规则和会话覆盖。
   * @returns {BrowserToolboxEffectiveModules} 有效模块状态。
   */
  function resolveEffectiveModules(
    settings,
    url = "",
    { exclusionRules = null, sessionOverrides = {} } = {},
  ) {
    const source = settings || schema.DEFAULT_SETTINGS;
    const modules = matcher.resolve(source.siteRules, url, {
      enabled: source.general.enabled,
      ...moduleRegistry.enabledDefaults(source),
    });
    const rules = exclusionRules == null ? source.exclusionRules : exclusionRules;
    if (matcher.exclusionState(rules, url).disabled) modules.keyboard = false;
    for (const [key, value] of Object.entries(sessionOverrides || {})) {
      if (moduleRegistry.SESSION_OVERRIDE_KEYS.includes(key) && typeof value === "boolean") {
        modules[key] = value;
      }
    }
    if (modules.enabled === false) moduleRegistry.disableAll(modules);
    return modules;
  }

  /**
   * 返回带有效模块状态的防御性设置副本。
   * @param {Object} settings BrowserToolbox 设置。
   * @param {string} [url] 顶层页面 URL。
   * @param {Object} [options] 状态合成选项。
   * @returns {Object} 带 effectiveModules 的设置。
   */
  function withEffectiveSettings(settings, url = "", options = {}) {
    const value = schema.clone(settings || schema.DEFAULT_SETTINGS);
    value.effectiveModules = resolveEffectiveModules(value, url, options);
    return value;
  }

  globalThis.BrowserToolboxSettingsPolicy = Object.freeze({
    validateSessionOverrides,
    resolveEffectiveModules,
    withEffectiveSettings,
  });
})();

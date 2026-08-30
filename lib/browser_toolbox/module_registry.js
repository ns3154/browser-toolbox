// BrowserToolbox 模块能力注册表：模块元数据只在这里维护，避免规则、会话和设置页各自复制清单。
/**
 * 一个可由站点规则和会话覆盖控制的输入模块。
 * @typedef {Object} BrowserToolboxModuleMetadata
 * @property {string} id 模块 ID。
 * @property {string} settingKey 设置路径。
 * @property {string} labelKey 本地化标签键。
 * @property {boolean} siteRule 是否支持站点规则。
 * @property {boolean} sessionOverride 是否支持会话覆盖。
 */
(function () {
  const MODULES = Object.freeze([
    Object.freeze({
      id: "keyboard",
      settingKey: "keyboard",
      labelKey: "keyboard",
      siteRule: true,
      sessionOverride: true,
    }),
    Object.freeze({
      id: "mouse",
      settingKey: "mouse",
      labelKey: "mouseGestures",
      siteRule: true,
      sessionOverride: true,
    }),
    Object.freeze({
      id: "superDrag",
      settingKey: "superDrag",
      labelKey: "superDrag",
      siteRule: true,
      sessionOverride: true,
    }),
    Object.freeze({
      id: "wheel",
      settingKey: "wheel",
      labelKey: "wheelRocker",
      siteRule: true,
      sessionOverride: true,
    }),
    Object.freeze({
      id: "rocker",
      settingKey: "rocker",
      labelKey: "rocker",
      siteRule: true,
      sessionOverride: true,
    }),
    Object.freeze({
      id: "cursor",
      settingKey: "cursor",
      labelKey: "cursor",
      siteRule: true,
      sessionOverride: true,
    }),
    Object.freeze({
      id: "documentFormatter",
      settingPath: ["tools", "documentFormatter"],
      settingKey: "tools.documentFormatter",
      labelKey: "documentFormatter",
      siteRule: true,
      sessionOverride: false,
    }),
  ]);
  const MODULE_IDS = Object.freeze(MODULES.map((module) => module.id));
  const SITE_RULE_MODULE_IDS = Object.freeze(
    MODULES.filter((module) => module.siteRule).map((module) => module.id),
  );
  const SESSION_OVERRIDE_KEYS = Object.freeze([
    "enabled",
    ...MODULES.filter((module) => module.sessionOverride).map((module) => module.id),
  ]);

  /**
   * 按能力筛选模块元数据。
   * @param {Object} [options] 筛选条件。
   * @returns {Array<BrowserToolboxModuleMetadata>} 模块列表。
   */
  function entries({ siteRule = false, sessionOverride = false } = {}) {
    return MODULES.filter((module) =>
      (!siteRule || module.siteRule) && (!sessionOverride || module.sessionOverride)
    );
  }

  /**
   * 返回模块 ID 列表。
   * @param {Object} [options] 筛选条件。
   * @returns {Array<string>} 模块 ID。
   */
  function ids(options) {
    return entries(options).map((module) => module.id);
  }

  function has(id) {
    return MODULE_IDS.includes(id);
  }

  function labelKey(id) {
    return MODULES.find((module) => module.id === id)?.labelKey || id;
  }

  /**
   * 从设置生成各模块的默认启用状态。
   * @param {Object} settings BrowserToolbox 设置。
   * @returns {Object<string, boolean>} 模块状态映射。
   */
  function enabledDefaults(settings) {
    return Object.fromEntries(
      MODULES.map((module) => [
        module.id,
        (module.settingPath || [module.settingKey]).reduce(
          (value, key) => value?.[key],
          settings,
        )?.enabled !== false,
      ]),
    );
  }

  function disableAll(value) {
    for (const id of MODULE_IDS) value[id] = false;
    return value;
  }

  globalThis.BrowserToolboxModuleRegistry = Object.freeze({
    MODULES,
    MODULE_IDS,
    SITE_RULE_MODULE_IDS,
    SESSION_OVERRIDE_KEYS,
    entries,
    ids,
    has,
    labelKey,
    enabledDefaults,
    disableAll,
  });
})();

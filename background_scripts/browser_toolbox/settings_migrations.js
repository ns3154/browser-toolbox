// BrowserToolbox 配置逐级迁移。每一步只增加或转换已知结构，不静默删除未知字段。
/**
 * 导出文件解析结果。
 * @typedef {Object} BrowserToolboxExportParseResult
 * @property {boolean} ok 是否通过格式检查。
 * @property {Object} [settings] 导入设置。
 * @property {Array<string>} [unknown] 未识别字段路径。
 * @property {Array<string>} [preserved] 被保留的未知设置字段路径。
 * @property {Array<string>} [ignored] 未导入字段路径。
 * @property {string} [code] 失败代码。
 */
(function () {
  const schema = globalThis.BrowserToolboxSettingsSchema;
  const COMMAND_PREFIX = "BrowserToolbox.";
  const LEGACY_COMMAND_PREFIX = "OpenKeyMouse.";
  const EXPORT_FORMAT = "browser-toolbox-settings";
  const LEGACY_EXPORT_FORMAT = "open-key-mouse-settings";
  const CURRENT_EXPORT_FORMAT_VERSION = 1;
  const EXPORT_FORMATS = Object.freeze([EXPORT_FORMAT, LEGACY_EXPORT_FORMAT]);
  const MAX_UNKNOWN_FIELDS = 100;

  const ROOT_SETTING_KEYS = new Set([
    "settingsVersion",
    "schemaVersion",
    "general",
    "keyboard",
    "mouse",
    "superDrag",
    "wheel",
    "rocker",
    "cursor",
    "siteRules",
    "exclusionRules",
    "searchEngines",
    "privacy",
    // 这是 schemaVersion=0 的迁移入口，不能在报告中误判为未知字段。
    "gestureBindings",
  ]);
  const SECTION_KEYS = Object.freeze({
    general: new Set(["enabled", "showHud", "language", "browserSyncEnabled"]),
    keyboard: new Set(["enabled", "keyMappings"]),
    mouse: new Set([
      "enabled",
      "triggerButton",
      "directionMode",
      "activationDistancePx",
      "sampleDistancePx",
      "minimumSegmentDistancePx",
      "turnHysteresisDegrees",
      "maxSegments",
      "maxDurationMs",
      "showTrail",
      "showCommandHud",
      "suppressContextMenuAfterActivation",
      "bindings",
    ]),
    superDrag: new Set(["enabled", "nativeBypassModifier", "bindings"]),
    wheel: new Set(["enabled", "threshold", "cooldownMs", "continuousTabSwitching", "bindings"]),
    rocker: new Set(["enabled", "bindings"]),
    cursor: new Set(["enabled", "localAssetId", "hotspotX", "hotspotY"]),
    privacy: new Set(["telemetry", "remoteConfig", "backgroundNetwork"]),
  });
  const BINDING_KEYS = new Set([
    "id",
    "enabled",
    "pattern",
    "commandName",
    "options",
    "context",
    "button",
    "direction",
    "sequence",
  ]);
  const SITE_RULE_KEYS = new Set([
    "id",
    "matchType",
    "pattern",
    "enabled",
    "modules",
    "passKeys",
    "notes",
  ]);
  const SITE_RULE_MODULE_KEYS = new Set([
    "keyboard",
    "mouse",
    "superDrag",
    "wheel",
    "rocker",
    "cursor",
  ]);
  const EXCLUSION_RULE_KEYS = new Set(["pattern", "passKeys"]);
  const EXPORT_WRAPPER_KEYS = new Set([
    "format",
    "formatVersion",
    "exportedAt",
    "extensionVersion",
    "source",
    "settings",
    "localAssets",
  ]);

  function migrateCommandName(commandName) {
    if (typeof commandName !== "string") return commandName;
    return commandName.startsWith(LEGACY_COMMAND_PREFIX)
      ? `${COMMAND_PREFIX}${commandName.slice(LEGACY_COMMAND_PREFIX.length)}`
      : commandName;
  }

  function migrateCommandNamespaces(input) {
    const next = schema.mergeSettings(input);
    for (const section of ["mouse", "superDrag", "wheel", "rocker"]) {
      // 结构不完整时先原样交给校验器，迁移层不能因为坏数据抛出 TypeError。
      if (!Array.isArray(next[section]?.bindings)) continue;
      next[section].bindings = next[section].bindings.map((binding) => {
        if (!binding || typeof binding !== "object" || Array.isArray(binding)) return binding;
        // 早期配置没有 options 字段；迁移时补齐空对象，仍让显式非法值交给校验器拒绝。
        return {
          ...binding,
          ...(Object.hasOwn(binding, "options") ? {} : { options: {} }),
          commandName: migrateCommandName(binding.commandName),
        };
      });
    }
    return next;
  }

  function migrate0To1(input) {
    const next = schema.mergeSettings(input);
    next.schemaVersion = 1;
    if (Array.isArray(input?.gestureBindings) && !input.mouse?.bindings) {
      next.mouse.bindings = input.gestureBindings;
    }
    delete next.gestureBindings;
    return next;
  }

  function migrate1To2(input) {
    const next = schema.mergeSettings(input);
    next.schemaVersion = 2;
    next.general ||= {};
    next.general.language ||= "auto";
    next.superDrag ||= schema.clone(schema.DEFAULT_SETTINGS.superDrag);
    next.wheel ||= schema.clone(schema.DEFAULT_SETTINGS.wheel);
    next.rocker ||= schema.clone(schema.DEFAULT_SETTINGS.rocker);
    return next;
  }

  function migrate2To3(input) {
    const next = schema.mergeSettings(input);
    next.schemaVersion = 3;
    next.privacy = { telemetry: false, remoteConfig: false, backgroundNetwork: false };
    next.cursor ||= schema.clone(schema.DEFAULT_SETTINGS.cursor);
    return next;
  }

  function migrate3To4(input) {
    const next = schema.mergeSettings(input);
    next.schemaVersion = 4;
    if (!Array.isArray(next.siteRules)) return next;
    next.siteRules = next.siteRules.map((rule) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return rule;
      return {
        ...rule,
        matchType: rule.matchType == null ? "glob" : rule.matchType,
        enabled: rule.enabled == null ? true : rule.enabled,
      };
    });
    return next;
  }

  function isRecord(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
  }

  function addUnknownField(output, path) {
    if (!path || output.length >= MAX_UNKNOWN_FIELDS || output.includes(path)) return;
    output.push(path);
  }

  function collectObjectUnknownFields(value, allowedKeys, path, output) {
    if (!isRecord(value)) return;
    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) addUnknownField(output, path ? `${path}.${key}` : key);
    }
  }

  function collectBindingUnknownFields(bindings, path, output) {
    if (!Array.isArray(bindings)) return;
    for (const [index, binding] of bindings.entries()) {
      collectObjectUnknownFields(binding, BINDING_KEYS, `${path}[${index}]`, output);
      // options 是命令注册表定义的开放数据对象，不能把每个命令选项误报成未知字段。
    }
  }

  /**
   * 收集设置对象中无法由当前元数据识别的字段路径。
   * @param {unknown} settings 设置对象。
   * @returns {Array<string>} 未知字段路径。
   */
  function collectSettingsUnknownFields(settings) {
    const output = [];
    if (!isRecord(settings)) {
      addUnknownField(output, "settings");
      return output;
    }
    collectObjectUnknownFields(settings, ROOT_SETTING_KEYS, "", output);
    for (const [sectionName, keys] of Object.entries(SECTION_KEYS)) {
      const section = settings[sectionName];
      collectObjectUnknownFields(section, keys, sectionName, output);
      if (
        sectionName !== "general" && sectionName !== "keyboard" && sectionName !== "cursor" &&
        sectionName !== "privacy"
      ) {
        collectBindingUnknownFields(section?.bindings, `${sectionName}.bindings`, output);
      }
    }
    collectBindingUnknownFields(settings.gestureBindings, "gestureBindings", output);
    if (Array.isArray(settings.siteRules)) {
      for (const [index, rule] of settings.siteRules.entries()) {
        const path = `siteRules[${index}]`;
        collectObjectUnknownFields(rule, SITE_RULE_KEYS, path, output);
        collectObjectUnknownFields(rule?.modules, SITE_RULE_MODULE_KEYS, `${path}.modules`, output);
      }
    }
    if (Array.isArray(settings.exclusionRules)) {
      for (const [index, rule] of settings.exclusionRules.entries()) {
        collectObjectUnknownFields(rule, EXCLUSION_RULE_KEYS, `exclusionRules[${index}]`, output);
      }
    }
    return output;
  }

  /**
   * 收集导出包装层和设置层的未知字段，并区分是否会被保留。
   * @param {Object} payload 导出文件对象。
   * @returns {{unknown: Array<string>, preserved: Array<string>, ignored: Array<string>}} 字段报告。
   */
  function collectExportUnknownFields(payload) {
    const wrapperUnknown = [];
    collectObjectUnknownFields(payload, EXPORT_WRAPPER_KEYS, "", wrapperUnknown);
    const ignored = [...wrapperUnknown];
    const preserved = collectSettingsUnknownFields(payload.settings).map((path) =>
      `settings.${path}`
    );
    // 本地资源刻意不跨设备导入；有内容时要明确列出，而不是静默忽略。
    if (
      Object.hasOwn(payload, "localAssets") &&
      (!Array.isArray(payload.localAssets) || payload.localAssets.length > 0)
    ) {
      addUnknownField(ignored, "localAssets");
    }
    const unknown = [...wrapperUnknown, ...preserved];
    for (const field of ignored) {
      if (!wrapperUnknown.includes(field)) unknown.push(field);
    }
    return {
      unknown,
      preserved,
      ignored,
    };
  }

  /**
   * 创建稳定的规范导出对象。
   * @param {Object} settings 待导出的设置。
   * @param {Object} [options] 导出元数据。
   * @returns {Object} 导出对象。
   */
  function createExportPayload(settings, { extensionVersion = "", exportedAt } = {}) {
    return {
      format: EXPORT_FORMAT,
      formatVersion: CURRENT_EXPORT_FORMAT_VERSION,
      exportedAt: exportedAt || new Date().toISOString(),
      extensionVersion,
      source: "BrowserToolbox",
      settings: schema.clone(settings),
      // 本地指针二进制资源不进入导出文件，避免悬空引用和意外跨设备传播。
      localAssets: [],
    };
  }

  /**
   * 解析当前或兼容旧版的导出包装。
   * @param {unknown} payload 导出对象。
   * @returns {BrowserToolboxExportParseResult|null} 解析结果或非本项目格式。
   */
  function parseExportPayload(payload) {
    if (!isRecord(payload) || !EXPORT_FORMATS.includes(payload.format)) return null;
    if (!isRecord(payload.settings)) return { ok: false, code: "invalid-settings" };
    const formatVersion = payload.formatVersion == null ? 1 : payload.formatVersion;
    if (formatVersion !== CURRENT_EXPORT_FORMAT_VERSION) {
      return { ok: false, code: "unsupported-format-version" };
    }
    return {
      ok: true,
      format: payload.format,
      formatVersion,
      settings: schema.clone(payload.settings),
      ...collectExportUnknownFields(payload),
    };
  }

  /**
   * 将设置从旧 schema 逐级迁移到当前版本。
   * @param {Object} input 旧设置。
   * @returns {Object} 当前 schema 设置。
   */
  function migrate(input) {
    // 先保留旧版本原始字段，避免默认配置提前补齐后遮蔽 gestureBindings 等迁移入口。
    let current = schema.clone(input || {});
    let version = Number.isInteger(current.schemaVersion) ? current.schemaVersion : 0;
    while (version < schema.CURRENT_SCHEMA_VERSION) {
      if (version === 0) current = migrate0To1(current);
      else if (version === 1) current = migrate1To2(current);
      else if (version === 2) current = migrate2To3(current);
      else if (version === 3) current = migrate3To4(current);
      else throw new Error(`Unsupported settings schema: ${version}`);
      version = current.schemaVersion;
    }
    return migrateCommandNamespaces(current);
  }

  /**
   * 解析并迁移导出文件中的设置。
   * @param {unknown} payload 导出对象。
   * @returns {BrowserToolboxExportParseResult|null} 迁移结果。
   */
  function migrateExportPayload(payload) {
    const parsed = parseExportPayload(payload);
    if (!parsed || !parsed.ok) return parsed;
    return { ...parsed, settings: migrate(parsed.settings) };
  }

  globalThis.BrowserToolboxSettingsMigrations = Object.freeze({
    COMMAND_PREFIX,
    LEGACY_COMMAND_PREFIX,
    EXPORT_FORMAT,
    LEGACY_EXPORT_FORMAT,
    CURRENT_EXPORT_FORMAT_VERSION,
    EXPORT_FORMATS,
    migrate0To1,
    migrate1To2,
    migrate2To3,
    migrate3To4,
    migrateCommandName,
    migrateCommandNamespaces,
    collectSettingsUnknownFields,
    collectExportUnknownFields,
    migrate,
    createExportPayload,
    parseExportPayload,
    migrateExportPayload,
  });
})();

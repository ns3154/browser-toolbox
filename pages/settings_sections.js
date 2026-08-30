// 设置页的静态元数据和表单字段绑定。
// 新增设置分区时只需要注册分区和面板，不再同时修改导航控制器与整页读写函数。
/**
 * 设置表单字段定义。
 * @typedef {Object} BrowserToolboxFormField
 * @property {string} id DOM 控件 ID。
 * @property {string} path 配置字段路径。
 * @property {string} type 控件值类型。
 */
(function () {
  const GROUPS = Object.freeze([
    { id: "browsingEnhancement", labelKey: "browsingEnhancement" },
    { id: "utilityTools", labelKey: "utilityTools" },
    { id: "system", labelKey: "system" },
  ]);

  const SECTIONS = Object.freeze([
    {
      id: "mouse",
      group: "browsingEnhancement",
      labelKey: "mouseGestures",
      searchKeys: [
        "enabled",
        "triggerButton",
        "mouseTriggerButtonHint",
        "directionMode",
        "activationDistance",
        "sampleDistance",
        "minimumSegmentDistance",
        "turnHysteresis",
        "maxSegments",
        "maxDuration",
        "showTrail",
        "showHud",
        "suppressContextMenu",
        "pattern",
        "command",
        "options",
      ],
    },
    {
      id: "superDrag",
      group: "browsingEnhancement",
      labelKey: "superDrag",
      searchKeys: [
        "enabled",
        "nativeBypassModifier",
        "superDragSafety",
        "context",
        "pattern",
        "command",
        "options",
      ],
    },
    {
      id: "wheel",
      group: "browsingEnhancement",
      labelKey: "wheelRocker",
      searchKeys: [
        "enabled",
        "wheelThreshold",
        "cooldown",
        "continuousTabSwitching",
        "button",
        "direction",
        "rocker",
        "sequence",
        "command",
        "options",
      ],
    },
    {
      id: "keyboard",
      group: "browsingEnhancement",
      labelKey: "keyboard",
      searchKeys: ["keyMappings", "keyboardMappingNote"],
    },
    {
      id: "search",
      group: "browsingEnhancement",
      labelKey: "searchAndTabs",
      searchKeys: ["searchEngines", "searchEngineNote"],
    },
    {
      id: "general",
      group: "browsingEnhancement",
      labelKey: "general",
      searchKeys: ["enabled", "showHud", "browserSyncEnabled", "language"],
    },
    {
      id: "toolsOverview",
      group: "utilityTools",
      labelKey: "toolsOverview",
      searchKeys: [
        "actionTools",
        "contextMenuTools",
        "toolSelectionLimit",
        "toolLocalOnly",
        "toolEnabled",
        "contextMenuEnabled",
        "toolDirectory",
        "toolOverviewDescription",
        "toolOpen",
      ],
    },
    {
      id: "jsonFormatter",
      group: "utilityTools",
      labelKey: "jsonFormatter",
      searchKeys: [
        "documentFormatter",
        "documentFormatterEnabled",
        "documentFormatterAutoFormat",
        "documentFormatterAutoJson",
        "documentFormatterAutoXml",
        "documentFormatterAutoCss",
        "documentFormatterAutoJavascript",
        "documentFormatterAutoJava",
        "documentFormatterMaxAutoBytes",
        "documentFormatterJsonDefaults",
      ],
    },
    {
      id: "textDiff",
      group: "utilityTools",
      labelKey: "textDiff",
      searchKeys: ["textDiffSettingsDescription", "toolTextDiff", "toolOpen"],
    },
    {
      id: "codecTransform",
      group: "utilityTools",
      labelKey: "codecTransform",
      searchKeys: ["codecTransformSettingsDescription", "toolCodecTransform", "toolOpen"],
    },
    {
      id: "timeAndId",
      group: "utilityTools",
      labelKey: "timeAndId",
      searchKeys: [
        "timeAndIdSettingsDescription",
        "toolTimeConvert",
        "toolIdGenerate",
        "toolPasswordGenerate",
        "toolOpen",
      ],
    },
    {
      id: "appearance",
      group: "system",
      labelKey: "appearance",
      searchKeys: ["cursor", "cursorAsset", "cursorHotspotX", "cursorHotspotY", "resetCursor"],
    },
    {
      id: "siteRules",
      group: "system",
      labelKey: "siteRules",
      searchKeys: [
        "siteRuleSpecificity",
        "siteRuleOrder",
        "siteRulePrecedence",
        "siteRuleMatchType",
        "siteRuleGlob",
        "siteRuleRegex",
        "siteRuleEnabled",
        "siteRuleDisableModules",
        "siteRuleActions",
        "addRule",
        "siteRuleTestUrl",
        "testSiteUrl",
        "siteRuleExplanationTitle",
      ],
    },
    {
      id: "privacy",
      group: "system",
      labelKey: "privacy",
      searchKeys: ["noTelemetry", "privacyImmutable", "privacyNetwork", "licenseGpl"],
    },
    {
      id: "backupAbout",
      group: "system",
      labelKey: "backupAbout",
      searchKeys: [
        "backupContents",
        "vimiumBackup",
        "restoreDefaults",
        "exportSettings",
        "importSettings",
        "aboutText",
        "openOnboarding",
        "thirdPartyNotices",
      ],
    },
  ]);

  // type 只描述 DOM 值与配置值之间的转换，不承担业务校验；最终校验仍由 settings_validator 负责。
  const FORM_FIELDS = Object.freeze([
    { id: "general-enabled", path: "general.enabled", type: "checkbox" },
    { id: "global-show-hud", path: "general.showHud", type: "checkbox" },
    { id: "browser-sync-enabled", path: "general.browserSyncEnabled", type: "checkbox" },
    { id: "keyboard-enabled", path: "keyboard.enabled", type: "checkbox" },
    { id: "language", path: "general.language", type: "value" },
    { id: "key-mappings", path: "keyboard.keyMappings", type: "value" },
    { id: "search-engines", path: "searchEngines", type: "value" },
    { id: "tools-enabled", path: "tools.enabled", type: "checkbox" },
    { id: "context-menu-enabled", path: "tools.contextMenu.enabled", type: "checkbox" },
    { id: "document-formatter-enabled", path: "tools.documentFormatter.enabled", type: "checkbox" },
    { id: "document-auto-json", path: "tools.documentFormatter.autoFormat.json", type: "checkbox" },
    { id: "document-auto-xml", path: "tools.documentFormatter.autoFormat.xml", type: "checkbox" },
    { id: "document-auto-css", path: "tools.documentFormatter.autoFormat.css", type: "checkbox" },
    { id: "document-auto-javascript", path: "tools.documentFormatter.autoFormat.javascript", type: "checkbox" },
    { id: "document-auto-java", path: "tools.documentFormatter.autoFormat.java", type: "checkbox" },
    { id: "document-max-auto-bytes", path: "tools.documentFormatter.maxAutoBytes", type: "number" },
    { id: "document-json-sort", path: "tools.documentFormatter.json.defaultSort", type: "value" },
    { id: "document-json-collapse-depth", path: "tools.documentFormatter.json.defaultCollapseDepth", type: "nullableNumber" },
    { id: "mouse-enabled", path: "mouse.enabled", type: "checkbox" },
    { id: "trigger-button", path: "mouse.triggerButton", type: "number" },
    { id: "direction-mode", path: "mouse.directionMode", type: "value" },
    { id: "activation-distance", path: "mouse.activationDistancePx", type: "number" },
    { id: "sample-distance", path: "mouse.sampleDistancePx", type: "number" },
    { id: "minimum-segment-distance", path: "mouse.minimumSegmentDistancePx", type: "number" },
    { id: "turn-hysteresis", path: "mouse.turnHysteresisDegrees", type: "number" },
    { id: "max-segments", path: "mouse.maxSegments", type: "number" },
    { id: "max-duration", path: "mouse.maxDurationMs", type: "number" },
    { id: "show-trail", path: "mouse.showTrail", type: "checkbox" },
    { id: "show-command-hud", path: "mouse.showCommandHud", type: "checkbox" },
    {
      id: "suppress-context-menu",
      path: "mouse.suppressContextMenuAfterActivation",
      type: "checkbox",
    },
    { id: "super-drag-enabled", path: "superDrag.enabled", type: "checkbox" },
    { id: "native-bypass-modifier", path: "superDrag.nativeBypassModifier", type: "value" },
    { id: "wheel-enabled", path: "wheel.enabled", type: "checkbox" },
    { id: "wheel-threshold", path: "wheel.threshold", type: "number" },
    { id: "wheel-cooldown", path: "wheel.cooldownMs", type: "number" },
    { id: "wheel-continuous", path: "wheel.continuousTabSwitching", type: "checkbox" },
    { id: "rocker-enabled", path: "rocker.enabled", type: "checkbox" },
    { id: "cursor-enabled", path: "cursor.enabled", type: "checkbox" },
    { id: "cursor-hotspot-x", path: "cursor.hotspotX", type: "number" },
    { id: "cursor-hotspot-y", path: "cursor.hotspotY", type: "number" },
  ]);

  function pathParts(path) {
    return String(path).split(".").filter(Boolean);
  }

  /**
   * 按点分隔路径读取配置值。
   * @param {Object} target 配置对象。
   * @param {string} path 点分隔路径。
   * @returns {unknown} 字段值。
   */
  function getPath(target, path) {
    let current = target;
    for (const part of pathParts(path)) current = current?.[part];
    return current;
  }

  /**
   * 按点分隔路径写入配置值。
   * @param {Object} target 配置对象。
   * @param {string} path 点分隔路径。
   * @param {unknown} value 字段值。
   * @returns {void}
   */
  function setPath(target, path, value) {
    const parts = pathParts(path);
    if (parts.length === 0) return;
    let current = target;
    for (const part of parts.slice(0, -1)) {
      if (!current[part] || typeof current[part] !== "object") current[part] = {};
      current = current[part];
    }
    current[parts.at(-1)] = value;
  }

  function readField(element, type) {
    if (type === "checkbox") return Boolean(element.checked);
    if (type === "nullableNumber") return element.value.trim() === "" ? null : Number(element.value);
    if (type === "number") return Number(element.value);
    return element.value;
  }

  function writeField(element, type, value) {
    if (type === "checkbox") element.checked = Boolean(value);
    else if (type === "nullableNumber") element.value = value == null ? "" : value;
    else element.value = value ?? "";
  }

  /**
   * 从页面控件读取配置字段。
   * @param {Object} settings 目标配置对象。
   * @param {Document} [root] 控件所在文档。
   * @returns {Object} 更新后的配置对象。
   */
  function readForm(settings, root = globalThis.document) {
    for (const field of FORM_FIELDS) {
      const element = root?.querySelector?.(`#${field.id}`);
      if (element) setPath(settings, field.path, readField(element, field.type));
    }
    return settings;
  }

  /**
   * 将配置字段写回页面控件。
   * @param {Object} settings 配置对象。
   * @param {Document} [root] 控件所在文档。
   * @returns {Object} 原配置对象。
   */
  function writeForm(settings, root = globalThis.document) {
    for (const field of FORM_FIELDS) {
      const element = root?.querySelector?.(`#${field.id}`);
      if (element) writeField(element, field.type, getPath(settings, field.path));
    }
    return settings;
  }

  function validateRegistry(groups = GROUPS, sections = SECTIONS) {
    const groupIds = new Set();
    for (const group of groups) {
      if (!group?.id || groupIds.has(group.id)) {
        throw new Error(`Duplicate settings group: ${group?.id}`);
      }
      groupIds.add(group.id);
    }
    const sectionIds = new Set();
    for (const section of sections) {
      if (!section?.id || sectionIds.has(section.id)) {
        throw new Error(`Duplicate settings section: ${section?.id}`);
      }
      if (!groupIds.has(section.group)) {
        throw new Error(`Unknown settings group: ${section.group}`);
      }
      sectionIds.add(section.id);
    }
    return true;
  }

  validateRegistry();
  globalThis.BrowserToolboxSettingsSections = Object.freeze({
    GROUPS,
    SECTIONS,
    FORM_FIELDS,
    getPath,
    setPath,
    readForm,
    writeForm,
    validateRegistry,
  });
})();

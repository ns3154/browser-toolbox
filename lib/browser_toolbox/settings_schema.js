// BrowserToolbox 配置的默认值。Vimium 原有设置仍由 lib/settings.js 管理，这里只管理新增模块。
/**
 * BrowserToolbox 设置对象。具体业务字段由默认值和校验器共同约束。
 * @typedef {Object} BrowserToolboxSettings
 * @property {string|number} settingsVersion 配置格式版本。
 * @property {number} schemaVersion 逐级迁移版本。
 * @property {Object} general 常规设置。
 * @property {Object} keyboard 键盘设置副本。
 * @property {Object} mouse 鼠标轨迹设置。
 * @property {Object} superDrag 超级拖拽设置。
 * @property {Object} wheel 滚轮设置。
 * @property {Object} rocker 摇杆设置。
 * @property {Object} cursor 自定义指针设置。
 * @property {Array<Object>} siteRules 站点规则。
 * @property {Array<Object>} exclusionRules Vimium 排除规则副本。
 * @property {string} searchEngines 搜索引擎配置副本。
 * @property {Object} privacy 不可开启的隐私保证。
 */
(function () {
  const clone = globalThis.BrowserToolboxValueUtils.clone;
  const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const HIGH_CONFLICT_MODULES = Object.freeze({
    mouse: false,
    superDrag: false,
    wheel: false,
    rocker: false,
    cursor: false,
  });

  function defaultSiteRule(id, pattern) {
    return Object.freeze({
      id,
      matchType: "glob",
      pattern,
      enabled: true,
      modules: HIGH_CONFLICT_MODULES,
    });
  }

  // 编辑器类网站默认关闭容易误触的鼠标输入模块；用户可以修改或删除这些规则。
  const DEFAULT_SITE_RULES = Object.freeze([
    defaultSiteRule("builtin-google-docs", "https://docs.google.com/*"),
    defaultSiteRule("builtin-notion", "https://*.notion.so/*"),
    defaultSiteRule("builtin-stackblitz", "https://stackblitz.com/*"),
    defaultSiteRule("builtin-codesandbox", "https://codesandbox.io/*"),
    defaultSiteRule("builtin-codepen", "https://codepen.io/*"),
  ]);

  const defaultSettings = {
    settingsVersion: "0.1.0",
    schemaVersion: 4,
    general: {
      enabled: true,
      showHud: true,
      language: "auto",
      browserSyncEnabled: true,
    },
    keyboard: { enabled: true, keyMappings: "# Insert your preferred key mappings here." },
    mouse: {
      enabled: true,
      triggerButton: 2,
      directionMode: "4-way",
      activationDistancePx: 10,
      sampleDistancePx: 4,
      minimumSegmentDistancePx: 18,
      turnHysteresisDegrees: 18,
      maxSegments: 8,
      maxDurationMs: 2500,
      showTrail: true,
      showCommandHud: true,
      suppressContextMenuAfterActivation: true,
      bindings: [
        { id: "mouse-back", enabled: true, pattern: ["L"], commandName: "goBack", options: {} },
        {
          id: "mouse-forward",
          enabled: true,
          pattern: ["R"],
          commandName: "goForward",
          options: {},
        },
        {
          id: "mouse-close-tab",
          enabled: true,
          pattern: ["D", "R"],
          commandName: "removeTab",
          options: {},
        },
        {
          id: "mouse-restore-tab",
          enabled: true,
          pattern: ["L", "U"],
          commandName: "restoreTab",
          options: {},
        },
        {
          id: "mouse-top",
          enabled: true,
          pattern: ["R", "U"],
          commandName: "scrollToTop",
          options: {},
        },
        {
          id: "mouse-bottom",
          enabled: true,
          pattern: ["R", "D"],
          commandName: "scrollToBottom",
          options: {},
        },
        {
          id: "mouse-page-up",
          enabled: true,
          pattern: ["U"],
          commandName: "scrollFullPageUp",
          options: {},
        },
        {
          id: "mouse-reload",
          enabled: true,
          pattern: ["U", "D"],
          commandName: "reload",
          options: {},
        },
        {
          id: "mouse-hard-reload",
          enabled: true,
          pattern: ["U", "D", "U"],
          commandName: "reload",
          options: { hard: true },
        },
        {
          id: "mouse-previous-tab",
          enabled: true,
          pattern: ["U", "L"],
          commandName: "previousTab",
          options: {},
        },
        {
          id: "mouse-next-tab",
          enabled: true,
          pattern: ["U", "R"],
          commandName: "nextTab",
          options: {},
        },
        {
          id: "mouse-new-window",
          enabled: true,
          pattern: ["D", "R", "U"],
          commandName: "BrowserToolbox.newWindow",
          options: {},
        },
        {
          id: "mouse-close-window",
          enabled: true,
          pattern: ["D", "R", "D"],
          commandName: "BrowserToolbox.closeWindow",
          options: {},
        },
      ],
    },
    superDrag: {
      enabled: true,
      nativeBypassModifier: "Alt",
      bindings: [
        {
          id: "drag-link-foreground",
          enabled: true,
          context: "LINK",
          pattern: ["R"],
          commandName: "BrowserToolbox.openLinkForeground",
          options: {},
        },
        {
          id: "drag-link-background",
          enabled: true,
          context: "LINK",
          pattern: ["L"],
          commandName: "BrowserToolbox.openLinkBackground",
          options: {},
        },
        {
          id: "drag-link-copy-text",
          enabled: true,
          context: "LINK",
          pattern: ["L", "D", "R"],
          commandName: "BrowserToolbox.copyLinkText",
          options: {},
        },
        {
          id: "drag-link-copy-url",
          enabled: true,
          context: "LINK",
          pattern: ["R", "D", "L"],
          commandName: "BrowserToolbox.copyLinkUrl",
          options: {},
        },
        {
          id: "drag-text-foreground",
          enabled: true,
          context: "SELECTED_TEXT",
          pattern: ["R"],
          commandName: "BrowserToolbox.searchSelection",
          options: { disposition: "foreground" },
        },
        {
          id: "drag-text-background",
          enabled: true,
          context: "SELECTED_TEXT",
          pattern: ["L"],
          commandName: "BrowserToolbox.searchSelection",
          options: { disposition: "background" },
        },
        {
          id: "drag-text-copy",
          enabled: true,
          context: "SELECTED_TEXT",
          pattern: ["D"],
          commandName: "BrowserToolbox.copySelection",
          options: {},
        },
        {
          id: "drag-image-foreground",
          enabled: true,
          context: "IMAGE",
          pattern: ["R"],
          commandName: "BrowserToolbox.openImageForeground",
          options: {},
        },
        {
          id: "drag-image-background",
          enabled: true,
          context: "IMAGE",
          pattern: ["L"],
          commandName: "BrowserToolbox.openImageBackground",
          options: {},
        },
        {
          id: "drag-image-copy",
          enabled: true,
          context: "IMAGE",
          pattern: ["D"],
          commandName: "BrowserToolbox.copyImageUrl",
          options: {},
        },
        {
          id: "drag-image-download",
          enabled: true,
          context: "IMAGE",
          pattern: ["D", "R"],
          commandName: "BrowserToolbox.downloadImage",
          options: {},
        },
      ],
    },
    wheel: {
      enabled: true,
      threshold: 80,
      cooldownMs: 180,
      continuousTabSwitching: false,
      bindings: [
        {
          id: "wheel-right-up",
          enabled: true,
          button: "RIGHT_BUTTON",
          direction: "UP",
          commandName: "scrollToTop",
          options: {},
        },
        {
          id: "wheel-right-down",
          enabled: true,
          button: "RIGHT_BUTTON",
          direction: "DOWN",
          commandName: "scrollToBottom",
          options: {},
        },
        {
          id: "wheel-left-up",
          enabled: true,
          button: "LEFT_BUTTON",
          direction: "UP",
          commandName: "previousTab",
          options: {},
        },
        {
          id: "wheel-left-down",
          enabled: true,
          button: "LEFT_BUTTON",
          direction: "DOWN",
          commandName: "nextTab",
          options: {},
        },
      ],
    },
    rocker: {
      enabled: true,
      bindings: [
        {
          id: "rocker-right-left",
          enabled: true,
          sequence: "HOLD_RIGHT_THEN_CLICK_LEFT",
          commandName: "goBack",
          options: {},
        },
        {
          id: "rocker-left-right",
          enabled: true,
          sequence: "HOLD_LEFT_THEN_CLICK_RIGHT",
          commandName: "goForward",
          options: {},
        },
      ],
    },
    cursor: { enabled: false, localAssetId: null, hotspotX: 0, hotspotY: 0 },
    siteRules: DEFAULT_SITE_RULES,
    exclusionRules: [],
    searchEngines: "",
    privacy: { telemetry: false, remoteConfig: false, backgroundNetwork: false },
  };

  /**
   * 从默认配置和输入值合并出独立设置对象。
   * @param {...unknown} values 待合并配置。
   * @returns {BrowserToolboxSettings} 合并后的设置。
   */
  function mergeSettings(...values) {
    const result = clone(defaultSettings);
    for (const value of values) mergeInto(result, value);
    return result;
  }

  function mergeInto(target, source) {
    if (!source || typeof source !== "object") return target;
    for (const [key, value] of Object.entries(source)) {
      // 设置导入来自用户 JSON，禁止这些键改变配置对象原型或构造器。
      if (UNSAFE_KEYS.has(key)) continue;
      if (
        value && typeof value === "object" && !Array.isArray(value) && target[key] &&
        typeof target[key] === "object"
      ) {
        mergeInto(target[key], value);
      } else {
        target[key] = clone(value);
      }
    }
    return target;
  }

  globalThis.BrowserToolboxSettingsSchema = Object.freeze({
    CURRENT_SCHEMA_VERSION: 4,
    DEFAULT_SETTINGS: defaultSettings,
    DEFAULT_SITE_RULES,
    clone,
    mergeSettings,
  });
})();

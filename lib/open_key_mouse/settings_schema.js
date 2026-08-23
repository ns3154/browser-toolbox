// OpenKeyMouse 配置的默认值。Vimium 原有设置仍由 lib/settings.js 管理，这里只管理新增模块。
(function () {
  const defaultSettings = {
    settingsVersion: "0.1.0",
    schemaVersion: 3,
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
          commandName: "OpenKeyMouse.newWindow",
          options: {},
        },
        {
          id: "mouse-close-window",
          enabled: true,
          pattern: ["D", "R", "D"],
          commandName: "OpenKeyMouse.closeWindow",
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
          commandName: "OpenKeyMouse.openLinkForeground",
          options: {},
        },
        {
          id: "drag-link-background",
          enabled: true,
          context: "LINK",
          pattern: ["L"],
          commandName: "OpenKeyMouse.openLinkBackground",
          options: {},
        },
        {
          id: "drag-link-copy-text",
          enabled: true,
          context: "LINK",
          pattern: ["L", "D", "R"],
          commandName: "OpenKeyMouse.copyLinkText",
          options: {},
        },
        {
          id: "drag-link-copy-url",
          enabled: true,
          context: "LINK",
          pattern: ["R", "D", "L"],
          commandName: "OpenKeyMouse.copyLinkUrl",
          options: {},
        },
        {
          id: "drag-text-foreground",
          enabled: true,
          context: "SELECTED_TEXT",
          pattern: ["R"],
          commandName: "OpenKeyMouse.searchSelection",
          options: { disposition: "foreground" },
        },
        {
          id: "drag-text-background",
          enabled: true,
          context: "SELECTED_TEXT",
          pattern: ["L"],
          commandName: "OpenKeyMouse.searchSelection",
          options: { disposition: "background" },
        },
        {
          id: "drag-text-copy",
          enabled: true,
          context: "SELECTED_TEXT",
          pattern: ["D"],
          commandName: "OpenKeyMouse.copySelection",
          options: {},
        },
        {
          id: "drag-image-foreground",
          enabled: true,
          context: "IMAGE",
          pattern: ["R"],
          commandName: "OpenKeyMouse.openImageForeground",
          options: {},
        },
        {
          id: "drag-image-background",
          enabled: true,
          context: "IMAGE",
          pattern: ["L"],
          commandName: "OpenKeyMouse.openImageBackground",
          options: {},
        },
        {
          id: "drag-image-copy",
          enabled: true,
          context: "IMAGE",
          pattern: ["D"],
          commandName: "OpenKeyMouse.copyImageUrl",
          options: {},
        },
        {
          id: "drag-image-download",
          enabled: true,
          context: "IMAGE",
          pattern: ["D", "R"],
          commandName: "OpenKeyMouse.downloadImage",
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
    siteRules: [],
    exclusionRules: [],
    searchEngines: "",
    privacy: { telemetry: false, remoteConfig: false, backgroundNetwork: false },
  };

  function clone(value) {
    return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  function mergeSettings(...values) {
    const result = clone(defaultSettings);
    for (const value of values) mergeInto(result, value);
    return result;
  }

  function mergeInto(target, source) {
    if (!source || typeof source !== "object") return target;
    for (const [key, value] of Object.entries(source)) {
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

  globalThis.OpenKeyMouseSettingsSchema = Object.freeze({
    CURRENT_SCHEMA_VERSION: 3,
    DEFAULT_SETTINGS: defaultSettings,
    clone,
    mergeSettings,
  });
})();

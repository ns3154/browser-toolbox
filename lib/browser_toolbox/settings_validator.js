// 配置边界校验。校验函数只返回结果，不直接写入 storage。
/**
 * 设置校验结果。
 * @typedef {Object} BrowserToolboxSettingsValidation
 * @property {boolean} ok 是否通过。
 * @property {Array<string>} errors 错误信息。
 * @property {Object} value 合并后的设置值。
 */
(function () {
  const schema = globalThis.BrowserToolboxSettingsSchema;
  const moduleRegistry = globalThis.BrowserToolboxModuleRegistry;
  const toolRegistry = globalThis.BrowserToolboxToolRegistry;
  const FALLBACK_TOOL_SOURCES = new Map([
    ["json.format", ["action", "selection", "page", "command"]],
    ["text.diff", ["action", "selection", "command"]],
    ["codec.transform", ["action", "selection", "command"]],
    ["time.convert", ["action", "selection", "command"]],
    ["id.generate", ["action", "command"]],
    ["password.generate", ["action", "command"]],
    ["table.convert", ["action", "selection", "command"]],
  ]);
  const FALLBACK_TOOL_SURFACES = new Map([
    ["json.format", ["catalog", "popup", "contextMenu", "settings"]],
    ["text.diff", ["catalog", "popup", "contextMenu", "settings"]],
    ["codec.transform", ["catalog", "popup", "contextMenu", "settings"]],
    ["time.convert", ["catalog", "popup", "contextMenu", "settings"]],
    ["id.generate", ["catalog", "popup", "settings"]],
    ["password.generate", ["catalog", "popup", "settings"]],
    ["table.convert", ["catalog", "contextMenu", "settings"]],
  ]);
  const CURSOR_ASSET_PATTERN = /^browserToolboxCursor-[a-z0-9-]{8,80}$/;
  // 旧指针资源键只读兼容，避免升级后已有本地 PNG 失效；新上传始终使用新前缀。
  const LEGACY_CURSOR_ASSET_PATTERN = /^openKeyMouseCursor-[a-z0-9-]{8,80}$/;
  const SITE_RULE_MATCH_TYPES = Object.freeze(["glob", "regex"]);
  const NATIVE_BYPASS_MODIFIERS = Object.freeze(["Alt", "Control", "Meta", "Shift"]);
  const INPUT_SOURCES = Object.freeze({
    mouse: "mouseGesture",
    superDrag: "superDrag",
    wheel: "wheel",
    rocker: "rocker",
  });
  const SITE_RULE_MODULES = new Set(moduleRegistry.SITE_RULE_MODULE_IDS);
  const DOCUMENT_FORMATS = Object.freeze(["json", "xml", "css", "javascript", "java"]);
  const SITE_PROFILE_PRESETS = new Set(["balanced", "editor", "reading", "custom"]);
  const SITE_PROFILE_SECTION_KEYS = Object.freeze({
    mouse: new Set([
      "enabled",
      "triggerButton",
      "activationDistancePx",
      "sampleDistancePx",
      "minimumSegmentDistancePx",
      "turnHysteresisDegrees",
      "maxSegments",
      "maxDurationMs",
      "showTrail",
      "showCommandHud",
      "suppressContextMenuAfterActivation",
    ]),
    superDrag: new Set(["enabled", "nativeBypassModifier"]),
    wheel: new Set(["enabled", "threshold", "cooldownMs", "continuousTabSwitching"]),
    rocker: new Set(["enabled"]),
  });

  const ranges = {
    activationDistancePx: [1, 200],
    sampleDistancePx: [1, 100],
    minimumSegmentDistancePx: [2, 500],
    turnHysteresisDegrees: [0, 45],
    maxSegments: [1, 8],
    maxDurationMs: [100, 10000],
    threshold: [10, 2000],
    cooldownMs: [0, 5000],
  };

  function pattern(value) {
    return Array.isArray(value) && value.length > 0 && value.length <= 8 &&
      value.every((direction) => ["U", "D", "L", "R"].includes(direction));
  }

  function validateNumber(value, name, errors) {
    const [min, max] = ranges[name];
    if (!Number.isFinite(value) || value < min || value > max) {
      errors.push(`${name} must be between ${min} and ${max}.`);
    }
  }

  function isPlainData(value, depth = 0) {
    if (depth > 5) return false;
    if (value == null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every((item) => isPlainData(item, depth + 1));
    if (typeof value !== "object" || value.constructor !== Object) return false;
    return Object.values(value).every((item) => isPlainData(item, depth + 1));
  }

  function section(value, name, errors) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${name} must be an object.`);
      return {};
    }
    return value;
  }

  function booleanField(value, name, errors) {
    if (typeof value !== "boolean") errors.push(`${name} must be a boolean.`);
  }

  function stringField(value, name, errors, maxLength = 4096) {
    if (typeof value !== "string" || value.length > maxLength) {
      errors.push(`${name} must be a bounded string.`);
    }
  }

  function bindingPatternKey(value) {
    return Array.isArray(value) ? value.join(">") : "";
  }

  function validateToolIds(ids, name, max, source, surface, errors) {
    if (!Array.isArray(ids) || ids.length > max) {
      errors.push(`${name} must contain at most ${max} tool IDs.`);
      return;
    }
    const seen = new Set();
    for (const id of ids) {
      const descriptor = toolRegistry?.get?.(id);
      const allowedSources = descriptor?.allowedSources || FALLBACK_TOOL_SOURCES.get(id) || [];
      const allowedSurfaces = descriptor?.surfaces
        ? Object.entries(descriptor.surfaces).filter(([, enabled]) => enabled).map(([key]) => key)
        : FALLBACK_TOOL_SURFACES.get(id) || [];
      if (
        typeof id !== "string" || !allowedSources.includes(source) ||
        (surface && !allowedSurfaces.includes(surface)) || seen.has(id)
      ) errors.push(`${name} contains an invalid or duplicate tool ID: ${id}.`);
      seen.add(id);
    }
  }

  function validateTools(tools, errors) {
    if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
      section(tools, "tools", errors);
      return;
    }
    booleanField(tools.enabled, "tools.enabled", errors);
    validateToolIds(tools.pinnedIds, "tools.pinnedIds", 6, "action", "popup", errors);
    const contextMenu = section(tools.contextMenu, "tools.contextMenu", errors);
    booleanField(contextMenu.enabled, "tools.contextMenu.enabled", errors);
    validateToolIds(
      contextMenu.toolIds,
      "tools.contextMenu.toolIds",
      3,
      "selection",
      "contextMenu",
      errors,
    );
    const documentFormatter = section(tools.documentFormatter, "tools.documentFormatter", errors);
    booleanField(documentFormatter.enabled, "tools.documentFormatter.enabled", errors);
    const autoFormat = section(
      documentFormatter.autoFormat,
      "tools.documentFormatter.autoFormat",
      errors,
    );
    for (const format of DOCUMENT_FORMATS) {
      booleanField(autoFormat[format], `tools.documentFormatter.autoFormat.${format}`, errors);
    }
    if (
      !Number.isInteger(documentFormatter.maxAutoBytes) ||
      documentFormatter.maxAutoBytes < 0 ||
      documentFormatter.maxAutoBytes > 10 * 1024 * 1024
    ) errors.push("tools.documentFormatter.maxAutoBytes is invalid.");
    const json = section(documentFormatter.json, "tools.documentFormatter.json", errors);
    if (![
      "original",
      "ascending",
      "descending",
    ].includes(json.defaultSort)) errors.push("tools.documentFormatter.json.defaultSort is invalid.");
    if (
      json.defaultCollapseDepth !== null &&
      (!Number.isInteger(json.defaultCollapseDepth) ||
        json.defaultCollapseDepth < 0 || json.defaultCollapseDepth > 96)
    ) errors.push("tools.documentFormatter.json.defaultCollapseDepth is invalid.");
  }

  function validateBindings(bindings, registry, errors, kind) {
    if (!Array.isArray(bindings)) {
      errors.push(`${kind}.bindings must be an array.`);
      return;
    }
    const seen = new Set();
    for (const binding of bindings) {
      if (!binding || typeof binding !== "object") {
        errors.push(`${kind} contains an invalid binding.`);
        continue;
      }
      if (binding.id != null) stringField(binding.id, `${kind}.binding.id`, errors, 128);
      stringField(binding.commandName, `${kind}.binding.commandName`, errors, 128);
      if (binding.enabled != null) booleanField(binding.enabled, `${kind}.binding.enabled`, errors);
      if (
        !Object.hasOwn(binding, "options") || binding.options == null ||
        !isPlainData(binding.options) || Array.isArray(binding.options)
      ) {
        errors.push(`${kind}.binding.options must be a plain object.`);
      }
      const key = `${binding.context || ""}:${binding.button || ""}:${binding.direction || ""}:${
        binding.sequence || ""
      }:${bindingPatternKey(binding.pattern)}`;
      if (binding.enabled !== false && seen.has(key)) {
        errors.push(`Duplicate ${kind} binding: ${key}`);
      }
      if (binding.enabled !== false) seen.add(key);
      if (kind !== "wheel" && kind !== "rocker" && !pattern(binding.pattern)) {
        errors.push(`${kind} binding has an invalid pattern.`);
      }
      if (
        kind === "wheel" &&
        (!["LEFT_BUTTON", "RIGHT_BUTTON", "MIDDLE_BUTTON"].includes(binding.button) ||
          !["UP", "DOWN"].includes(binding.direction))
      ) {
        errors.push("wheel binding has an invalid button or direction.");
      }
      if (
        kind === "rocker" &&
        !["HOLD_RIGHT_THEN_CLICK_LEFT", "HOLD_LEFT_THEN_CLICK_RIGHT"].includes(binding.sequence)
      ) {
        errors.push("rocker binding has an invalid sequence.");
      }
      if (kind === "superDrag" && !["LINK", "SELECTED_TEXT", "IMAGE"].includes(binding.context)) {
        errors.push("superDrag binding has an invalid context.");
      }
      if (registry?.validateBinding) {
        const commandResult = registry.validateBinding({
          ...binding,
          source: INPUT_SOURCES[kind],
        });
        if (!commandResult.ok) errors.push(commandResult.error);
      } else if (registry && !registry.getCommand?.(binding.commandName)) {
        errors.push(`Unknown command: ${binding.commandName}`);
      }
    }
  }

  function validateProfileNumber(value, name, path, errors) {
    const [min, max] = ranges[name];
    if (!Number.isFinite(value) || value < min || value > max) {
      errors.push(`${path} must be between ${min} and ${max}.`);
    }
    if (name === "maxSegments" && !Number.isInteger(value)) {
      errors.push(`${path} must be an integer.`);
    }
  }

  function validateProfileSection(value, sectionName, errors) {
    if (value == null) return;
    if (typeof value !== "object" || Array.isArray(value)) {
      errors.push(`siteRules.profile.${sectionName} must be an object.`);
      return;
    }
    const path = `siteRules.profile.${sectionName}`;
    if (Object.hasOwn(value, "enabled")) booleanField(value.enabled, `${path}.enabled`, errors);
    if (sectionName === "mouse") {
      if (Object.hasOwn(value, "triggerButton") &&
        (!Number.isInteger(value.triggerButton) || ![0, 1, 2].includes(value.triggerButton))) {
        errors.push(`${path}.triggerButton is invalid.`);
      }
      for (const name of [
        "activationDistancePx",
        "sampleDistancePx",
        "minimumSegmentDistancePx",
        "turnHysteresisDegrees",
        "maxSegments",
        "maxDurationMs",
      ]) {
        if (Object.hasOwn(value, name)) validateProfileNumber(value[name], name, `${path}.${name}`, errors);
      }
      for (const name of ["showTrail", "showCommandHud", "suppressContextMenuAfterActivation"]) {
        if (Object.hasOwn(value, name)) booleanField(value[name], `${path}.${name}`, errors);
      }
    }
    if (sectionName === "superDrag") {
      if (Object.hasOwn(value, "nativeBypassModifier") &&
        !NATIVE_BYPASS_MODIFIERS.includes(value.nativeBypassModifier)) {
        errors.push(`${path}.nativeBypassModifier is invalid.`);
      }
    }
    if (sectionName === "wheel") {
      for (const name of ["threshold", "cooldownMs"]) {
        if (Object.hasOwn(value, name)) validateProfileNumber(value[name], name, `${path}.${name}`, errors);
      }
      if (Object.hasOwn(value, "continuousTabSwitching")) {
        booleanField(value.continuousTabSwitching, `${path}.continuousTabSwitching`, errors);
      }
    }
  }

  function validateProfile(profile, errors) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      errors.push("A site rule profile must be an object.");
      return;
    }
    if (profile.name != null) stringField(profile.name, "siteRules.profile.name", errors, 80);
    if (profile.preset != null && !SITE_PROFILE_PRESETS.has(profile.preset)) {
      errors.push("siteRules.profile.preset is invalid.");
    }
    for (const sectionName of Object.keys(SITE_PROFILE_SECTION_KEYS)) {
      if (Object.hasOwn(profile, sectionName)) {
        validateProfileSection(profile[sectionName], sectionName, errors);
      }
    }
  }

  /**
   * 校验设置并返回不会被写入的独立结果。
   * @param {unknown} settings 待校验设置。
   * @param {Object} [registry] 命令注册表。
   * @returns {BrowserToolboxSettingsValidation} 校验结果。
   */
  function validate(settings, registry) {
    const errors = [];
    const value = schema.mergeSettings(settings);
    const general = section(value.general, "general", errors);
    const keyboard = section(value.keyboard, "keyboard", errors);
    const mouse = section(value.mouse, "mouse", errors);
    const superDrag = section(value.superDrag, "superDrag", errors);
    const wheel = section(value.wheel, "wheel", errors);
    const rocker = section(value.rocker, "rocker", errors);
    const cursor = section(value.cursor, "cursor", errors);
    const tools = section(value.tools, "tools", errors);
    if (value.schemaVersion !== schema.CURRENT_SCHEMA_VERSION) {
      errors.push(`Unsupported schema version: ${value.schemaVersion}.`);
    }
    validateTools(tools, errors);
    booleanField(general.enabled, "general.enabled", errors);
    booleanField(general.showHud, "general.showHud", errors);
    booleanField(general.browserSyncEnabled, "general.browserSyncEnabled", errors);
    if (!["auto", "en", "zh_CN"].includes(general.language)) {
      errors.push("general.language is invalid.");
    }
    booleanField(keyboard.enabled, "keyboard.enabled", errors);
    stringField(keyboard.keyMappings, "keyboard.keyMappings", errors, 256 * 1024);
    booleanField(mouse.enabled, "mouse.enabled", errors);
    if (!Number.isInteger(mouse.triggerButton) || ![0, 1, 2].includes(mouse.triggerButton)) {
      errors.push("mouse.triggerButton is invalid.");
    }
    if (mouse.directionMode !== "4-way") {
      errors.push("mouse.directionMode is invalid.");
    }
    for (
      const name of [
        "showTrail",
        "showCommandHud",
        "suppressContextMenuAfterActivation",
      ]
    ) booleanField(mouse[name], `mouse.${name}`, errors);
    booleanField(superDrag.enabled, "superDrag.enabled", errors);
    if (!NATIVE_BYPASS_MODIFIERS.includes(superDrag.nativeBypassModifier)) {
      errors.push("superDrag.nativeBypassModifier is invalid.");
    }
    booleanField(wheel.enabled, "wheel.enabled", errors);
    booleanField(wheel.continuousTabSwitching, "wheel.continuousTabSwitching", errors);
    booleanField(rocker.enabled, "rocker.enabled", errors);
    booleanField(cursor.enabled, "cursor.enabled", errors);
    for (const name of Object.keys(ranges)) {
      const target = name === "threshold" || name === "cooldownMs" ? wheel : mouse;
      validateNumber(target[name], name, errors);
    }
    validateBindings(mouse.bindings, registry, errors, "mouse");
    validateBindings(superDrag.bindings, registry, errors, "superDrag");
    validateBindings(wheel.bindings, registry, errors, "wheel");
    validateBindings(rocker.bindings, registry, errors, "rocker");
    if (
      cursor.localAssetId !== null &&
      (typeof cursor.localAssetId !== "string" ||
        !CURSOR_ASSET_PATTERN.test(cursor.localAssetId) &&
          !LEGACY_CURSOR_ASSET_PATTERN.test(cursor.localAssetId))
    ) {
      errors.push("cursor.localAssetId must reference a local BrowserToolbox PNG asset.");
    }
    for (const name of ["hotspotX", "hotspotY"]) {
      const coordinate = cursor[name];
      if (!Number.isInteger(coordinate) || coordinate < 0 || coordinate > 127) {
        errors.push(`cursor.${name} must be an integer between 0 and 127.`);
      }
    }
    if (!Array.isArray(value.siteRules)) {
      errors.push("siteRules must be an array.");
    } else {
      for (const rule of value.siteRules) {
        if (!rule?.pattern || typeof rule.pattern !== "string" || rule.pattern.length > 2048) {
          errors.push("A site rule has an invalid pattern.");
        }
        if (rule?.id != null) stringField(rule.id, "siteRules.id", errors, 128);
        if (rule?.notes != null) stringField(rule.notes, "siteRules.notes", errors, 4096);
        if (rule?.passKeys != null) stringField(rule.passKeys, "siteRules.passKeys", errors, 4096);
        if (Object.hasOwn(rule || {}, "profile")) validateProfile(rule.profile, errors);
        const matchType = rule?.matchType || "glob";
        if (!SITE_RULE_MATCH_TYPES.includes(matchType)) {
          errors.push("A site rule has an invalid match type.");
        } else if (matchType === "regex" && typeof rule?.pattern === "string") {
          const safety = globalThis.BrowserToolboxRegexSafety;
          const analysis = safety ? safety.analyze(rule.pattern) : (() => {
            try {
              new RegExp(rule.pattern, "i");
              return { ok: true, code: null };
            } catch (_) {
              return { ok: false, code: "invalid" };
            }
          })();
          if (!analysis.ok) {
            errors.push(
              analysis.code === "complexity"
                ? "A site rule regular expression is too complex."
                : "A site rule has an invalid regular expression.",
            );
          }
        }
        if (rule?.enabled != null && typeof rule.enabled !== "boolean") {
          errors.push("A site rule has an invalid enabled flag.");
        }
        if (
          rule?.modules && (typeof rule.modules !== "object" || Array.isArray(rule.modules) ||
            Object.values(rule.modules).some((enabled) => typeof enabled !== "boolean"))
        ) {
          errors.push("A site rule has invalid module flags.");
        }
        if (rule?.modules && typeof rule.modules === "object" && !Array.isArray(rule.modules)) {
          for (const name of Object.keys(rule.modules)) {
            if (!SITE_RULE_MODULES.has(name)) errors.push(`Unknown site rule module: ${name}.`);
          }
        }
      }
    }
    if (typeof value.searchEngines !== "string" || value.searchEngines.length > 256 * 1024) {
      errors.push("searchEngines must be a bounded string.");
    }
    if (
      !Array.isArray(value.exclusionRules) || value.exclusionRules.length > 1000 ||
      value.exclusionRules.some((rule) =>
        !rule || typeof rule.pattern !== "string" || rule.pattern.length > 2048 ||
        typeof rule.passKeys !== "string"
      )
    ) {
      errors.push("exclusionRules must contain bounded pattern and passKeys strings.");
    }
    const privacy = section(value.privacy, "privacy", errors);
    if (
      privacy.telemetry !== false || privacy.remoteConfig !== false ||
      privacy.backgroundNetwork !== false
    ) {
      errors.push("Privacy guarantees are immutable and must remain disabled.");
    }
    return { ok: errors.length === 0, errors, value };
  }

  /**
   * 校验设置，失败时抛出可读错误。
   * @param {unknown} settings 待校验设置。
   * @param {Object} [registry] 命令注册表。
   * @returns {Object} 有效设置。
   */
  function assertValid(settings, registry) {
    const result = validate(settings, registry);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    return result.value;
  }

  globalThis.BrowserToolboxSettingsValidator = Object.freeze({
    ranges,
    SITE_RULE_MATCH_TYPES,
    SITE_PROFILE_PRESETS,
    SITE_PROFILE_SECTION_KEYS,
    NATIVE_BYPASS_MODIFIERS,
    SITE_RULE_MODULES,
    INPUT_SOURCES,
    CURSOR_ASSET_PATTERN,
    LEGACY_CURSOR_ASSET_PATTERN,
    pattern,
    validate,
    assertValid,
  });
})();

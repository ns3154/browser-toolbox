// 配置边界校验。校验函数只返回结果，不直接写入 storage。
(function () {
  const schema = globalThis.OpenKeyMouseSettingsSchema;

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
      value.every((direction) => ["U", "D", "L", "R", "UL", "UR", "DL", "DR"].includes(direction));
  }

  function validateNumber(value, name, errors) {
    const [min, max] = ranges[name];
    if (!Number.isFinite(value) || value < min || value > max) {
      errors.push(`${name} must be between ${min} and ${max}.`);
    }
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
      const key = `${binding.context || ""}:${binding.button || ""}:${binding.direction || ""}:${
        binding.sequence || ""
      }:${(binding.pattern || []).join(">")}`;
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
      if (registry && !registry.getCommand?.(binding.commandName)) {
        errors.push(`Unknown command: ${binding.commandName}`);
      }
    }
  }

  function validate(settings, registry) {
    const errors = [];
    const value = schema.mergeSettings(settings);
    if (value.schemaVersion !== schema.CURRENT_SCHEMA_VERSION) {
      errors.push(`Unsupported schema version: ${value.schemaVersion}.`);
    }
    if (!["auto", "en", "zh_CN"].includes(value.general.language)) {
      errors.push("general.language is invalid.");
    }
    if (!["4-way", "8-way"].includes(value.mouse.directionMode)) {
      errors.push("mouse.directionMode is invalid.");
    }
    for (const name of Object.keys(ranges)) {
      const section = name === "threshold" || name === "cooldownMs" ? value.wheel : value.mouse;
      validateNumber(section[name], name, errors);
    }
    validateBindings(value.mouse.bindings, registry, errors, "mouse");
    validateBindings(value.superDrag.bindings, registry, errors, "superDrag");
    validateBindings(value.wheel.bindings, registry, errors, "wheel");
    validateBindings(value.rocker.bindings, registry, errors, "rocker");
    if (
      value.cursor.localAssetId !== null &&
      (typeof value.cursor.localAssetId !== "string" ||
        !/^openKeyMouseCursor-[a-z0-9-]{8,80}$/.test(value.cursor.localAssetId))
    ) {
      errors.push("cursor.localAssetId must reference a local OpenKeyMouse PNG asset.");
    }
    for (const name of ["hotspotX", "hotspotY"]) {
      const coordinate = value.cursor[name];
      if (!Number.isInteger(coordinate) || coordinate < 0 || coordinate > 127) {
        errors.push(`cursor.${name} must be an integer between 0 and 127.`);
      }
    }
    if (!Array.isArray(value.siteRules)) errors.push("siteRules must be an array.");
    for (const rule of value.siteRules) {
      if (!rule?.pattern || typeof rule.pattern !== "string" || rule.pattern.length > 2048) {
        errors.push("A site rule has an invalid pattern.");
      }
      if (
        rule?.modules && (typeof rule.modules !== "object" ||
          Object.values(rule.modules).some((enabled) => typeof enabled !== "boolean"))
      ) {
        errors.push("A site rule has invalid module flags.");
      }
    }
    if (
      typeof value.keyboard.keyMappings !== "string" ||
      value.keyboard.keyMappings.length > 256 * 1024
    ) {
      errors.push("keyboard.keyMappings must be a bounded string.");
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
    if (
      value.privacy.telemetry !== false || value.privacy.remoteConfig !== false ||
      value.privacy.backgroundNetwork !== false
    ) {
      errors.push("Privacy guarantees are immutable and must remain disabled.");
    }
    return { ok: errors.length === 0, errors, value };
  }

  function assertValid(settings, registry) {
    const result = validate(settings, registry);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    return result.value;
  }

  globalThis.OpenKeyMouseSettingsValidator = Object.freeze({
    ranges,
    pattern,
    validate,
    assertValid,
  });
})();

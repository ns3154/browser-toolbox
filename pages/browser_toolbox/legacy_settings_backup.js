// SPDX-License-Identifier: GPL-3.0-or-later

export function serializeLegacyBackup(form) {
  const settings = Settings.pruneOutDefaultValues(form);
  // 只排序顶层键，保留排除规则内的 pattern 和 passKeys。
  const entries = Object.keys(settings).sort().map((key) => [key, settings[key]]);
  return JSON.stringify(Object.fromEntries(entries), null, 2) + "\n";
}

const MAX_REPORTED_FIELDS = 20;
const safeField = (key) => /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(key) ? key : "…";
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function fieldReport(paths) {
  return {
    fields: paths.slice(0, MAX_REPORTED_FIELDS),
    truncated: paths.length > MAX_REPORTED_FIELDS,
  };
}

export function inspectLegacyBackup(text) {
  const input = JSON.parse(text);
  if (
    !input || typeof input !== "object" || Array.isArray(input) ||
    Object.hasOwn(input, "format") || (input.settingsVersion != null &&
      (typeof input.settingsVersion !== "string" || !/^\d+(\.\d+)+$/.test(input.settingsVersion)))
  ) {
    throw new Error("INVALID_KEYBOARD_CONFIGURATION");
  }
  const unknown = Object.keys(input).filter((key) =>
    !Object.hasOwn(Settings.defaultOptions, key) && key !== "settingsVersion" &&
    key !== "newTabUrl"
  );
  // 迁移前排除未知字段，避免旧版本的字符串解码尝试解析无关数据。
  const known = Object.fromEntries(
    Object.entries(input).filter(([key]) =>
      Object.hasOwn(Settings.defaultOptions, key) || key === "settingsVersion" ||
      key === "newTabUrl"
    ),
  );
  const originalKnown = structuredClone(known);
  const migrated = Settings.migrateSettingsIfNecessary(known);
  if (Object.hasOwn(migrated, "newTabUrl")) unknown.push("newTabUrl");
  const unsupportedRules = [];
  if (Array.isArray(migrated.exclusionRules)) {
    for (const [index, rule] of migrated.exclusionRules.entries()) {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) continue;
      for (const key of Object.keys(rule).sort()) {
        if (key !== "pattern" && key !== "passKeys") {
          unsupportedRules.push(`exclusionRules[${index}].${safeField(key)}`);
        }
      }
    }
  }
  if (unsupportedRules.length) {
    const report = fieldReport(unsupportedRules);
    throw Object.assign(new Error("UNSUPPORTED_LEGACY_BACKUP_RULE_FIELDS"), {
      code: "UNSUPPORTED_LEGACY_BACKUP_RULE_FIELDS",
      conflicts: report.fields,
      truncated: report.truncated,
    });
  }
  const patch = Object.fromEntries(
    Object.entries(migrated).filter(([key]) => Object.hasOwn(Settings.defaultOptions, key)),
  );
  const errors = [];
  for (const [key, value] of Object.entries(patch)) {
    const defaultValue = Settings.defaultOptions[key];
    if (
      (Array.isArray(defaultValue)
        ? !Array.isArray(value)
        : typeof value !== typeof defaultValue) ||
      typeof value === "number" && !Number.isFinite(value) ||
      new TextEncoder().encode(JSON.stringify(value)).length > 256 * 1024 ||
      key === "newTabDestination" && !Object.values(Settings.newTabDestinations).includes(value)
    ) errors.push(key);
  }
  if (Array.isArray(patch.exclusionRules)) {
    for (const [index, rule] of patch.exclusionRules.entries()) {
      if (
        !rule || typeof rule !== "object" || Array.isArray(rule) ||
        typeof rule.pattern !== "string" || typeof rule.passKeys !== "string"
      ) errors.push(`exclusionRules[${index}]`);
    }
  }
  if (errors.length) {
    const report = fieldReport([...new Set(errors)].sort());
    throw Object.assign(new Error("INVALID_LEGACY_BACKUP_FIELDS"), {
      code: "INVALID_LEGACY_BACKUP_FIELDS",
      conflicts: report.fields,
      truncated: report.truncated,
    });
  }
  const recognizedFields = [], convertedFields = [];
  for (const key of Object.keys(patch).sort()) {
    if (Object.hasOwn(originalKnown, key) && equal(originalKnown[key], patch[key])) {
      recognizedFields.push(key);
    } else convertedFields.push(key);
  }
  const report = fieldReport(unknown.sort().map(safeField));
  return {
    patch,
    recognizedFields,
    convertedFields,
    ignoredFields: report.fields,
    errorFields: [],
    truncated: report.truncated,
  };
}

export function formatLegacyBackupFields(report, message) {
  const isRuleError = report?.code === "UNSUPPORTED_LEGACY_BACKUP_RULE_FIELDS";
  const fields = report.conflicts;
  const label = message(isRuleError ? "legacyBackupUnsupportedRules" : "legacyBackupInvalidFields");
  return `${label}\n${fields.join(", ")}${report.truncated ? ", …" : ""}`;
}

export function formatLegacyBackupPreview(report, message) {
  const list = (items) => items.length ? items.join(", ") : message("none");
  const intro = message(
    report.ignoredFields.length ? "legacyBackupUnknownFields" : "legacyBackupPreview",
  );
  return [
    intro,
    `${message("legacyBackupRecognizedFields")}: ${list(report.recognizedFields)}`,
    `${message("legacyBackupConvertedFields")}: ${list(report.convertedFields)}`,
    `${message("ignoredFields")}: ${list(report.ignoredFields)}${report.truncated ? ", …" : ""}`,
    `${message("legacyBackupErrorFields")}: ${list(report.errorFields)}`,
  ].join("\n");
}

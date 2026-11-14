// SPDX-License-Identifier: GPL-3.0-or-later
// 脱敏状态只由本机固定字段构造；不得复制恢复记录的配置值或任意错误信息。
(function () {
  const store = globalThis.BrowserToolboxConfigurationStore;
  const phases = Object.freeze({
    configuration: new Set(["PREPARED", "APPLYING", "RECOVERING", "COMMITTED", "ABORTED"]),
    legacyRollback: new Set(["PREPARED", "APPLYING", "RECOVERING", "COMMITTED", "ABORTED"]),
    syncPublish: new Set([
      "PREPARED",
      "STAGING",
      "PUBLISHING",
      "RECOVERING",
      "COMMITTED",
      "ABORTED",
    ]),
  });
  const expectedKinds = Object.freeze({
    legacyRollback: "legacy-rollback",
    syncPublish: "keyboard-sync-publish",
  });
  const names = Object.freeze({
    configuration: store.KEYS.state,
    legacyRollback: store.ROLLBACK_JOURNAL_KEY,
    syncPublish: store.SYNC_PUBLISH_JOURNAL_KEY,
  });

  function summarize(values, name) {
    const key = names[name];
    if (!Object.hasOwn(values, key)) return { status: "absent" };
    const value = values[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "invalid" };
    if (!Number.isSafeInteger(value.formatVersion)) return { status: "invalid" };
    if (value.formatVersion !== store.FORMAT_VERSION) return { status: "unsupported" };
    if (
      expectedKinds[name] && value.kind !== expectedKinds[name] ||
      !phases[name].has(value.phase) ||
      Object.hasOwn(value, "conflicts") && !Array.isArray(value.conflicts)
    ) return { status: "invalid" };
    return {
      status: "present",
      phase: value.phase,
      hasConflicts: Array.isArray(value.conflicts) && value.conflicts.length > 0 ||
        name === "configuration" &&
          ["CONFIGURATION_EXTERNAL_CONFLICT", "CONFIGURATION_RECOVERY_CONFLICT"].includes(
            value.code,
          ),
    };
  }

  async function inspect(local, extensionVersion) {
    const safeVersion = typeof extensionVersion === "string" && extensionVersion.length <= 32 &&
        /^\d+(?:\.\d+){0,3}$/.test(extensionVersion)
      ? extensionVersion
      : null;
    try {
      const keys = typeof local.getKeys === "function"
        ? await local.getKeys()
        : Object.keys(await local.get(null));
      if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) throw new Error();
      const compatibilityConflictCount = keys.filter((key) =>
        key.startsWith(store.M2_CONFLICT_CAPTURE_PREFIX)
      ).length;
      const values = await local.get(Object.values(names));
      if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error();
      const records = Object.fromEntries(
        Object.keys(names).map((name) => [name, summarize(values, name)]),
      );
      const configuration = records.configuration;
      const configurationBlocksWrites = configuration.status !== "absent" &&
        (configuration.status !== "present" ||
          !["COMMITTED", "ABORTED"].includes(configuration.phase) ||
          Boolean(values[names.configuration]?.code));
      return {
        formatVersion: 1,
        extensionVersion: safeVersion,
        status: "available",
        records,
        compatibilityConflictCount,
        transitionBlocksWrites: configurationBlocksWrites || compatibilityConflictCount > 0 ||
          Object.hasOwn(values, names.legacyRollback) || Object.hasOwn(values, names.syncPublish),
      };
    } catch (_) {
      return {
        formatVersion: 1,
        extensionVersion: safeVersion,
        status: "unavailable",
        records: null,
        compatibilityConflictCount: null,
        transitionBlocksWrites: null,
      };
    }
  }

  globalThis.BrowserToolboxRecoveryDiagnostics = Object.freeze({ inspect });
})();

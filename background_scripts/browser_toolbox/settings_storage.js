// BrowserToolbox 存储适配层：集中处理规范键、旧键和迁移备份，不承载配置业务规则。
/**
 * 设置读取结果。
 * @typedef {Object} BrowserToolboxStoredSettings
 * @property {Object} value 原始设置值。
 * @property {boolean} legacy 是否从旧键读取。
 * @property {boolean} canonicalPresent 规范键是否存在。
 */
(function () {
  const valueUtils = globalThis.BrowserToolboxValueUtils;
  const SETTINGS_KEY = "browserToolboxSettings";
  // 旧键只用于读取、备份和兼容迁移，任何新写入都使用 BrowserToolbox 键。
  const LEGACY_SETTINGS_KEY = "openKeyMouseSettings";
  const BACKUP_KEY = "browserToolboxSettingsMigrationBackup";
  const SESSION_KEY = "browserToolboxSessionOverrides";
  const LEGACY_SESSION_KEY = "openKeyMouseSessionOverrides";
  const MAX_SYNC_BYTES = 100 * 1024;
  const MAX_SYNC_ITEM_BYTES = 8 * 1024;

  const STORAGE_KEYS = Object.freeze({
    settings: SETTINGS_KEY,
    legacySettings: LEGACY_SETTINGS_KEY,
    migrationBackup: BACKUP_KEY,
    sessionOverrides: SESSION_KEY,
    legacySessionOverrides: LEGACY_SESSION_KEY,
  });

  /**
   * 按规范键优先、旧键回退选择存储值。
   * @param {Object} values storage.get 返回值。
   * @param {string} canonicalKey 规范键。
   * @param {string} legacyKey 旧键。
   * @returns {{value: Object, legacy: boolean}} 选择结果。
   */
  function preferredValue(values, canonicalKey, legacyKey) {
    if (Object.hasOwn(values, canonicalKey) && values[canonicalKey] != null) {
      return { value: values[canonicalKey], legacy: false };
    }
    if (Object.hasOwn(values, legacyKey) && values[legacyKey] != null) {
      return { value: values[legacyKey], legacy: true };
    }
    return { value: {}, legacy: false };
  }

  /**
   * 计算 JSON 配置的 UTF-8 字节数。
   * @param {unknown} value 待计算值。
   * @returns {number} 字节数。
   */
  function serializedSize(value) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return 0;
    // Chrome storage 配额按序列化后的字节数计算，不能用 JavaScript 字符数代替。
    return new TextEncoder().encode(serialized).byteLength;
  }

  function serializedItemSize(key, value) {
    return new TextEncoder().encode(key).byteLength + serializedSize(value);
  }

  function syncQuotaError(quota, requiredBytes, limitBytes) {
    const message = quota === "item"
      ? "Toolbox settings exceed the single-item browser sync limit."
      : "The browser sync storage does not have enough space for toolbox settings.";
    return Object.assign(
      new Error(`${message} Disable toolbox settings sync to save locally, or export a backup.`),
      { code: "browser-toolbox-sync-quota", quota, requiredBytes, limitBytes },
    );
  }

  function assertWithinSyncBudget(value, {
    itemLimit = MAX_SYNC_ITEM_BYTES,
    totalLimit = MAX_SYNC_BYTES,
    usedBytes = 0,
    replacedBytes = 0,
  } = {}) {
    // 单项限额包含键名；整个 sync 区域还与 Vimium 的键位、搜索引擎等设置共享总配额。
    const itemBytes = serializedItemSize(SETTINGS_KEY, value);
    if (itemBytes > itemLimit) throw syncQuotaError("item", itemBytes, itemLimit);
    const totalBytes = usedBytes - replacedBytes + itemBytes;
    if (totalBytes > totalLimit) {
      throw syncQuotaError("total", totalBytes, totalLimit);
    }
    return value;
  }

  class SettingsStorage {
    constructor(storage = chrome.storage) {
      this.sync = storage.sync;
      this.local = storage.local;
      this.session = storage.session;
    }

    /**
     * 根据设置选择规范存储区域。
     * @param {Object} value 设置值。
     * @returns {"sync"|"local"} 设置区域。
     */
    areaForSettings(value) {
      return value?.general?.browserSyncEnabled === false ? "local" : "sync";
    }

    async assertSyncBudget(value) {
      const limits = {
        itemLimit: this.sync.QUOTA_BYTES_PER_ITEM ?? MAX_SYNC_ITEM_BYTES,
        totalLimit: this.sync.QUOTA_BYTES ?? MAX_SYNC_BYTES,
      };
      assertWithinSyncBudget(value, limits);
      let usedBytes;
      let replacedBytes;
      if (typeof this.sync.getBytesInUse === "function") {
        [usedBytes, replacedBytes] = await Promise.all([
          this.sync.getBytesInUse(null),
          this.sync.getBytesInUse(SETTINGS_KEY),
        ]);
      } else {
        // 不提供计量 API 的兼容环境仍按同一规则检查，不能把其他 sync 键当作空闲空间。
        const values = await this.sync.get(null);
        usedBytes = Object.entries(values).reduce(
          (total, [key, item]) => total + serializedItemSize(key, item),
          0,
        );
        replacedBytes = Object.hasOwn(values, SETTINGS_KEY)
          ? serializedItemSize(SETTINGS_KEY, values[SETTINGS_KEY])
          : 0;
      }
      assertWithinSyncBudget(value, { ...limits, usedBytes, replacedBytes });
    }

    /**
     * 读取规范设置或兼容旧设置键。
     * @returns {Promise<BrowserToolboxStoredSettings>} 存储结果。
     */
    async readSettings() {
      const [syncValues, localValues] = await Promise.all([
        this.sync.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]),
        this.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]),
      ]);
      // 本地设置优先，避免用户关闭同步后又被其他设备的旧同步副本覆盖。
      const candidates = [
        { area: "local", values: localValues },
        { area: "sync", values: syncValues },
      ];
      let selected = null;
      for (const candidate of candidates) {
        if (
          Object.hasOwn(candidate.values, SETTINGS_KEY) && candidate.values[SETTINGS_KEY] != null
        ) {
          selected = {
            area: candidate.area,
            value: candidate.values[SETTINGS_KEY],
            legacy: false,
          };
          break;
        }
      }
      if (!selected) {
        for (const candidate of candidates) {
          if (
            Object.hasOwn(candidate.values, LEGACY_SETTINGS_KEY) &&
            candidate.values[LEGACY_SETTINGS_KEY] != null
          ) {
            selected = {
              area: candidate.area,
              value: candidate.values[LEGACY_SETTINGS_KEY],
              legacy: true,
            };
            break;
          }
        }
      }
      selected ||= { area: null, value: {}, legacy: false };
      return {
        value: selected.value || {},
        legacy: selected.legacy,
        area: selected.area,
        canonicalPresent: selected.area != null &&
          (selected.area === "local" ? localValues[SETTINGS_KEY] : syncValues[SETTINGS_KEY]) !=
            null,
        locations: {
          sync: {
            canonicalPresent: syncValues[SETTINGS_KEY] != null,
            value: syncValues[SETTINGS_KEY],
          },
          local: {
            canonicalPresent: localValues[SETTINGS_KEY] != null,
            value: localValues[SETTINGS_KEY],
          },
        },
      };
    }

    /**
     * 写入经过上层校验的规范设置。
     * @param {Object} value 设置值。
     * @returns {Promise<"sync"|"local">} 实际写入的存储区域。
     */
    async writeSettings(value) {
      const area = this.areaForSettings(value);
      const target = area === "local" ? this.local : this.sync;
      if (area === "sync") await this.assertSyncBudget(value);
      const other = area === "local" ? this.sync : this.local;
      const previousTargetValues = await target.get(SETTINGS_KEY);
      const previousTarget = previousTargetValues?.[SETTINGS_KEY];
      const hadPreviousTarget = Object.hasOwn(previousTargetValues || {}, SETTINGS_KEY);
      const previousOtherValues = await other.get(SETTINGS_KEY);
      const previousOther = previousOtherValues?.[SETTINGS_KEY];
      const hadPreviousOther = Object.hasOwn(previousOtherValues || {}, SETTINGS_KEY);
      let targetWriteAttempted = false;
      try {
        targetWriteAttempted = true;
        await target.set({ [SETTINGS_KEY]: value });
        // 跨区域切换先写新值再删除旧值；清理失败时回滚新区域，保留旧设置可继续使用。
        await other.remove(SETTINGS_KEY);
      } catch (error) {
        if (targetWriteAttempted) {
          try {
            if (hadPreviousTarget) await target.set({ [SETTINGS_KEY]: previousTarget });
            else await target.remove(SETTINGS_KEY);
          } catch (rollbackError) {
            error.rollbackError = rollbackError;
          }
        }
        // remove 可能已经完成实际删除后才抛错；旧区域也必须按操作前快照恢复。
        try {
          if (hadPreviousOther) await other.set({ [SETTINGS_KEY]: previousOther });
          else await other.remove(SETTINGS_KEY);
        } catch (rollbackError) {
          if (error.rollbackError) error.rollbackErrors = [error.rollbackError, rollbackError];
          else error.rollbackError = rollbackError;
        }
        throw error;
      }
      return area;
    }

    async writeMigrationBackup(value) {
      await this.local.set({ [BACKUP_KEY]: valueUtils.clone(value) });
    }

    /**
     * 读取本地资源。
     * @param {string} id 资源键。
     * @returns {Promise<unknown>} 资源或 undefined。
     */
    async readLocalAsset(id) {
      if (typeof id !== "string" || id.length === 0) return undefined;
      const values = await this.local.get(id);
      return values[id];
    }

    async writeLocalAsset(id, asset) {
      if (typeof id !== "string" || id.length === 0) {
        throw new Error("Local asset id must be a non-empty string.");
      }
      await this.local.set({ [id]: asset });
    }

    async removeLocalAsset(id) {
      if (typeof id !== "string" || id.length === 0) return;
      await this.local.remove(id);
    }

    async restoreSettings(value, state) {
      if (typeof state === "boolean") {
        if (!state) await this.sync.remove(SETTINGS_KEY);
        else await this.sync.set({ [SETTINGS_KEY]: value });
        return;
      }
      const locations = state?.locations || {};
      for (const [area, storage] of [["sync", this.sync], ["local", this.local]]) {
        const previous = locations[area];
        if (previous?.canonicalPresent) await storage.set({ [SETTINGS_KEY]: previous.value });
        else await storage.remove(SETTINGS_KEY);
      }
    }

    async readSessionOverrides() {
      const values = await this.session.get([SESSION_KEY, LEGACY_SESSION_KEY]);
      const selected = preferredValue(values, SESSION_KEY, LEGACY_SESSION_KEY);
      return { value: selected.value || {}, legacy: selected.legacy };
    }

    async writeSessionOverrides(value) {
      await this.session.set({ [SESSION_KEY]: value });
    }

    async clearSessionOverrides() {
      await this.session.remove(SESSION_KEY);
      // 旧会话键只用于兼容迁移；用户明确清除会话覆盖时不能让它再次回退生效。
      await this.session.remove(LEGACY_SESSION_KEY);
    }

    async getStoredLocale() {
      const stored = await this.readSettings();
      return stored.value?.general?.language;
    }
  }

  globalThis.BrowserToolboxStorageKeys = STORAGE_KEYS;
  globalThis.BrowserToolboxSettingsStorage = Object.freeze({
    MAX_SYNC_BYTES,
    MAX_SYNC_ITEM_BYTES,
    STORAGE_KEYS,
    preferredValue,
    serializedSize,
    serializedItemSize,
    assertWithinSyncBudget,
  });
  globalThis.BrowserToolboxSettingsStorageAdapter = SettingsStorage;
  globalThis.BrowserToolboxSettingsStorageInstance ||= new SettingsStorage();
})();

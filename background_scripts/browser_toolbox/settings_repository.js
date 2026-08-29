// 配置仓库：配置按用户选择进入 sync 或 local，指针等本地资源进入 local，会话覆盖进入 session。
/**
 * 仓库对外返回的有效设置快照。
 * @typedef {Object} BrowserToolboxRepositorySettings
 * @property {Object} settings 规范设置。
 * @property {Object<string, boolean>} sessionOverrides 会话覆盖。
 */
(function () {
  const schema = globalThis.BrowserToolboxSettingsSchema;
  const migrations = globalThis.BrowserToolboxSettingsMigrations;
  const validator = globalThis.BrowserToolboxSettingsValidator;
  const policy = globalThis.BrowserToolboxSettingsPolicy;
  const storage = globalThis.BrowserToolboxSettingsStorageInstance;
  const vimiumSettings = globalThis.BrowserToolboxVimiumSettingsAdapterInstance;
  const storageKeys = globalThis.BrowserToolboxStorageKeys;
  const SETTINGS_KEY = storageKeys.settings;
  const LEGACY_SETTINGS_KEY = storageKeys.legacySettings;
  const SESSION_KEY = storageKeys.sessionOverrides;

  class SettingsRepository {
    constructor(storageAdapter = storage, vimiumSettingsAdapter = vimiumSettings) {
      this.storage = storageAdapter;
      this.vimiumSettings = vimiumSettingsAdapter;
      this.settings = null;
      this.sessionOverrides = {};
      this.listenerInstalled = false;
      this.loadingPromise = null;
      this.reloadPromise = null;
      this.reloadQueued = false;
      this.storageArea = null;
      this.listeners = new Set();
    }

    /**
     * 读取、逐级迁移、校验并缓存设置。
     * @param {Object} registry 命令注册表。
     * @returns {Promise<Object>} 有效设置快照。
     */
    async load(registry) {
      const stored = await this.storage.readSettings();
      const raw = stored.value || {};
      const previousSettings = this.settings;
      const previousSessionOverrides = this.sessionOverrides;
      let migrated;
      let needsMigration = stored.legacy;
      try {
        migrated = migrations.migrate(raw);
        // Chrome storage 可能重排对象键；只比较实际值，避免把规范配置误写成迁移备份。
        needsMigration ||= !globalThis.BrowserToolboxValueUtils.equalValues(raw, migrated);
        // 旧版本可能把 browserSyncEnabled=false 错写进 sync；首次读取时搬到 local。
        const expectedArea = this.storage.areaForSettings(migrated);
        needsMigration ||= stored.area != null && stored.area !== expectedArea;
        if (needsMigration) await this.storage.writeMigrationBackup(raw);
        const validation = validator.validate(migrated, registry);
        if (!validation.ok) throw new Error(validation.errors.join("\n"));
        if (needsMigration) await this.storage.writeSettings(migrated);
        const storedSession = await this.storage.readSessionOverrides();
        const sessionOverrides = policy.validateSessionOverrides(storedSession.value || {});
        this.settings = validation.value;
        this.sessionOverrides = sessionOverrides;
        this.storageArea = expectedArea;
        if (storedSession.legacy) await this.storage.writeSessionOverrides(this.sessionOverrides);
        this.installListener(registry);
        return this.getSettings();
      } catch (error) {
        if (needsMigration) {
          try {
            await this.storage.restoreSettings(raw, stored);
          } catch (_) {
            // 保留原始错误；下次启动仍会重新执行校验和迁移。
          }
        }
        this.settings = previousSettings;
        this.sessionOverrides = previousSessionOverrides;
        throw error;
      }
    }

    installListener(registry) {
      if (this.listenerInstalled || !chrome.storage?.onChanged?.addListener) return;
      this.listenerInstalled = true;
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (
          (area === "sync" || area === "local") &&
          (changes[SETTINGS_KEY] || changes[LEGACY_SETTINGS_KEY])
        ) {
          const canonicalChange = changes[SETTINGS_KEY];
          const legacyChange = changes[LEGACY_SETTINGS_KEY];
          const change = canonicalChange || legacyChange;
          const nextValue = change?.newValue;
          const expectedArea = nextValue == null
            ? this.storageArea
            : this.storage.areaForSettings(nextValue);
          // 同步/本地切换涉及两个 storage area，统一重读可避免先到达的事件覆盖真实来源。
          if (
            legacyChange || area !== this.storageArea || expectedArea !== area || nextValue == null
          ) {
            this.scheduleReload(registry);
          } else {
            try {
              this.settings = validator.assertValid(migrations.migrate(nextValue), registry);
              this.storageArea = expectedArea;
              this.emit();
            } catch (error) {
              // 外部设备配置可能被写坏；保留最后一份有效内存快照。
              this.lastError = error;
            }
          }
        }
        if (area === "session" && changes[SESSION_KEY]) {
          try {
            this.sessionOverrides = policy.validateSessionOverrides(
              changes[SESSION_KEY].newValue || {},
            );
            this.emit();
          } catch (error) {
            this.lastError = error;
          }
        }
      });
    }

    scheduleReload(registry) {
      this.reloadQueued = true;
      if (this.reloadPromise) return this.reloadPromise;
      const reload = async () => {
        while (this.reloadQueued) {
          this.reloadQueued = false;
          try {
            await this.load(registry);
            this.emit();
          } catch (error) {
            this.lastError = error;
          }
        }
      };
      const promise = reload().finally(() => {
        if (this.reloadPromise === promise) this.reloadPromise = null;
      });
      this.reloadPromise = promise;
      return promise;
    }

    /**
     * 只在尚未加载时初始化仓库。
     * @param {Object} registry 命令注册表。
     * @returns {Promise<Object>} 当前设置。
     */
    async ensureLoaded(registry) {
      if (!this.settings) {
        if (!this.loadingPromise) {
          this.loadingPromise = this.load(registry).finally(() => {
            this.loadingPromise = null;
          });
        }
        await this.loadingPromise;
      }
      return this.settings;
    }

    // 页面只需要读取语言偏好时，由仓库统一处理规范键和旧键的兼容优先级。
    async getStoredLocale() {
      return this.storage.getStoredLocale();
    }

    async readLocalAsset(id) {
      return this.storage.readLocalAsset(id);
    }

    async writeLocalAsset(id, asset) {
      return this.storage.writeLocalAsset(id, asset);
    }

    async removeLocalAsset(id) {
      return this.storage.removeLocalAsset(id);
    }

    getSettings() {
      return schema.clone(this.settings || schema.DEFAULT_SETTINGS);
    }

    /**
     * 计算指定顶层 URL 的有效配置。
     * @param {string} [url] 顶层页面 URL。
     * @returns {Object} 带有效模块状态的设置。
     */
    getEffectiveSettings(url = "") {
      const settings = this.getSettings();
      let exclusionRules = settings.exclusionRules;
      try {
        if (this.vimiumSettings?.isLoaded?.()) {
          exclusionRules = this.vimiumSettings.get("exclusionRules");
        }
      } catch (_) {
        // Vimium 设置尚未加载时，继续使用 BrowserToolbox 备份中的规则。
      }
      return policy.withEffectiveSettings(settings, url, {
        exclusionRules,
        sessionOverrides: this.sessionOverrides,
      });
    }

    async getSearchEngines() {
      try {
        // 搜索引擎由 Vimium 独立保存；命令可能紧跟设置页保存执行，先刷新避免读取旧缓存。
        await this.vimiumSettings?.load?.();
      } catch (_) {
        // 外部设置不可用时继续尝试读取已有内存快照和导入配置副本。
      }
      try {
        const value = this.vimiumSettings?.get?.("searchEngines");
        if (typeof value === "string") return value;
      } catch (_) {
        // 外部设置不可用时回退到导入配置中的只读副本。
      }
      const value = this.getSettings().searchEngines;
      return typeof value === "string" ? value : "";
    }

    /**
     * 校验并持久化规范设置。
     * @param {Object} settings 新设置。
     * @param {Object} registry 命令注册表。
     * @returns {Promise<Object>} 已保存设置。
     */
    async setSettings(settings, registry) {
      const migrated = migrations.migrate(settings);
      const validation = validator.validate(migrated, registry);
      if (!validation.ok) throw new Error(validation.errors.join("\n"));
      const previous = this.settings;
      try {
        await this.storage.writeSettings(validation.value);
      } catch (error) {
        this.settings = previous;
        throw error;
      }
      this.settings = validation.value;
      this.storageArea = this.storage.areaForSettings(validation.value);
      this.emit();
      return this.getSettings();
    }

    /**
     * 基于当前设置执行一次受控更新。
     * @param {function(Object): (Object|Promise<Object>)} mutator 更新函数。
     * @param {Object} registry 命令注册表。
     * @returns {Promise<Object>} 已保存设置。
     */
    async update(mutator, registry) {
      const next = this.getSettings();
      const result = await mutator(next);
      return this.setSettings(result || next, registry);
    }

    async setSessionOverrides(overrides) {
      const next = policy.validateSessionOverrides(overrides, { strict: true });
      const previous = this.sessionOverrides;
      try {
        await this.storage.writeSessionOverrides(next);
      } catch (error) {
        this.sessionOverrides = previous;
        throw error;
      }
      this.sessionOverrides = next;
      this.emit();
    }

    async clearSessionOverrides() {
      const previous = this.sessionOverrides;
      try {
        await this.storage.clearSessionOverrides();
      } catch (error) {
        this.sessionOverrides = previous;
        throw error;
      }
      this.sessionOverrides = {};
      this.emit();
    }

    addEventListener(listener) {
      this.listeners.add(listener);
    }

    removeEventListener(listener) {
      this.listeners.delete(listener);
    }

    emit() {
      for (const listener of this.listeners) listener(this.getSettings());
    }
  }

  globalThis.BrowserToolboxSettingsRepository = SettingsRepository;
  globalThis.BrowserToolboxSettingsRepositoryInstance ||= new SettingsRepository();
})();

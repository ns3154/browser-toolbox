// 配置仓库：小配置进入 sync，指针等本地资源进入 local，会话覆盖进入 session。
(function () {
  const schema = globalThis.OpenKeyMouseSettingsSchema;
  const migrations = globalThis.OpenKeyMouseSettingsMigrations;
  const validator = globalThis.OpenKeyMouseSettingsValidator;
  const matcher = globalThis.OpenKeyMouseSiteRuleMatcher;
  const SETTINGS_KEY = "openKeyMouseSettings";
  const BACKUP_KEY = "openKeyMouseSettingsMigrationBackup";
  const SESSION_KEY = "openKeyMouseSessionOverrides";

  class SettingsRepository {
    constructor() {
      this.settings = null;
      this.sessionOverrides = {};
      this.listenerInstalled = false;
      this.listeners = new Set();
    }

    async load(registry) {
      const sync = await chrome.storage.sync.get(SETTINGS_KEY);
      const raw = sync[SETTINGS_KEY] || {};
      let migrated;
      let needsMigration = true;
      try {
        migrated = migrations.migrate(raw);
        needsMigration = JSON.stringify(raw) !== JSON.stringify(migrated);
        if (needsMigration) await chrome.storage.local.set({ [BACKUP_KEY]: raw });
        const validation = validator.validate(migrated, registry);
        if (!validation.ok) throw new Error(validation.errors.join("\n"));
        if (needsMigration) await chrome.storage.sync.set({ [SETTINGS_KEY]: migrated });
        const session = await chrome.storage.session.get(SESSION_KEY);
        this.settings = validation.value;
        this.sessionOverrides = session[SESSION_KEY] || {};
        this.installListener(registry);
        return this.getSettings();
      } catch (error) {
        if (needsMigration) {
          await chrome.storage.sync.set({ [SETTINGS_KEY]: raw });
        }
        throw error;
      }
    }

    installListener(registry) {
      if (this.listenerInstalled || !chrome.storage?.onChanged?.addListener) return;
      this.listenerInstalled = true;
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area === "sync" && changes[SETTINGS_KEY]) {
          this.settings = validator.assertValid(
            migrations.migrate(changes[SETTINGS_KEY].newValue || {}),
            registry,
          );
          this.emit();
        }
        if (area === "session" && changes[SESSION_KEY]) {
          this.sessionOverrides = changes[SESSION_KEY].newValue || {};
          this.emit();
        }
      });
    }

    async ensureLoaded(registry) {
      if (!this.settings) await this.load(registry);
      return this.settings;
    }

    getSettings() {
      return schema.clone(this.settings || schema.DEFAULT_SETTINGS);
    }

    getEffectiveSettings(url = "") {
      const settings = this.getSettings();
      const modules = matcher.resolve(settings.siteRules, url, {
        enabled: settings.general.enabled,
        keyboard: settings.keyboard.enabled,
        mouse: settings.mouse.enabled,
        superDrag: settings.superDrag.enabled,
        wheel: settings.wheel.enabled,
        rocker: settings.rocker.enabled,
        cursor: settings.cursor.enabled,
      });
      let exclusionRules = settings.exclusionRules;
      try {
        if (globalThis.Settings?.isLoaded?.()) exclusionRules = Settings.get("exclusionRules");
      } catch (_) {
        // Vimium 设置尚未加载时，继续使用 OpenKeyMouse 备份中的规则。
      }
      if (matcher.exclusionState(exclusionRules, url).disabled) modules.keyboard = false;
      for (const [key, value] of Object.entries(this.sessionOverrides)) {
        if (value === true || value === false) modules[key] = value;
      }
      return Object.assign(settings, { effectiveModules: modules });
    }

    async setSettings(settings, registry) {
      const migrated = migrations.migrate(settings);
      const validation = validator.validate(migrated, registry);
      if (!validation.ok) throw new Error(validation.errors.join("\n"));
      const serialized = JSON.stringify(validation.value);
      if (serialized.length > 100 * 1024) {
        throw new Error("Synchronized settings exceed the safe size limit.");
      }
      this.settings = validation.value;
      await chrome.storage.sync.set({ [SETTINGS_KEY]: validation.value });
      this.emit();
      return this.getSettings();
    }

    async update(mutator, registry) {
      const next = this.getSettings();
      const result = await mutator(next);
      return this.setSettings(result || next, registry);
    }

    async setSessionOverrides(overrides) {
      const allowed = new Set([
        "enabled",
        "keyboard",
        "mouse",
        "superDrag",
        "wheel",
        "rocker",
        "cursor",
      ]);
      if (
        !overrides || typeof overrides !== "object" ||
        Object.entries(overrides).some(([key, value]) =>
          !allowed.has(key) || typeof value !== "boolean"
        )
      ) {
        throw new Error("Session overrides must contain only module booleans.");
      }
      this.sessionOverrides = schema.clone(overrides);
      await chrome.storage.session.set({ [SESSION_KEY]: this.sessionOverrides });
      this.emit();
    }

    async clearSessionOverrides() {
      this.sessionOverrides = {};
      await chrome.storage.session.remove(SESSION_KEY);
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

  globalThis.OpenKeyMouseSettingsRepository = SettingsRepository;
  globalThis.OpenKeyMouseSettingsRepositoryInstance ||= new SettingsRepository();
})();

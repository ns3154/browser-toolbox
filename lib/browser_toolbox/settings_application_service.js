// 设置应用服务：编排 BrowserToolbox 与 Vimium 两个设置域，不依赖 DOM。
/**
 * 设置页同时读取的两个存储域快照。
 * @typedef {Object} BrowserToolboxSettingsSnapshot
 * @property {Object} settings 合并后的页面设置。
 * @property {Object} browserToolbox BrowserToolbox 原始设置。
 * @property {Object} vimium Vimium 原始设置。
 */
/**
 * 设置应用服务依赖。
 * @typedef {Object} BrowserToolboxSettingsApplicationDependencies
 * @property {Object} repository BrowserToolbox 设置仓库。
 * @property {Object} vimiumSettings Vimium 设置适配层。
 * @property {Object} [migrations] 导入导出迁移层。
 * @property {Object} [commitCoordinator] 提交协调器。
 * @property {Object} [valueUtils] 配置值工具。
 */
(function () {
  const defaultMigrations = globalThis.BrowserToolboxSettingsMigrations;
  const defaultCommitCoordinator = globalThis.BrowserToolboxSettingsCommitCoordinator;
  const defaultValueUtils = globalThis.BrowserToolboxValueUtils;

  function clone(value, valueUtils = defaultValueUtils) {
    return valueUtils.clone(value);
  }

  function pickValues(value, keys, valueUtils = defaultValueUtils) {
    return Object.fromEntries(
      [...keys].sort().map((key) => [key, clone(value?.[key], valueUtils)]),
    );
  }

  function browserToolboxConflictSnapshot(value, valueUtils = defaultValueUtils) {
    const snapshot = clone(value || {}, valueUtils);
    if (snapshot.keyboard && typeof snapshot.keyboard === "object") {
      // 这两个字段的真实来源是 Vimium；BrowserToolbox 只保留副本用于导出和页面展示。
      delete snapshot.keyboard.keyMappings;
    }
    delete snapshot.searchEngines;
    // exclusionRules 的真实写入者仍是 Vimium options/action 页面。
    delete snapshot.exclusionRules;
    return snapshot;
  }

  /**
   * 合并两个设置域供设置页使用。
   * @param {Object} browserToolboxSettings BrowserToolbox 设置。
   * @param {Object} vimiumSettings Vimium 设置。
   * @param {Object} [valueUtils] 配置值工具。
   * @returns {Object} 页面设置快照。
   */
  function composeSettings(browserToolboxSettings, vimiumSettings, valueUtils = defaultValueUtils) {
    const settings = clone(browserToolboxSettings || {}, valueUtils);
    settings.keyboard ||= {};
    settings.keyboard.keyMappings = clone(vimiumSettings?.keyMappings, valueUtils);
    settings.searchEngines = clone(vimiumSettings?.searchEngines, valueUtils);
    return settings;
  }

  class SettingsApplicationService {
    /**
     * 创建双存储域设置应用服务。
     * @param {BrowserToolboxSettingsApplicationDependencies} options 服务依赖。
     */
    constructor({
      repository,
      vimiumSettings,
      migrations = defaultMigrations,
      commitCoordinator = defaultCommitCoordinator,
      valueUtils = defaultValueUtils,
    } = {}) {
      this.repository = repository;
      this.vimiumSettings = vimiumSettings;
      this.migrations = migrations;
      this.commitCoordinator = commitCoordinator;
      this.valueUtils = valueUtils;
      this.baseline = null;
    }

    /**
     * 捕获当前两个设置域的独立快照。
     * @param {{saveBaseline?: boolean}} [options] 是否保存冲突基线。
     * @returns {BrowserToolboxSettingsSnapshot} 当前快照。
     */
    capture({ saveBaseline = false } = {}) {
      const browserToolbox = this.repository.getSettings();
      const vimium = this.vimiumSettings.getSettings();
      const snapshot = {
        settings: composeSettings(browserToolbox, vimium, this.valueUtils),
        browserToolbox: clone(browserToolbox, this.valueUtils),
        vimium: clone(vimium, this.valueUtils),
      };
      if (saveBaseline) {
        this.baseline = {
          browserToolbox: clone(snapshot.browserToolbox, this.valueUtils),
          vimium: clone(snapshot.vimium, this.valueUtils),
        };
      }
      return snapshot;
    }

    /**
     * 等待两个设置域加载并保存初始冲突基线。
     * @param {Object} registry 命令注册表。
     * @returns {Promise<BrowserToolboxSettingsSnapshot>} 初始快照。
     */
    async load(registry) {
      await this.vimiumSettings.onLoaded();
      await this.repository.ensureLoaded(registry);
      return this.capture({ saveBaseline: true });
    }

    /**
     * 对两个设置域执行带冲突检查和回滚的提交。
     * @param {Object} next 页面编辑后的设置。
     * @param {{registry: Object, vimiumPatch?: Object}} options 提交依赖和 Vimium 补丁。
     * @returns {Promise<BrowserToolboxSettingsSnapshot>} 提交后的快照。
     */
    async commit(next, { registry, vimiumPatch = {} } = {}) {
      // storage.onChanged 是异步通知；提交前主动重读两个存储域，避免用旧内存快照覆盖
      // 其他页面或设备刚刚修改的无关设置。协调器随后执行 TOCTOU 冲突检查和回滚。
      await this.vimiumSettings.load();
      await this.repository.load(registry);

      const previousVimium = this.vimiumSettings.getSettings();
      const previousBrowserToolbox = this.repository.getSettings();
      const nextVimium = Object.assign(
        clone(previousVimium, this.valueUtils),
        clone(vimiumPatch, this.valueUtils),
        {
          keyMappings: clone(next?.keyboard?.keyMappings, this.valueUtils),
          searchEngines: clone(next?.searchEngines, this.valueUtils),
        },
      );
      const touchedVimiumKeys = new Set([
        "keyMappings",
        "searchEngines",
        ...Object.keys(vimiumPatch),
      ]);
      const baseline = this.baseline || {
        vimium: previousVimium,
        browserToolbox: previousBrowserToolbox,
      };
      const nextBrowserToolbox = browserToolboxConflictSnapshot(next, this.valueUtils);
      const expectedVimium = pickValues(baseline.vimium, touchedVimiumKeys, this.valueUtils);
      const actualVimium = () =>
        pickValues(this.vimiumSettings.getSettings(), touchedVimiumKeys, this.valueUtils);
      const expectedBrowserToolbox = browserToolboxConflictSnapshot(
        baseline.browserToolbox,
        this.valueUtils,
      );
      const actualBrowserToolbox = () =>
        browserToolboxConflictSnapshot(this.repository.getSettings(), this.valueUtils);
      const equal = this.commitCoordinator.equalValues;
      const equalOrAlreadyApplied = (expected, actual, applied) =>
        equal(expected, actual) || equal(actual, applied);

      await new this.commitCoordinator.SettingsCommitCoordinator().commit({
        guards: [
          {
            name: "Vimium",
            expected: expectedVimium,
            read: actualVimium,
            equal: (expected, actual) =>
              equalOrAlreadyApplied(
                expected,
                actual,
                pickValues(nextVimium, touchedVimiumKeys, this.valueUtils),
              ),
          },
          {
            name: "BrowserToolbox",
            expected: expectedBrowserToolbox,
            read: actualBrowserToolbox,
            equal: (expected, actual) =>
              equalOrAlreadyApplied(expected, actual, nextBrowserToolbox),
          },
        ],
        operations: [
          {
            id: "Vimium",
            before: previousVimium,
            next: nextVimium,
            write: (value) => this.vimiumSettings.setSettings(value),
          },
          {
            id: "BrowserToolbox",
            before: previousBrowserToolbox,
            next,
            write: (value) => this.repository.setSettings(value, registry),
          },
        ],
      });

      return this.capture({ saveBaseline: true });
    }

    createExportPayload(settings, options = {}) {
      return this.migrations.createExportPayload(settings, options);
    }

    migrateExportPayload(payload) {
      return this.migrations.migrateExportPayload(payload);
    }
  }

  globalThis.BrowserToolboxSettingsApplicationService = Object.freeze({
    SettingsApplicationService,
    browserToolboxConflictSnapshot,
    composeSettings,
    pickValues,
  });
})();

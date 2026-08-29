// Vimium 设置适配层：Browser Toolbox 核心只通过这个门面读取外部设置。
/**
 * Vimium 设置适配层的解析函数。
 * @callback BrowserToolboxVimiumSettingsResolver
 * @returns {Object|null} 当前可用的 Vimium Settings 对象。
 */
(function () {
  class VimiumSettingsAdapter {
    /**
     * 创建外部设置门面。
     * @param {BrowserToolboxVimiumSettingsResolver} [resolve] 设置解析函数。
     */
    constructor(resolve = () => globalThis.Settings) {
      this.resolve = resolve;
    }

    source() {
      return this.resolve?.() || null;
    }

    isAvailable() {
      return Boolean(this.source());
    }

    isLoaded() {
      return Boolean(this.source()?.isLoaded?.());
    }

    /**
     * 读取一个 Vimium 设置字段。
     * @param {string} key 设置键。
     * @returns {unknown} 设置值。
     */
    get(key) {
      return this.source()?.get?.(key);
    }

    getSettings() {
      return this.source()?.getSettings?.();
    }

    async load() {
      return this.source()?.load?.();
    }

    async onLoaded() {
      return this.source()?.onLoaded?.();
    }

    /**
     * 写入一个 Vimium 设置字段。
     * @param {string} key 设置键。
     * @param {unknown} value 设置值。
     * @returns {Promise<unknown>} 外部设置层结果。
     */
    async set(key, value) {
      return this.source()?.set?.(key, value);
    }

    async setSettings(value) {
      return this.source()?.setSettings?.(value);
    }
  }

  globalThis.BrowserToolboxVimiumSettingsAdapter = Object.freeze({ VimiumSettingsAdapter });
  globalThis.BrowserToolboxVimiumSettingsAdapterInstance ||= new VimiumSettingsAdapter();
})();

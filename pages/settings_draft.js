// 设置页草稿状态：把已保存配置和当前编辑配置分开，避免界面直接误改持久化快照。
/**
 * 草稿状态变更通知。
 * @typedef {Object} BrowserToolboxDraftState
 * @property {boolean} dirty 是否有未保存修改。
 * @property {Array<string>} changedKeys 顶层变更键。
 */
(function () {
  const valueUtils = globalThis.BrowserToolboxValueUtils;
  const { MAX_COMPARISON_NODES, clone, equalValues } = valueUtils;

  class SettingsDraft {
    /**
     * 创建一份独立的设置草稿。
     * @param {Object} initial 初始设置。
     */
    constructor(initial) {
      this.saved = clone(initial);
      this.current = clone(initial);
      // null 表示当前缓存失效，需要在下一次状态读取时重新计算。
      this.dirtyHint = null;
      this.forcedDirty = false;
      this.listeners = new Set();
    }

    get isDirty() {
      if (this.dirtyHint === null) {
        this.dirtyHint = !equalValues(this.current, this.saved);
      }
      return this.forcedDirty || this.dirtyHint;
    }

    getMutable() {
      return this.current;
    }

    snapshot() {
      return clone(this.current);
    }

    savedSnapshot() {
      return clone(this.saved);
    }

    /**
     * 替换当前草稿，可选地同时标记为已保存。
     * @param {Object} value 新设置。
     * @param {boolean} [saved] 是否同步更新已保存快照。
     * @returns {Object} 当前草稿。
     */
    replace(value, saved = false) {
      this.current = clone(value);
      this.dirtyHint = null;
      this.forcedDirty = false;
      if (saved) this.saved = clone(value);
      this.emit();
      return this.current;
    }

    markDirty(force = false) {
      // 输入事件使缓存失效；emit 会同时计算变更键，改回原值时可正确恢复干净状态。
      if (force) this.forcedDirty = true;
      this.dirtyHint = null;
      this.emit();
    }

    /**
     * 将当前值记录为已保存状态。
     * @param {Object} [value] 已保存设置。
     * @returns {Object} 当前草稿。
     */
    markSaved(value = this.current) {
      this.current = clone(value);
      this.saved = clone(value);
      this.dirtyHint = null;
      this.forcedDirty = false;
      this.emit();
      return this.current;
    }

    /**
     * 放弃修改并恢复已保存快照。
     * @returns {Object} 恢复后的草稿。
     */
    reset() {
      this.current = clone(this.saved);
      this.dirtyHint = null;
      this.forcedDirty = false;
      this.emit();
      return this.current;
    }

    changedKeys() {
      const keys = new Set([...Object.keys(this.saved), ...Object.keys(this.current)]);
      return [...keys].filter((key) => !equalValues(this.saved[key], this.current[key]));
    }

    addEventListener(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit() {
      const changedKeys = this.changedKeys();
      this.dirtyHint = changedKeys.length > 0;
      const state = { dirty: this.forcedDirty || this.dirtyHint, changedKeys };
      for (const listener of this.listeners) listener(state);
    }
  }

  globalThis.BrowserToolboxSettingsDraft = Object.freeze({
    MAX_COMPARISON_NODES,
    SettingsDraft,
    clone,
    equalValues,
  });
})();

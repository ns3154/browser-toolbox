// 设置提交协调器：串行提交多个存储域，并在部分成功时按逆序恢复。
/**
 * 一个可回滚的设置写入操作。
 * @typedef {Object} BrowserToolboxCommitOperation
 * @property {string} id 操作名称。
 * @property {unknown} before 写入前值。
 * @property {unknown} next 目标值。
 * @property {function(unknown): (void|Promise<void>)} write 写入函数。
 */
/**
 * 一个提交前的外部变更保护条件。
 * @typedef {Object} BrowserToolboxCommitGuard
 * @property {string} name 存储域名称。
 * @property {unknown} expected 预期快照。
 * @property {function(): (unknown|Promise<unknown>)} read 读取实际值。
 * @property {function(unknown, unknown): boolean} [equal] 比较函数。
 */
(function () {
  const valueUtils = globalThis.BrowserToolboxValueUtils;
  const { MAX_COMPARISON_NODES, clone, diffPaths, equalValues } = valueUtils;

  class SettingsCommitConflictError extends Error {
    /**
     * 创建带字段路径的冲突错误。
     * @param {Array<Object>} conflicts 冲突列表。
     */
    constructor(conflicts) {
      super("Settings changed outside this page.");
      this.name = "SettingsCommitConflictError";
      this.code = "browser-toolbox-settings-conflict";
      this.conflicts = conflicts;
    }
  }

  function validateOperations(operations) {
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new Error("Settings commit requires at least one storage operation.");
    }
    const names = new Set();
    for (const operation of operations) {
      if (!operation?.id || names.has(operation.id) || typeof operation.write !== "function") {
        throw new Error("Settings commit contains an invalid storage operation.");
      }
      names.add(operation.id);
    }
  }

  /**
   * 检查所有存储域是否仍处于预期快照。
   * @param {Array<BrowserToolboxCommitGuard>} guards 冲突保护条件。
   * @returns {Promise<void>} 检查完成。
   */
  async function checkGuards(guards) {
    const conflicts = [];
    for (const guard of guards || []) {
      if (!guard?.name || typeof guard.read !== "function") {
        throw new Error("Settings commit contains an invalid conflict guard.");
      }
      const actual = await guard.read();
      const equal = guard.equal || equalValues;
      const matches = equal(guard.expected, actual);
      if (!matches) {
        // 冲突提示只携带字段路径，不把完整设置快照挂到异常对象上。
        const difference = diffPaths(guard.expected, actual, guard.diffOptions);
        conflicts.push({
          name: guard.name,
          paths: difference.paths,
          truncated: difference.truncated,
        });
      }
    }
    if (conflicts.length > 0) {
      throw new SettingsCommitConflictError(conflicts);
    }
  }

  class SettingsCommitCoordinator {
    /**
     * 串行提交变更，部分失败时逆序恢复已尝试操作。
     * @param {{operations: Array<BrowserToolboxCommitOperation>, guards?: Array<BrowserToolboxCommitGuard>}} input 提交输入。
     * @returns {Promise<{changed: Array<string>}>} 已变更的操作 ID。
     */
    async commit({ operations, guards = [] }) {
      validateOperations(operations);
      await checkGuards(guards);

      const changed = operations.filter((operation) =>
        !equalValues(operation.before, operation.next)
      );
      const attempted = [];
      try {
        for (const operation of changed) {
          // 写入抛错时也可能已经部分落盘，因此先登记为待恢复操作。
          attempted.push(operation);
          await operation.write(clone(operation.next));
        }
        return { changed: changed.map((operation) => operation.id) };
      } catch (error) {
        const rollbackErrors = [];
        for (const operation of attempted.slice().reverse()) {
          try {
            await operation.write(clone(operation.before));
          } catch (rollbackError) {
            rollbackErrors.push({
              id: operation.id,
              error: rollbackError,
            });
          }
        }
        if (rollbackErrors.length > 0) error.rollbackErrors = rollbackErrors;
        throw error;
      }
    }
  }

  globalThis.BrowserToolboxSettingsCommitCoordinator = Object.freeze({
    MAX_COMPARISON_NODES,
    SettingsCommitCoordinator,
    SettingsCommitConflictError,
    clone,
    diffPaths,
    equalValues,
  });
})();

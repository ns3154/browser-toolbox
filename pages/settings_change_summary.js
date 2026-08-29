// 设置导入的变更摘要。只比较普通数据，不执行任何用户提供的代码或正则。
/**
 * 设置变更摘要。
 * @typedef {Object} BrowserToolboxSettingsChangeSummary
 * @property {Array<string>} added 新增路径。
 * @property {Array<string>} changed 修改路径。
 * @property {Array<string>} removed 删除路径。
 * @property {boolean} truncated 是否因条目上限截断。
 */
(function () {
  const MAX_ITEMS = 100;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  }

  function equalValues(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
        left.every((value, index) => equalValues(value, right[index]));
    }
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && equalValues(left[key], right[key]));
  }

  function pathForKey(path, key) {
    return path ? `${path}.${key}` : key;
  }

  /**
   * 比较两份普通配置并生成字段级摘要。
   * @param {unknown} before 旧配置。
   * @param {unknown} after 新配置。
   * @returns {BrowserToolboxSettingsChangeSummary} 变更摘要。
   */
  function summarize(before, after) {
    const result = { added: [], changed: [], removed: [], truncated: false };

    function add(kind, path) {
      const value = path || "settings";
      if (result[kind].includes(value)) return;
      if (result[kind].length >= MAX_ITEMS) {
        result.truncated = true;
        return;
      }
      result[kind].push(value);
    }

    function walk(left, right, path, depth = 0) {
      if (equalValues(left, right)) return;
      if (left === undefined) {
        add("added", path);
        return;
      }
      if (right === undefined) {
        add("removed", path);
        return;
      }
      if (Array.isArray(left) && Array.isArray(right)) {
        const hasStableIds = left.every((item) =>
          isPlainObject(item) && typeof item.id === "string"
        ) &&
          right.every((item) => isPlainObject(item) && typeof item.id === "string");
        if (!hasStableIds) {
          add("changed", path);
          return;
        }
        const leftById = new Map(left.map((item) => [item.id, item]));
        const rightById = new Map(right.map((item) => [item.id, item]));
        for (const [id, item] of leftById) {
          const itemPath = `${path}[${id}]`;
          if (!rightById.has(id)) add("removed", itemPath);
          else walk(item, rightById.get(id), itemPath, depth + 1);
        }
        for (const [id] of rightById) {
          if (!leftById.has(id)) add("added", `${path}[${id}]`);
        }
        if (left.length !== right.length && leftById.size === rightById.size) add("changed", path);
        return;
      }
      if (isPlainObject(left) && isPlainObject(right) && depth < 6) {
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        for (const key of [...keys].sort()) {
          walk(left[key], right[key], pathForKey(path, key), depth + 1);
        }
        return;
      }
      add("changed", path);
    }

    walk(before, after, "");
    return result;
  }

  /**
   * 将字段路径的首段替换为本地化标签。
   * @param {string} path 字段路径。
   * @param {Object<string, string>} [labels] 标签映射。
   * @returns {string} 展示路径。
   */
  function formatPath(path, labels = {}) {
    const [first, ...rest] = String(path || "settings").split(".");
    return [labels[first] || first, ...rest].join(" › ");
  }

  globalThis.BrowserToolboxSettingsChangeSummary = Object.freeze({
    MAX_ITEMS,
    equalValues,
    summarize,
    formatPath,
  });
})();

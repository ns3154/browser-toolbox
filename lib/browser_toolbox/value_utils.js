// 配置值工具：集中处理防御性克隆和有界深比较，避免设置层各自维护不同实现。
/**
 * 配置差异结果。
 * @typedef {Object} BrowserToolboxDiffResult
 * @property {Array<string>} paths 发生变化的路径。
 * @property {boolean} truncated 是否因预算限制截断。
 */
(function () {
  const MAX_COMPARISON_NODES = 10000;

  /**
   * 防御性复制可序列化配置。
   * @param {unknown} value 待复制值。
   * @returns {unknown} 独立副本。
   */
  function clone(value) {
    return globalThis.structuredClone
      ? globalThis.structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  /**
   * 在有界预算内比较两个配置值。
   * @param {unknown} left 左值。
   * @param {unknown} right 右值。
   * @param {Object|null} [state] 递归比较状态。
   * @returns {boolean} 是否相等。
   */
  function equalValues(left, right, state = null) {
    state ||= { seenPairs: new WeakMap(), nodes: 0 };
    if (++state.nodes > MAX_COMPARISON_NODES) return false;
    if (Object.is(left, right)) return true;
    const leftObject = Boolean(left) && typeof left === "object";
    const rightObject = Boolean(right) && typeof right === "object";
    if (!leftObject || !rightObject) return false;
    let paired = state.seenPairs.get(left);
    if (paired?.has(right)) return true;
    if (!paired) {
      paired = new WeakSet();
      state.seenPairs.set(left, paired);
    }
    paired.add(right);
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
        left.every((value, index) => equalValues(value, right[index], state));
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) =>
        Object.hasOwn(right, key) && equalValues(left[key], right[key], state)
      );
  }

  function normalizeLimit(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  function stableIdKey(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const id = value.id;
    if (typeof id !== "string" && typeof id !== "number") return null;
    return `${typeof id}:${String(id)}`;
  }

  function stableArrayEntries(value) {
    if (!Array.isArray(value)) return null;
    const entries = new Map();
    for (const item of value) {
      const key = stableIdKey(item);
      if (key === null || entries.has(key)) return null;
      entries.set(key, item);
    }
    return entries;
  }

  function formatArrayPath(path, item) {
    const id = item?.id;
    return `${path || "settings"}[id=${JSON.stringify(String(id))}]`;
  }

  function formatIndexPath(path, index) {
    return `${path || "settings"}[${index}]`;
  }

  // 只返回发生变化的字段路径，不返回配置值；路径和递归均有上限，避免异常数据拖垮设置页。
  /**
   * 计算配置发生变化的字段路径。
   * @param {unknown} left 旧值。
   * @param {unknown} right 新值。
   * @param {Object} [options] 深度、节点和路径预算。
   * @returns {BrowserToolboxDiffResult} 差异摘要。
   */
  function diffPaths(
    left,
    right,
    {
      maxPaths = 100,
      maxDepth = 12,
      maxNodes = MAX_COMPARISON_NODES,
    } = {},
  ) {
    const result = { paths: [], truncated: false };
    const pathSet = new Set();
    const seenPairs = new WeakMap();
    const pathLimit = normalizeLimit(maxPaths, 100);
    const depthLimit = normalizeLimit(maxDepth, 12);
    const nodeLimit = normalizeLimit(maxNodes, MAX_COMPARISON_NODES);
    let nodes = 0;

    function addPath(path) {
      const value = path || "settings";
      if (pathSet.has(value)) return;
      if (result.paths.length >= pathLimit) {
        result.truncated = true;
        return;
      }
      pathSet.add(value);
      result.paths.push(value);
    }

    function markPair(leftValue, rightValue) {
      let paired = seenPairs.get(leftValue);
      if (paired?.has(rightValue)) return true;
      if (!paired) {
        paired = new WeakSet();
        seenPairs.set(leftValue, paired);
      }
      paired.add(rightValue);
      return false;
    }

    function walk(leftValue, rightValue, path, depth) {
      if (Object.is(leftValue, rightValue)) return;
      if (++nodes > nodeLimit) {
        result.truncated = true;
        addPath(path);
        return;
      }
      if (depth > depthLimit) {
        result.truncated = true;
        addPath(path);
        return;
      }

      const leftObject = Boolean(leftValue) && typeof leftValue === "object";
      const rightObject = Boolean(rightValue) && typeof rightValue === "object";
      if (!leftObject || !rightObject) {
        addPath(path);
        return;
      }
      if (markPair(leftValue, rightValue)) return;

      if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
        if (!Array.isArray(leftValue) || !Array.isArray(rightValue)) {
          addPath(path);
          return;
        }
        const leftById = stableArrayEntries(leftValue);
        const rightById = stableArrayEntries(rightValue);
        if (leftById && rightById) {
          const leftOrder = [...leftById.keys()];
          const rightOrder = [...rightById.keys()];
          if (
            leftOrder.length !== rightOrder.length ||
            leftOrder.some((key, index) => key !== rightOrder[index])
          ) addPath(path);
          const keys = [...new Set([...leftOrder, ...rightOrder])].sort();
          for (const key of keys) {
            const itemPath = formatArrayPath(
              path,
              leftById.get(key) || rightById.get(key),
            );
            if (!leftById.has(key) || !rightById.has(key)) addPath(itemPath);
            else walk(leftById.get(key), rightById.get(key), itemPath, depth + 1);
          }
          return;
        }
        if (leftValue.length !== rightValue.length) addPath(path);
        const length = Math.max(leftValue.length, rightValue.length);
        for (let index = 0; index < length; index++) {
          walk(
            leftValue[index],
            rightValue[index],
            formatIndexPath(path, index),
            depth + 1,
          );
        }
        return;
      }

      const keys = new Set([...Object.keys(leftValue), ...Object.keys(rightValue)]);
      for (const key of [...keys].sort()) {
        const childPath = path ? `${path}.${key}` : key;
        walk(leftValue[key], rightValue[key], childPath, depth + 1);
      }
    }

    walk(left, right, "", 0);
    return result;
  }

  globalThis.BrowserToolboxValueUtils = Object.freeze({
    MAX_COMPARISON_NODES,
    clone,
    equalValues,
    diffPaths,
  });
})();

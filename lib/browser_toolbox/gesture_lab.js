// 手势实验室的数据层：复用生产环境的方向归一化，提示重复和前缀冲突。
(function () {
  const quantizer = globalThis.BrowserToolboxDirectionQuantizer;

  function normalize(pattern) {
    return quantizer?.normalizePattern?.(pattern) || [];
  }

  function key(pattern) {
    return normalize(pattern).join(">");
  }

  function isPrefix(prefix, value) {
    return prefix.length < value.length && prefix.every((direction, index) => value[index] === direction);
  }

  function analyze(pattern, bindings = [], registry = null) {
    const candidate = normalize(pattern);
    const result = {
      pattern: candidate,
      exact: [],
      prefixes: [],
      longer: [],
      match: null,
      dangerous: false,
    };
    if (candidate.length === 0) return result;
    const candidateKey = candidate.join(">");
    for (const binding of bindings || []) {
      if (!binding || binding.enabled === false) continue;
      const current = normalize(binding.pattern);
      if (current.length === 0) continue;
      if (current.join(">") === candidateKey) result.exact.push(binding);
      else if (isPrefix(candidate, current)) result.prefixes.push(binding);
      else if (isPrefix(current, candidate)) result.longer.push(binding);
    }
    result.match = result.exact[0] || null;
    result.dangerous = result.exact.some((binding) =>
      Boolean(registry?.getCommand?.(binding.commandName)?.dangerous)
    );
    return result;
  }

  globalThis.BrowserToolboxGestureLab = Object.freeze({ normalize, key, analyze });
})();

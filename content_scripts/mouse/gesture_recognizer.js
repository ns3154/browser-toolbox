// 手势只在松开时执行精确匹配，不使用最长前缀自动执行，降低误操作风险。
(function () {
  const quantizer = globalThis.BrowserToolboxDirectionQuantizer;

  function key(pattern, context = "") {
    return `${context}:${quantizer.normalizePattern(pattern).join(">")}`;
  }

  function find(pattern, bindings, context = "") {
    const normalized = quantizer.normalizePattern(pattern);
    const active = (bindings || []).filter((binding) =>
      binding.enabled !== false && (!context || binding.context === context || !binding.context)
    );
    const exact = active.find((binding) =>
      quantizer.normalizePattern(binding.pattern).join(">") === normalized.join(">")
    );
    const isPrefix = active.some((binding) => {
      const candidate = quantizer.normalizePattern(binding.pattern);
      return normalized.length < candidate.length &&
        normalized.every((direction, index) => direction === candidate[index]);
    });
    return { exact: exact || null, isPrefix, pattern: normalized };
  }

  function format(pattern) {
    return quantizer.normalizePattern(pattern).join(">");
  }

  globalThis.BrowserToolboxGestureRecognizer = Object.freeze({ find, format, key });
})();

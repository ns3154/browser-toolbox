// 文本差异工具：使用有界的逐行 LCS，避免异常输入耗尽工具页资源。
(function () {
  const MAX_LINES = 2500;

  function compareSequences(a, b) {
    const matrix = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        matrix[i][j] = a[i] === b[j]
          ? matrix[i + 1][j + 1] + 1
          : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
      }
    }
    const entries = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        entries.push({ type: "same", text: a[i], leftLine: i + 1, rightLine: j + 1 });
        i++;
        j++;
      } else if (j < b.length && (i === a.length || matrix[i][j + 1] >= matrix[i + 1][j])) {
        entries.push({ type: "add", text: b[j], leftLine: null, rightLine: ++j });
      } else {
        entries.push({ type: "remove", text: a[i], leftLine: ++i, rightLine: null });
      }
    }
    return entries;
  }

  function run(left, right) {
    const lines = (value) => value === "" ? [] : String(value).split(/\r\n|\r|\n/);
    const a = lines(left);
    const b = lines(right);
    if (a.length > MAX_LINES || b.length > MAX_LINES) {
      throw Object.assign(new Error(`每侧最多支持 ${MAX_LINES} 行文本对比。`), {
        messageKey: "toolDiffLineLimit",
        max: MAX_LINES,
      });
    }
    const entries = compareSequences(a, b);
    const prefix = { same: "  ", add: "+ ", remove: "- " };
    return {
      output: entries.map(({ type, text }) => prefix[type] + text).join("\n"),
      entries,
      metadata: { leftLines: a.length, rightLines: b.length },
    };
  }

  globalThis.BrowserToolboxDiffTool = Object.freeze({ run, compareSequences, MAX_LINES });
})();

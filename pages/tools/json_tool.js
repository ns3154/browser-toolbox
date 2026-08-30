// JSON 工具：高级操作只作用于本地输入，不改变共享文档格式化器的原始快照。
(function () {
  const formatter = globalThis.BrowserToolboxDocumentFormatters;

  function expandEscapedNode(node, depth = 0) {
    if (depth > 8) return node;
    if (node.kind === "string") {
      let value;
      try {
        value = JSON.parse(node.raw);
      } catch (_) {
        return node;
      }
      if (typeof value !== "string" || !/^[\[{]/.test(value.trim())) return node;
      try {
        return expandEscapedNode(formatter.parseJsonDocument(value).root, depth + 1);
      } catch (_) {
        return node;
      }
    }
    if (node.kind === "array") {
      return { ...node, items: node.items.map((item) => expandEscapedNode(item, depth + 1)) };
    }
    if (node.kind === "object") {
      return {
        ...node,
        entries: node.entries.map((entry) => ({
          ...entry,
          value: expandEscapedNode(entry.value, depth + 1),
        })),
      };
    }
    return node;
  }

  function run(input, options = {}) {
    const source = String(input);
    if (options.operation === "validate") {
      const parsed = formatter.parseJsonDocument(source);
      return {
        output: source,
        metadata: { ...parsed.metadata, operation: "validate", valid: true },
        root: parsed.root,
      };
    }
    const sortOrder = options.operation === "sort"
      ? (options.sortOrder === "descending" ? "descending" : "ascending")
      : options.sortOrder || (options.sortKeys ? "ascending" : "original");
    const result = formatter.formatJsonDocument(source, {
      indentSize: options.indentSize,
      indent: options.indent,
      sortKeys: options.sortKeys === true,
      sortOrder,
      collapseDepth: options.collapseDepth,
      compact: options.compact === true || options.operation === "compact",
    });
    const root = options.expandEscaped ? expandEscapedNode(result.root) : result.root;
    const formatted = options.expandEscaped
      ? formatter.renderJsonNode(root, 0, {
        indent: options.indent === "\t" ? "\t" : " ".repeat(
          Math.min(8, Math.max(0, Number(options.indentSize ?? 2))),
        ),
        sortOrder,
        collapseDepth: options.collapseDepth,
        compact: options.compact === true || options.operation === "compact",
      })
      : result.formatted;
    return {
      output: formatted,
      metadata: { ...result.metadata, operation: options.operation || "format", expandedEscaped: options.expandEscaped === true },
      root,
    };
  }

  function repair(input) {
    return formatter.repairMojibake(input);
  }

  globalThis.BrowserToolboxJsonTool = Object.freeze({ run, repair });
})();

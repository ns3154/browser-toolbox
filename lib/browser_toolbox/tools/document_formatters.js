// 原始文档格式化器：只处理明确识别的顶层文本文档，所有展示结果由调用方以文本节点渲染。
(function () {
  const AUTO_MAX_BYTES = 5 * 1024 * 1024;
  const CONFIRM_MAX_BYTES = 10 * 1024 * 1024;
  const MAX_JSON_DEPTH = 96;
  const MAX_JSON_NODES = 200000;
  const MAX_JSON_TOKEN_BYTES = 2 * 1024 * 1024;
  const MAX_JSON_STRING_BYTES = 2 * 1024 * 1024;
  const MAX_MARKUP_DEPTH = 96;
  const MAX_CODE_DEPTH = 96;
  const DEFAULT_TIME_BUDGET_MS = 1200;
  const MIME_TYPES = Object.freeze({
    "application/json": "json",
    "text/json": "json",
    "application/xml": "xml",
    "text/xml": "xml",
    "text/css": "css",
    "text/javascript": "javascript",
    "application/javascript": "javascript",
    "application/x-javascript": "javascript",
    "application/ecmascript": "javascript",
    "text/ecmascript": "javascript",
    "application/x-ecmascript": "javascript",
    "text/x-java-source": "java",
    "text/x-java": "java",
  });
  const EXTENSIONS = Object.freeze({
    json: "json",
    xml: "xml",
    xhtml: "xml",
    css: "css",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    java: "java",
  });

  class FormatterBudgetError extends Error {
    constructor(message) {
      super(message);
      this.name = "FormatterBudgetError";
    }
  }

  function byteLength(value) {
    return new TextEncoder().encode(String(value)).byteLength;
  }

  function createBudget({ timeBudgetMs = DEFAULT_TIME_BUDGET_MS, maxNodes = MAX_JSON_NODES } = {}) {
    const started = globalThis.performance?.now?.() ?? Date.now();
    const deadline = started + timeBudgetMs;
    let nodes = 0;
    return {
      check() {
        if ((globalThis.performance?.now?.() ?? Date.now()) > deadline) {
          throw new FormatterBudgetError("格式化超过时间预算。");
        }
      },
      node() {
        nodes++;
        if (nodes > maxNodes) throw new FormatterBudgetError("格式化节点数超过预算。");
        if ((nodes & 1023) === 0) this.check();
      },
      get nodes() {
        return nodes;
      },
    };
  }

  function extensionFromUrl(url) {
    try {
      const pathname = new URL(url || "", "browser-toolbox://local/").pathname;
      const match = pathname.match(/\.([a-z0-9]+)$/i);
      return match?.[1]?.toLowerCase() || "";
    } catch (_) {
      return "";
    }
  }

  function detectDocument({ contentType = "", url = "", source } = {}) {
    const mime = String(contentType).split(";", 1)[0].trim().toLowerCase();
    if (mime === "text/html" || mime === "application/xhtml+xml") return null;
    if (MIME_TYPES[mime]) return MIME_TYPES[mime];
    if (/^application\/[^;]+\+json$/.test(mime)) return "json";
    if (/^application\/[^;]+\+xml$/.test(mime)) return "xml";
    const extension = extensionFromUrl(url);
    if (!EXTENSIONS[extension]) return null;
    if (mime && mime !== "text/plain") {
      return null;
    }
    const kind = EXTENSIONS[extension];
    if (source == null) return kind;
    try {
      if (kind === "json") parseJsonDocument(source);
      else if (kind === "xml") formatXmlDocument(source);
      else validateCodeSource(source, kind);
      return kind;
    } catch (_) {
      return null;
    }
  }

  function assertStringSource(source) {
    if (typeof source !== "string") throw new Error("原始文档必须是字符串。");
    return source;
  }

  function readJsonString(source, start, budget) {
    let index = start + 1;
    let escaped = false;
    while (index < source.length) {
      budget.check();
      if (index - start > MAX_JSON_STRING_BYTES) throw new FormatterBudgetError("JSON 字符串超过预算。");
      const char = source[index];
      if (char === "\n" || char === "\r") throw new Error("JSON 字符串不能包含未转义换行。");
      if (escaped) {
        escaped = false;
        index++;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        index++;
        continue;
      }
      if (char === '"') return index + 1;
      index++;
    }
    throw new Error("JSON 字符串未闭合。");
  }

  function parseJsonDocument(source, options = {}) {
    source = assertStringSource(source);
    if (byteLength(source) > MAX_JSON_TOKEN_BYTES) {
      throw new FormatterBudgetError("JSON token 总大小超过预算。");
    }
    const started = globalThis.performance?.now?.() ?? Date.now();
    const budget = createBudget(options);
    let index = 0;
    let stringCount = 0;
    let numberCount = 0;
    let keyCount = 0;
    let duplicateKeyCount = 0;
    let booleanCount = 0;
    let nullCount = 0;
    let unsafeNumberCount = 0;
    let stringCharacters = 0;
    let objectCount = 0;
    let arrayCount = 0;
    let maxDepth = 0;
    const duplicateKeyPositions = [];

    const skipWhitespace = () => {
      while (index < source.length && " \t\r\n".includes(source[index])) index++;
    };
    const takeString = () => {
      const start = index;
      index = readJsonString(source, index, budget);
      const raw = source.slice(start, index);
      if (byteLength(raw) > MAX_JSON_STRING_BYTES) {
        throw new FormatterBudgetError("JSON 字符串超过预算。");
      }
      stringCount++;
      try {
        stringCharacters += Array.from(JSON.parse(raw)).length;
      } catch (_) {
        throw new Error("JSON 字符串转义无效。");
      }
      return { kind: "string", raw };
    };
    const takeNumber = () => {
      const start = index;
      const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
      numberPattern.lastIndex = index;
      const match = numberPattern.exec(source);
      if (!match) throw new Error("JSON 数字无效。");
      index += match[0].length;
      numberCount++;
      if (
        /^-?(?:0|[1-9]\d*)$/.test(match[0]) &&
        !Number.isSafeInteger(Number(match[0]))
      ) unsafeNumberCount++;
      return { kind: "number", raw: match[0] };
    };
    const takeLiteral = (literal) => {
      if (!source.startsWith(literal, index)) throw new Error("JSON 字面量无效。");
      index += literal.length;
      if (literal === "true" || literal === "false") booleanCount++;
      if (literal === "null") nullCount++;
      return { kind: "literal", raw: literal };
    };

    function parseValue(depth) {
      budget.node();
      budget.check();
      if (depth > (options.maxDepth ?? MAX_JSON_DEPTH)) {
        throw new FormatterBudgetError("JSON 嵌套深度超过预算。");
      }
      maxDepth = Math.max(maxDepth, depth);
      skipWhitespace();
      const char = source[index];
      if (char === '"') return takeString();
      if (char === "-") return takeNumber();
      if (char >= "0" && char <= "9") return takeNumber();
      if (char === "t") return takeLiteral("true");
      if (char === "f") return takeLiteral("false");
      if (char === "n") return takeLiteral("null");
      if (char === "[") return parseArray(depth);
      if (char === "{") return parseObject(depth);
      throw new Error("JSON 值无效。");
    }

    function parseArray(depth) {
      arrayCount++;
      index++;
      const items = [];
      skipWhitespace();
      if (source[index] === "]") {
        index++;
        return { kind: "array", items };
      }
      while (index < source.length) {
        items.push(parseValue(depth + 1));
        skipWhitespace();
        if (source[index] === "]") {
          index++;
          return { kind: "array", items };
        }
        if (source[index] !== ",") throw new Error("JSON 数组缺少逗号。");
        index++;
      }
      throw new Error("JSON 数组未闭合。");
    }

    function parseObject(depth) {
      objectCount++;
      index++;
      const entries = [];
      const keys = new Set();
      skipWhitespace();
      if (source[index] === "}") {
        index++;
        return { kind: "object", entries };
      }
      while (index < source.length) {
        skipWhitespace();
        if (source[index] !== '"') throw new Error("JSON 对象键必须是字符串。");
        const keyOffset = index;
        const key = takeString();
        let keyValue;
        try {
          keyValue = JSON.parse(key.raw);
        } catch (_) {
          throw new Error("JSON 对象键无效。");
        }
        keyCount++;
        if (keys.has(keyValue)) {
          duplicateKeyCount++;
          if (duplicateKeyPositions.length < 64) {
            duplicateKeyPositions.push({ key: keyValue, offset: keyOffset });
          }
        }
        keys.add(keyValue);
        skipWhitespace();
        if (source[index] !== ":") throw new Error("JSON 对象键值之间缺少冒号。");
        index++;
        const value = parseValue(depth + 1);
        entries.push({ key, keyValue, value });
        skipWhitespace();
        if (source[index] === "}") {
          index++;
          return { kind: "object", entries };
        }
        if (source[index] !== ",") throw new Error("JSON 对象缺少逗号。");
        index++;
      }
      throw new Error("JSON 对象未闭合。");
    }

    let root;
    try {
      root = parseValue(0);
      skipWhitespace();
      if (index !== source.length) throw new Error("JSON 文档包含多余内容。");
    } catch (error) {
      const line = source.slice(0, index).split("\n").length;
      const lastLineBreak = source.lastIndexOf("\n", Math.max(0, index - 1));
      const column = index - lastLineBreak;
      const nearby = source.slice(Math.max(0, index - 24), Math.min(source.length, index + 24))
        .replace(/[\r\n]+/g, " ");
      throw new Error(`${error.message}（第 ${line} 行，第 ${column} 列，附近：${nearby}）`);
    }
    return {
      root,
      metadata: {
        bytes: byteLength(source),
        nodes: budget.nodes,
        strings: stringCount,
        numbers: numberCount,
        booleans: booleanCount,
        nulls: nullCount,
        unsafeNumbers: unsafeNumberCount,
        stringCharacters,
        characters: Array.from(source).length,
        objects: objectCount,
        arrays: arrayCount,
        keys: keyCount,
        duplicateKeys: duplicateKeyCount,
        duplicateKeyPositions,
        maxDepth,
        rootType: root.kind,
        parseMs: (globalThis.performance?.now?.() ?? Date.now()) - started,
      },
    };
  }

  function compareCodePoints(left, right) {
    const a = Array.from(left, (char) => char.codePointAt(0));
    const b = Array.from(right, (char) => char.codePointAt(0));
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
  }

  function indentText(indent, level) {
    return indent.repeat(level);
  }

  function renderJsonNode(node, level, options) {
    const indent = options.indent;
    if (
      options.collapseDepth != null && level >= options.collapseDepth &&
      ((node.kind === "object" && node.entries.length > 0) ||
        (node.kind === "array" && node.items.length > 0))
    ) return node.kind === "object" ? "{…}" : "[…]";
    if (node.kind === "object") {
      if (node.entries.length === 0) return "{}";
      const entries = options.sortOrder && options.sortOrder !== "original"
        ? node.entries.map((entry, index) => ({ entry, index })).sort((a, b) =>
          (options.sortOrder === "descending" ? -1 : 1) * compareCodePoints(a.entry.keyValue, b.entry.keyValue) ||
          a.index - b.index
        ).map(({ entry }) => entry)
        : node.entries;
      if (options.compact) {
        return `{${entries.map((entry) => `${entry.key.raw}:${renderJsonNode(entry.value, level + 1, options)}`).join(",")}}`;
      }
      return [
        "{",
        ...entries.map((entry, index) =>
          `${indentText(indent, level + 1)}${entry.key.raw}: ${
            renderJsonNode(entry.value, level + 1, options)
          }${index === entries.length - 1 ? "" : ","}`
        ),
        `${indentText(indent, level)}}`,
      ].join("\n");
    }
    if (node.kind === "array") {
      if (node.items.length === 0) return "[]";
      if (options.compact) {
        return `[${node.items.map((item) => renderJsonNode(item, level + 1, options)).join(",")}]`;
      }
      return [
        "[",
        ...node.items.map((item, index) =>
          `${indentText(indent, level + 1)}${renderJsonNode(item, level + 1, options)}${
            index === node.items.length - 1 ? "" : ","
          }`
        ),
        `${indentText(indent, level)}]`,
      ].join("\n");
    }
    return node.raw;
  }

  function formatJsonDocument(source, options = {}) {
    const started = globalThis.performance?.now?.() ?? Date.now();
    const parsed = parseJsonDocument(source, options);
    const indent = options.indent === "\t" ? "\t" : " ".repeat(
      Math.min(8, Math.max(0, Number(options.indentSize ?? 2))),
    );
    const sortOrder = options.sortOrder || (options.sortKeys ? "ascending" : "original");
    return {
      kind: "json",
      formatted: renderJsonNode(parsed.root, 0, {
        indent,
        sortOrder,
        collapseDepth: options.collapseDepth,
        compact: options.compact === true,
      }),
      metadata: {
        ...parsed.metadata,
        formatMs: (globalThis.performance?.now?.() ?? Date.now()) - started,
        sortOrder,
        collapsed: options.collapseDepth != null,
      },
      root: parsed.root,
    };
  }

  function repairMojibakeText(source) {
    const suspicious = /[ÃÂâðæåç]/;
    if (!suspicious.test(source) || Array.from(source).some((char) => char.codePointAt(0) > 255)) {
      return { changed: false, value: source };
    }
    const bytes = Uint8Array.from(Array.from(source), (char) => char.charCodeAt(0));
    try {
      const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const roundTrip = new TextEncoder().encode(value);
      const reversible = roundTrip.length === bytes.length && roundTrip.every((byte, index) => byte === bytes[index]);
      return value !== source && reversible && !suspicious.test(value)
        ? {
          changed: true,
          value,
          count: Array.from(source).filter((char) => /[ÃÂâðæåç]/.test(char)).length,
          previewBefore: source.slice(0, 240),
          previewAfter: value.slice(0, 240),
        }
        : { changed: false, value: source };
    } catch (_) {
      return { changed: false, value: source };
    }
  }

  function repairMojibake(source) {
    let parsed;
    try {
      parsed = parseJsonDocument(source);
    } catch (_) {
      return { changed: false, value: source };
    }
    let count = 0;
    function repairNode(node) {
      if (node.kind === "string") {
        let value;
        try {
          value = JSON.parse(node.raw);
        } catch (_) {
          return node;
        }
        const repaired = repairMojibakeText(value);
        if (!repaired.changed) return node;
        count++;
        return { ...node, raw: JSON.stringify(repaired.value) };
      }
      if (node.kind === "array") {
        return { ...node, items: node.items.map(repairNode) };
      }
      if (node.kind === "object") {
        return {
          ...node,
          entries: node.entries.map((entry) => {
            let nextKey = entry.key;
            const repaired = repairMojibakeText(entry.keyValue);
            if (repaired.changed) {
              count++;
              nextKey = { ...entry.key, raw: JSON.stringify(repaired.value) };
            }
            return {
              ...entry,
              key: nextKey,
              keyValue: repaired.changed ? repaired.value : entry.keyValue,
              value: repairNode(entry.value),
            };
          }),
        };
      }
      return node;
    }
    const root = repairNode(parsed.root);
    if (count === 0) return { changed: false, value: source };
    const value = renderJsonNode(root, 0, { indent: "", sortOrder: "original", compact: true });
    return {
      changed: true,
      value,
      count,
      previewBefore: String(source).slice(0, 240),
      previewAfter: value.slice(0, 240),
    };
  }

  function scanMarkup(source, budget) {
    const tokens = [];
    let index = 0;
    function findSequence(start, sequence) {
      for (let cursor = start; cursor <= source.length - sequence.length; cursor++) {
        if ((cursor & 1023) === 0) budget.check();
        if (source.startsWith(sequence, cursor)) return cursor;
      }
      return -1;
    }
    function findMarkupEnd(start) {
      let quote = "";
      let subsetDepth = 0;
      for (let cursor = start + 1; cursor < source.length; cursor++) {
        if ((cursor & 1023) === 0) budget.check();
        const char = source[cursor];
        if (quote) {
          if (char === quote) quote = "";
          continue;
        }
        if (char === '"' || char === "'") {
          quote = char;
          continue;
        }
        if (source.slice(start, start + 9).toUpperCase() === "<!DOCTYPE") {
          if (char === "[") subsetDepth++;
          else if (char === "]") subsetDepth = Math.max(0, subsetDepth - 1);
        }
        if (char === ">" && subsetDepth === 0) return cursor + 1;
      }
      return -1;
    }
    while (index < source.length) {
      budget.check();
      const start = index;
      if (source.startsWith("<!--", index)) {
        const end = findSequence(index + 4, "-->");
        if (end < 0) throw new Error("XML 注释未闭合。");
        index = end + 3;
        tokens.push({ type: "comment", raw: source.slice(start, index) });
        continue;
      }
      if (source.startsWith("<![CDATA[", index)) {
        const end = findSequence(index + 9, "]]>");
        if (end < 0) throw new Error("XML CDATA 未闭合。");
        index = end + 3;
        tokens.push({ type: "cdata", raw: source.slice(start, index) });
        continue;
      }
      if (source[index] === "<") {
        index = findMarkupEnd(index);
        if (index < 0) throw new Error("XML 标签未闭合。");
        const raw = source.slice(start, index);
        const closing = /^<\s*\/\s*([\w:.-]+)/.exec(raw);
        const opening = /^<\s*([\w:.-]+)/.exec(raw);
        tokens.push({
          type: closing ? "close" : opening ? "open" : "directive",
          name: (closing || opening)?.[1] || "",
          selfClosing: /\/\s*>$/.test(raw),
          raw,
        });
        continue;
      }
      while (index < source.length && source[index] !== "<") index++;
      tokens.push({ type: "text", raw: source.slice(start, index) });
    }
    return tokens;
  }

  function formatXmlDocument(source, options = {}) {
    const budget = createBudget(options);
    const tokens = scanMarkup(assertStringSource(source), budget);
    const lines = [];
    const stack = [];
    const indent = " ".repeat(Math.min(8, Math.max(0, Number(options.indentSize ?? 2))));
    const maxAllowedDepth = options.maxDepth ?? MAX_MARKUP_DEPTH;
    let rootSeen = false;
    let rootClosed = false;
    let maxDepth = 0;
    const appendInline = (value) => {
      if (lines.length === 0) lines.push(value);
      else lines[lines.length - 1] += value;
    };
    for (const token of tokens) {
      budget.node();
      if (token.type === "close") {
        const frame = stack.at(-1);
        if (!frame || frame.name !== token.name) {
          throw new Error("XML 标签嵌套不匹配。");
        }
        stack.pop();
        if (frame.lineIndex === lines.length - 1 && !frame.hasElementChild) {
          lines[frame.lineIndex] += token.raw.trim();
        } else {
          lines.push(`${indent.repeat(stack.length)}${token.raw.trim()}`);
        }
        if (stack.length === 0) rootClosed = true;
      } else if (token.type === "open") {
        if (stack.length === 0) {
          if (rootClosed) throw new Error("XML 文档不能包含多个根元素。");
          rootSeen = true;
        }
        lines.push(`${indent.repeat(stack.length)}${token.raw.trim()}`);
        if (!token.selfClosing) {
          if (stack.length > 0) stack.at(-1).hasElementChild = true;
          stack.push({ name: token.name, lineIndex: lines.length - 1, hasElementChild: false });
          if (stack.length > maxAllowedDepth) {
            throw new FormatterBudgetError("XML 嵌套深度超过预算。");
          }
          maxDepth = Math.max(maxDepth, stack.length);
        } else {
          maxDepth = Math.max(maxDepth, stack.length + 1);
        }
        if (token.selfClosing && stack.length + 1 > maxAllowedDepth) {
          throw new FormatterBudgetError("XML 嵌套深度超过预算。");
        }
        if (token.selfClosing && stack.length === 0) {
          rootClosed = true;
        } else if (token.selfClosing) {
          stack.at(-1).hasElementChild = true;
        }
      } else if (token.type === "text") {
        const text = token.raw.trim();
        if (text && stack.length === 0) throw new Error("XML 根元素外不能有文本。");
        // 非空文本必须原样保留，不能把格式化缩进写进 XML 文本节点。
        if (text) appendInline(token.raw);
      } else if (token.type === "cdata" && stack.length === 0) {
        throw new Error("XML CDATA 必须位于元素内部。");
      } else if (token.type === "cdata") {
        appendInline(token.raw);
      } else if (token.type === "comment" && stack.length === 0 && rootClosed) {
        lines.push(`${indent.repeat(stack.length)}${token.raw.trim()}`);
      } else {
        lines.push(`${indent.repeat(stack.length)}${token.raw.trim()}`);
      }
    }
    if (stack.length > 0) throw new Error("XML 标签未闭合。");
    if (!rootSeen) throw new Error("XML 文档缺少根元素。");
    return {
      kind: "xml",
      formatted: lines.join("\n"),
      metadata: { bytes: byteLength(source), nodes: tokens.length, maxDepth },
    };
  }

  function codeLineIndent(source, options = {}) {
    const budget = createBudget(options);
    const indent = " ".repeat(Math.min(8, Math.max(0, Number(options.indentSize ?? 2))));
    const lines = String(source).split(/\r?\n/);
    const output = [];
    let depth = 0;
    let blockComment = false;
    let quote = "";
    for (const original of lines) {
      budget.check();
      let line = original.trim();
      if (!line) {
        output.push("");
        continue;
      }
      let leadingClose = 0;
      let inString = quote;
      for (let index = 0; index < line.length; index++) {
        const char = line[index];
        const next = line[index + 1];
        if (blockComment) {
          if (char === "*" && next === "/") {
            blockComment = false;
            index++;
          }
          continue;
        }
        if (inString) {
          if (char === "\\") index++;
          else if (char === inString) inString = "";
          continue;
        }
        if (char === "/" && next === "*") {
          blockComment = true;
          index++;
          continue;
        }
        if (char === '"' || char === "'" || (char === "`" && options.language === "javascript")) {
          inString = char;
          continue;
        }
        if (char === "}" && index === leadingClose) leadingClose++;
        else break;
      }
      depth = Math.max(0, depth - leadingClose);
      output.push(`${indent.repeat(depth)}${line}`);
      let lineDepth = 0;
      blockComment = blockComment || Boolean(inString);
      quote = inString;
      inString = "";
      for (let index = 0; index < line.length; index++) {
        const char = line[index];
        const next = line[index + 1];
        if (blockComment) {
          if (char === "*" && next === "/") {
            blockComment = false;
            index++;
          }
          continue;
        }
        if (quote) {
          if (char === "\\") index++;
          else if (char === quote) quote = "";
          continue;
        }
        if (char === "/" && next === "/" && options.language !== "css") break;
        if (char === "/" && next === "*") {
          blockComment = true;
          index++;
          continue;
        }
        if (char === '"' || char === "'" || (char === "`" && options.language === "javascript")) {
          quote = char;
          continue;
        }
        if (char === "{") lineDepth++;
        if (char === "}") lineDepth--;
      }
      depth = Math.max(0, depth + lineDepth);
    }
    return output.join("\n");
  }

  function formatCodeDocument(source, kind, options = {}) {
    const text = assertStringSource(source);
    const budget = createBudget(options);
    const scan = scanCodeStructure(text, kind, budget);
    if (
      kind === "java" && text.trim() &&
      !/\b(?:package|import|class|interface|enum|record|public|private|protected|final|static|void)\b/.test(text)
    ) throw new Error("未识别为 Java 源码。");
    if (kind === "css" && text.trim() && !/[{}]|@(?:charset|import|media|supports|layer)\b|\/\*/.test(text)) {
      throw new Error("未识别为 CSS 源码。");
    }
    const formatted = scan.complexLiteral
      ? text
      : codeLineIndent(text, {
        ...options,
        timeBudgetMs: options.timeBudgetMs,
        language: kind === "javascript" ? "javascript" : kind,
      });
    return {
      kind,
      formatted,
      metadata: {
        bytes: byteLength(text),
        lines: text.split(/\r?\n/).length,
        nodes: scan.tokens,
        conservative: scan.complexLiteral,
      },
    };
  }

  function scanCodeStructure(text, kind, budget = null) {
    const stack = [];
    let quote = "";
    let blockComment = false;
    let escaped = false;
    let regexCharacterClass = false;
    let complexLiteral = false;
    let literalLength = 0;
    let coarseTokenCount = 0;

    if (kind === "css" && /\burl\s*\(\s*["']?data:/i.test(text)) {
      // data URI 可能包含源码样式的括号和大括号；保守地保留原文，避免改变 CSS 语义。
      complexLiteral = true;
    }

    function looksLikeRegex(start) {
      let cursor = start - 1;
      while (cursor >= 0 && /\s/.test(text[cursor])) cursor--;
      if (cursor < 0) return true;
      const previous = text[cursor];
      if ("=([{,:;!?&|+-*%^~<>".includes(previous)) return true;
      const word = text.slice(Math.max(0, cursor - 12), cursor + 1).match(/[A-Za-z_$][\w$]*$/)?.[0];
      return [
        "return",
        "throw",
        "case",
        "delete",
        "void",
        "typeof",
        "new",
        "in",
        "instanceof",
        "yield",
        "await",
        "else",
        "do",
      ].includes(word);
    }

    for (let index = 0; index < text.length; index++) {
      if (budget && (index & 63) === 0) {
        budget.check();
        budget.node();
        coarseTokenCount++;
      }
      const char = text[index];
      const next = text[index + 1];
      if (blockComment) {
        literalLength++;
        if (literalLength > MAX_JSON_STRING_BYTES) {
          throw new FormatterBudgetError("源码注释或字符串超过预算。");
        }
        if (char === "*" && next === "/") {
          blockComment = false;
          literalLength = 0;
          index++;
        }
        continue;
      }
      if (quote === "regex") {
        literalLength++;
        if (literalLength > MAX_JSON_STRING_BYTES) {
          throw new FormatterBudgetError("源码正则或字符串超过预算。");
        }
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "[") regexCharacterClass = true;
        else if (char === "]") regexCharacterClass = false;
        else if (char === "/" && !regexCharacterClass) {
          quote = "";
          literalLength = 0;
          while (/[A-Za-z]/.test(text[index + 1] || "")) index++;
        }
        continue;
      }
      if (quote) {
        literalLength++;
        if (literalLength > MAX_JSON_STRING_BYTES) {
          throw new FormatterBudgetError("源码字符串超过预算。");
        }
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) {
          quote = "";
          literalLength = 0;
        }
        continue;
      }
      if (kind === "java" && text.startsWith('"""', index)) {
        const end = text.indexOf('"""', index + 3);
        if (end < 0) throw new Error("Java 文本块未闭合。");
        if (end - index > MAX_JSON_STRING_BYTES) {
          throw new FormatterBudgetError("Java 文本块超过预算。");
        }
        index = end + 2;
        complexLiteral = true;
        continue;
      }
      if (char === "/" && next === "*") {
        blockComment = true;
        literalLength = 0;
        index++;
        continue;
      }
      if ((kind === "javascript" || kind === "java") && char === "/" && next === "/") {
        const lineEnd = text.indexOf("\n", index + 2);
        if ((lineEnd < 0 ? text.length : lineEnd) - index > MAX_JSON_STRING_BYTES) {
          throw new FormatterBudgetError("源码注释超过预算。");
        }
        index = lineEnd < 0 ? text.length : lineEnd - 1;
        continue;
      }
      if (kind === "javascript" && char === "/" && next !== "/" && next !== "*" && looksLikeRegex(index)) {
        quote = "regex";
        regexCharacterClass = false;
        literalLength = 0;
        complexLiteral = true;
        continue;
      }
      if (char === '"' || char === "'" || (kind === "javascript" && char === "`")) {
        quote = char;
        escaped = false;
        literalLength = 0;
        if (kind === "javascript" && char === "`") complexLiteral = true;
        continue;
      }
      if ("{[(".includes(char)) {
        stack.push(char);
        if (stack.length > MAX_CODE_DEPTH) {
          throw new FormatterBudgetError("源码嵌套深度超过预算。");
        }
      }
      if ("}])".includes(char)) {
        const expected = { "}": "{", "]": "[", ")": "(" }[char];
        if (stack.pop() !== expected) throw new Error("源码括号结构无效。");
      }
    }
    if (quote || blockComment || stack.length > 0) throw new Error("源码词法结构未闭合。");
    return { complexLiteral, tokens: coarseTokenCount };
  }

  function validateCodeSource(source, kind) {
    const text = assertStringSource(source);
    scanCodeStructure(text, kind, createBudget());
    if (
      kind === "java" && text.trim() &&
      !/\b(?:package|import|class|interface|enum|record|public|private|protected|final|static|void)\b/.test(text)
    ) throw new Error("未识别为 Java 源码。");
    if (kind === "css" && text.trim() && !/[{}]|@(?:charset|import|media|supports|layer)\b|\/\*/.test(text)) {
      throw new Error("未识别为 CSS 源码。");
    }
    return true;
  }

  const ADAPTERS = Object.freeze({
    json: Object.freeze({
      id: "json",
      detect: (context) => detectDocument(context) === "json",
      parse: parseJsonDocument,
      format: formatJsonDocument,
      getCapabilities: () => ["format", "sort", "repairMojibake", "metadata", "collapse"],
      dispose() {},
    }),
    xml: Object.freeze({
      id: "xml",
      detect: (context) => detectDocument(context) === "xml",
      format: formatXmlDocument,
      getCapabilities: () => ["format", "metadata"],
      dispose() {},
    }),
    css: Object.freeze({
      id: "css",
      detect: (context) => detectDocument(context) === "css",
      format: (source, options) => formatCodeDocument(source, "css", options),
      getCapabilities: () => ["format", "metadata"],
      dispose() {},
    }),
    javascript: Object.freeze({
      id: "javascript",
      detect: (context) => detectDocument(context) === "javascript",
      format: (source, options) => formatCodeDocument(source, "javascript", options),
      getCapabilities: () => ["format", "metadata"],
      dispose() {},
    }),
    java: Object.freeze({
      id: "java",
      detect: (context) => detectDocument(context) === "java",
      format: (source, options) => formatCodeDocument(source, "java", options),
      getCapabilities: () => ["format", "metadata"],
      dispose() {},
    }),
  });

  function adapterFor(kind) {
    return ADAPTERS[kind] || null;
  }

  function formatDocument(source, kind, options = {}) {
    const adapter = adapterFor(kind);
    if (!adapter) throw new Error("不支持的文档格式。");
    const bytes = byteLength(source);
    if (bytes > CONFIRM_MAX_BYTES) {
      return {
        kind,
        formatted: source,
        metadata: { bytes },
        skipped: true,
        reason: "too-large",
      };
    }
    return adapter.format(source, options);
  }

  globalThis.BrowserToolboxDocumentFormatters = Object.freeze({
    AUTO_MAX_BYTES,
    CONFIRM_MAX_BYTES,
    MAX_JSON_DEPTH,
    MAX_JSON_NODES,
    MAX_JSON_TOKEN_BYTES,
    MAX_JSON_STRING_BYTES,
    MAX_MARKUP_DEPTH,
    MAX_CODE_DEPTH,
    DEFAULT_TIME_BUDGET_MS,
    MIME_TYPES,
    EXTENSIONS,
    FormatterBudgetError,
    byteLength,
    createBudget,
    detectDocument,
    parseJsonDocument,
    formatJsonDocument,
    renderJsonNode,
    compareCodePoints,
    repairMojibake,
    formatXmlDocument,
    formatCodeDocument,
    scanCodeStructure,
    validateCodeSource,
    adapterFor,
    formatDocument,
    ADAPTERS,
  });
})();

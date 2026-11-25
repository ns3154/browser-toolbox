// CSV/TSV 工具：按 RFC 风格处理引号，输出只使用文本节点的安全 Markdown/CSV。
(function () {
  const MAX_ROWS = 100000;
  const MAX_CELLS = 500000;
  const MAX_OUTPUT_BYTES = globalThis.BrowserToolboxToolRuntime?.MAX_RENDER_BYTES ?? 10 * 1024 * 1024;
  const textEncoder = new TextEncoder();
  const message = (key, fallback) => globalThis.BrowserToolboxI18n?.message?.(key) || fallback;
  const inputError = (messageKey, text) => Object.assign(new Error(text), { messageKey });
  const tableLimitError = () => inputError("toolTableLimit", "表格行数或单元格数量超过本地预算。");
  const outputLimitError = () => inputError("toolCodecOutputTooLarge", "转换结果超过 10 MiB，请缩小输入后重试。");

  function parseDelimited(source, delimiter) {
    source = String(source).replace(/^\uFEFF/, "");
    if (delimiter !== "," && delimiter !== "\t") throw new Error("表格分隔符无效。");
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    let afterQuote = false;
    let cellCount = 0;
    const pushCell = () => {
      if (cellCount >= MAX_CELLS) throw tableLimitError();
      row.push(value);
      value = "";
      afterQuote = false;
      cellCount++;
    };
    const pushRow = () => {
      if (rows.length >= MAX_ROWS) throw tableLimitError();
      rows.push(row);
      row = [];
    };
    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
          value += '"';
          index++;
        } else if (char === '"') {
          quoted = false;
          afterQuote = true;
        } else {
          value += char;
        }
      } else if (char === delimiter) {
        pushCell();
      } else if (char === "\n" || char === "\r") {
        pushCell();
        if (char === "\r" && source[index + 1] === "\n") index++;
        pushRow();
      } else if (afterQuote) {
        throw inputError("toolTableAfterQuote", "表格引号后必须紧跟分隔符或换行。");
      } else if (char === '"') {
        if (value.length > 0) {
          throw inputError("toolTableUnexpectedQuote", "未加引号的表格字段中不能出现双引号。");
        }
        quoted = true;
      } else {
        value += char;
      }
    }
    if (quoted) throw inputError("toolTableUnclosedQuote", "表格输入的引号未闭合。");
    if (afterQuote || row.length > 0 || value !== "" || rows.length === 0) {
      pushCell();
      pushRow();
    }
    return rows;
  }

  function toDelimited(rows, delimiter) {
    return rows.map((row, rowIndex) => row.map((text, columnIndex) => {
      // 引号区分空记录与文件末尾的换行，也保护首字段本身含有的 BOM 字符。
      const quote = /["\n\r]/.test(text) || text.includes(delimiter) ||
        (row.length === 1 && text === "") ||
        (rowIndex === 0 && columnIndex === 0 && text.startsWith("\uFEFF"));
      return quote ? `"${text.replaceAll('"', '""')}"` : text;
    }).join(delimiter)).join("\n");
  }

  function normalizeRows(rows) {
    let width = 1;
    for (const row of rows) width = Math.max(width, row.length);
    // 行宽不同时，补齐后的单元格可能远多于实际解析到的内容。
    if (rows.length * width > MAX_CELLS) throw tableLimitError();
    return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
  }

  function uniqueNames(values) {
    const used = new Set();
    const nextSuffix = new Map();
    return values.map((value, index) => {
      const base = String(value) || `column_${index + 1}`;
      let name = base;
      let suffix = nextSuffix.get(base) ?? 2;
      while (used.has(name)) name = `${base}_${suffix++}`;
      if (name !== base) nextSuffix.set(base, suffix);
      used.add(name);
      return name;
    });
  }

  function formulaCellCount(rows) {
    return rows.reduce((count, row) => count + row.filter((value) => /^[=+\-@]/.test(String(value))).length, 0);
  }

  function metadata(rows, extra = {}) {
    const formulaCells = formulaCellCount(rows);
    return {
      rows: rows.length,
      columns: rows.reduce((width, row) => Math.max(width, row.length), 0),
      formulaCells,
      ...(formulaCells > 0
        ? {
          formulaWarning: message(
            "toolFormulaWarning",
            "可能被电子表格解释为公式；导入表格前请复核。",
          ),
        }
        : {}),
      ...extra,
    };
  }

  function toMarkdown(rows) {
    const padded = normalizeRows(rows);
    const safe = (value) => String(value).replaceAll("|", "\\|").replace(/\r\n?|\n/g, "<br>");
    const head = `| ${padded[0].map(safe).join(" | ")} |`;
    const divider = `| ${padded[0].map(() => "---").join(" | ")} |`;
    const body = padded.slice(1).map((row) => `| ${row.map(safe).join(" | ")} |`);
    return [head, divider, ...body].join("\n");
  }

  function outputLines(...initial) {
    const lines = [];
    let length = 0;
    function add(line) {
      // 提前限制字符串长度，避免先创建巨大的结果再检查 UTF-8 字节数。
      length += line.length + (lines.length === 0 ? 0 : 1);
      if (length > MAX_OUTPUT_BYTES) throw outputLimitError();
      lines.push(line);
    }
    initial.forEach(add);
    return { add, join: () => lines.join("\n") };
  }

  function toJson(rows) {
    const padded = normalizeRows(rows);
    if (padded.length === 1) return "[]";
    const headers = uniqueNames(padded[0]);
    const output = outputLines("[");
    for (let index = 1; index < padded.length; index++) {
      const row = padded[index];
      const record = Object.fromEntries(headers.map((header, column) => [header, row[column]]));
      const json = JSON.stringify(record, null, 2).replaceAll("\n", "\n  ");
      output.add(`  ${json}${index < padded.length - 1 ? "," : ""}`);
    }
    output.add("]");
    return output.join();
  }

  function xmlEscape(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
  }

  function toXml(rows) {
    const padded = normalizeRows(rows);
    const headers = uniqueNames(padded[0]);
    const tags = uniqueNames(headers.map((header, index) => {
      const sanitized = header.replace(/[^a-zA-Z0-9_.-]/g, "_") || `column_${index + 1}`;
      return /^[A-Za-z_]/.test(sanitized) ? sanitized : `column_${index + 1}_${sanitized}`;
    }));
    const lines = outputLines("<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<rows>");
    for (const row of padded.slice(1)) {
      lines.add("  <row>");
      tags.forEach((tag, index) => {
        lines.add(`    <${tag}>${xmlEscape(row[index])}</${tag}>`);
      });
      lines.add("  </row>");
    }
    lines.add("</rows>");
    return lines.join();
  }

  function sqlIdentifier(value) {
    return `\`${String(value).replaceAll("`", "``")}\``;
  }

  function sqlValue(value) {
    return value === "" ? "NULL" : `'${String(value).replaceAll("'", "''").replaceAll("\\", "\\\\")}'`;
  }

  function toMysql(rows) {
    if (rows.length < 2) throw inputError("toolTableNoDataRows", "没有数据行可导出。");
    const padded = normalizeRows(rows);
    const headers = uniqueNames(padded[0]);
    const values = padded.slice(1).map((row) => `(${row.map(sqlValue).join(", ")})`);
    return `INSERT INTO ${sqlIdentifier("table_name")} (${headers.map(sqlIdentifier).join(", ")})\nVALUES\n${values.join(",\n")};`;
  }

  function phpStringLiteral(value) {
    const text = String(value).replaceAll("\\", "\\\\");
    if (!/[\r\n]/.test(text)) return `'${text.replaceAll("'", "\\'")}'`;
    // PHP 双引号会解析换行转义，同时要转义美元符号以保留原文。
    const escaped = text.replaceAll('"', '\\"').replaceAll("$", "\\$")
      .replaceAll("\r", "\\r").replaceAll("\n", "\\n");
    return `"${escaped}"`;
  }

  function toPhp(rows) {
    const padded = normalizeRows(rows);
    const headers = uniqueNames(padded[0]);
    const lines = outputLines("<?php", "return [");
    for (const row of padded.slice(1)) {
      lines.add("  [");
      headers.forEach((header, index) =>
        lines.add(`    ${phpStringLiteral(header)} => ${phpStringLiteral(row[index])},`)
      );
      lines.add("  ],");
    }
    lines.add("];");
    lines.add("");
    return lines.join();
  }

  const outputs = {
    Markdown: toMarkdown,
    Csv: (rows) => toDelimited(rows, ","),
    Tsv: (rows) => toDelimited(rows, "\t"),
    Json: toJson,
    Xml: toXml,
    Mysql: toMysql,
    Php: toPhp,
  };

  function run(input, { mode = "csvToMarkdown", delimiter = ",", includePreview = false } = {}) {
    const match = /^(csv|tsv)To(Markdown|Csv|Tsv|Json|Xml|Mysql|Php)$/.exec(mode);
    if (!match) throw new Error("未知的表格转换模式。");
    const [, source, target] = match;
    if (source === target.toLowerCase()) throw new Error("未知的表格转换模式。");
    const rows = parseDelimited(input, source === "tsv" ? "\t" : target === "Markdown" ? delimiter : ",");
    const output = outputs[target](rows);
    if (output.length > MAX_OUTPUT_BYTES || textEncoder.encode(output).byteLength > MAX_OUTPUT_BYTES) {
      throw outputLimitError();
    }
    const result = {
      output,
      metadata: metadata(rows, target === "Mysql"
        ? { warning: message("toolSqlWarning", "SQL 输出是已转义文本；请使用参数化查询。") }
        : {}),
    };
    if (includePreview) result.preview = rows.slice(0, 201).map((row) => row.slice(0, 100));
    return result;
  }

  globalThis.BrowserToolboxTableTool = Object.freeze({
    run,
    parseDelimited,
    toMarkdown,
    toJson,
    toXml,
    toMysql,
    toPhp,
  });
})();

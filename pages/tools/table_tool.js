// CSV/TSV 工具：按 RFC 风格处理引号，输出只使用文本节点的安全 Markdown/CSV。
(function () {
  const MAX_ROWS = 100000;
  const MAX_CELLS = 500000;
  const message = (key, fallback) => globalThis.BrowserToolboxI18n?.message?.(key) || fallback;

  function parseDelimited(source, delimiter) {
    source = String(source).replace(/^\uFEFF/, "");
    if (delimiter !== "," && delimiter !== "\t") throw new Error("表格分隔符无效。");
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    let afterQuote = false;
    let cellCount = 0;
    const pushRow = () => {
      if (rows.length >= MAX_ROWS || cellCount + row.length > MAX_CELLS) {
        throw new Error("表格行数或单元格数量超过本地预算。");
      }
      rows.push(row);
      cellCount += row.length;
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
      } else if (afterQuote) {
        if (char === delimiter) {
          row.push(value);
          value = "";
          afterQuote = false;
        } else if (char === "\n") {
          row.push(value);
          value = "";
          afterQuote = false;
          pushRow();
        } else if (char === "\r") {
          row.push(value);
          value = "";
          afterQuote = false;
          if (source[index + 1] === "\n") index++;
          pushRow();
        } else {
          throw new Error("表格引号后必须紧跟分隔符或换行。");
        }
      } else if (char === '"' && value.length === 0) {
        quoted = true;
      } else if (char === delimiter) {
        row.push(value);
        value = "";
      } else if (char === "\n") {
        row.push(value);
        value = "";
        pushRow();
      } else if (char === "\r") {
        row.push(value);
        value = "";
        if (source[index + 1] === "\n") index++;
        pushRow();
      } else if (char === '"') {
        throw new Error("未加引号的表格字段中不能出现双引号。");
      } else {
        value += char;
      }
    }
    if (quoted) throw new Error("表格输入的引号未闭合。");
    if (afterQuote || row.length > 0 || value !== "" || rows.length === 0) {
      row.push(value);
      pushRow();
    }
    return rows;
  }

  function csvEscape(value) {
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function tsvEscape(value) {
    const text = String(value);
    return /[\t\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function normalizeRows(rows) {
    let width = 1;
    for (const row of rows) width = Math.max(width, row.length);
    return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
  }

  function uniqueNames(values) {
    const used = new Set();
    return values.map((value, index) => {
      const base = String(value) || `column_${index + 1}`;
      let name = base;
      let suffix = 2;
      while (used.has(name)) name = `${base}_${suffix++}`;
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
      columns: rows[0]?.length || 0,
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
    const safe = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
    const head = `| ${padded[0].map(safe).join(" | ")} |`;
    const divider = `| ${padded[0].map(() => "---").join(" | ")} |`;
    const body = padded.slice(1).map((row) => `| ${row.map(safe).join(" | ")} |`);
    return [head, divider, ...body].join("\n");
  }

  function toJson(rows) {
    const padded = normalizeRows(rows);
    const headers = uniqueNames(padded[0]);
    const output = padded.slice(1).map((row) => Object.fromEntries(
      headers.map((header, index) => [header, row[index]]),
    ));
    return JSON.stringify(output, null, 2);
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
    const lines = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<rows>"];
    for (const row of padded.slice(1)) {
      lines.push("  <row>");
      headers.forEach((header, index) => {
        const tag = tags[index];
        lines.push(`    <${tag}>${xmlEscape(row[index])}</${tag}>`);
      });
      lines.push("  </row>");
    }
    lines.push("</rows>");
    return lines.join("\n");
  }

  function sqlIdentifier(value) {
    return `\`${String(value).replaceAll("`", "``")}\``;
  }

  function sqlValue(value) {
    return value === "" ? "NULL" : `'${String(value).replaceAll("'", "''").replaceAll("\\", "\\\\")}'`;
  }

  function toMysql(rows) {
    const padded = normalizeRows(rows);
    const headers = uniqueNames(padded[0]);
    const values = padded.slice(1).map((row) => `(${row.map(sqlValue).join(", ")})`);
    return values.length === 0
      ? `INSERT INTO ${sqlIdentifier("table_name")} (${headers.map(sqlIdentifier).join(", ")}) VALUES;`
      : `INSERT INTO ${sqlIdentifier("table_name")} (${headers.map(sqlIdentifier).join(", ")})\nVALUES\n${values.join(",\n")};`;
  }

  function phpEscape(value) {
    return String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "\\n").replaceAll("\r", "\\r");
  }

  function toPhp(rows) {
    const padded = normalizeRows(rows);
    const headers = uniqueNames(padded[0]);
    const lines = ["<?php", "return ["];
    for (const row of padded.slice(1)) {
      lines.push("  [");
      headers.forEach((header, index) => lines.push(`    '${phpEscape(header)}' => '${phpEscape(row[index])}',`));
      lines.push("  ],");
    }
    lines.push("];", "");
    return lines.join("\n");
  }

  function run(input, { mode = "csvToMarkdown", delimiter = "," } = {}) {
    const normalizedInput = String(input).replace(/^\uFEFF/, "");
    if (mode === "csvToMarkdown" || mode === "tsvToMarkdown") {
      const actualDelimiter = mode === "tsvToMarkdown" ? "\t" : delimiter;
      const rows = parseDelimited(normalizedInput, actualDelimiter);
      return { output: toMarkdown(rows), metadata: metadata(rows) };
    }
    if (mode === "csvToTsv" || mode === "tsvToCsv") {
      const fromDelimiter = mode === "csvToTsv" ? "," : "\t";
      const rows = parseDelimited(normalizedInput, fromDelimiter);
      const output = mode === "csvToTsv"
        ? rows.map((row) => row.map(tsvEscape).join("\t")).join("\n")
        : rows.map((row) => row.map(csvEscape).join(",")).join("\n");
      return { output, metadata: metadata(rows) };
    }
    if (/^(csv|tsv)To(?:Json|Xml|Mysql|Php)$/.test(mode)) {
      const sourceKind = mode.startsWith("tsv") ? "tsv" : "csv";
      const rows = parseDelimited(normalizedInput, sourceKind === "tsv" ? "\t" : ",");
      const target = mode.slice(mode.indexOf("To") + 2).toLowerCase();
      const outputs = { json: toJson, xml: toXml, mysql: toMysql, php: toPhp };
      return {
        output: outputs[target](rows),
        metadata: metadata(rows, {
          warning: target === "mysql"
            ? message("toolSqlWarning", "SQL 输出是已转义文本；请使用参数化查询。")
            : undefined,
        }),
      };
    }
    throw new Error("未知的表格转换模式。");
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

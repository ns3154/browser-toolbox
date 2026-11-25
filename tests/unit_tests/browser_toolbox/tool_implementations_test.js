import "../test_helper.js";
import "../../../lib/browser_toolbox/tools/document_formatters.js";
import "../../../lib/browser_toolbox/tools/tool_contract.js";
import "../../../lib/browser_toolbox/tools/tool_registry.js";
import "../../../pages/tools/tool_runtime.js";
import "../../../pages/tools/json_tool.js";
import "../../../pages/tools/diff_tool.js";
import "../../../pages/tools/codec_tool.js";
import "../../../pages/tools/time_tool.js";
import "../../../pages/tools/generator_tools.js";
import "../../../pages/tools/table_tool.js";
import "../../../pages/tools/properties_yaml_tool.js";
import "../../../pages/tools/tool_loader.js";

context("BrowserToolbox local tool implementations", () => {
  should("run the JSON tool through the shared lossless formatter", () => {
    const result = BrowserToolboxJsonTool.run('{"b":1,"a":2,"a":3}', {
      indentSize: 2,
      sortKeys: true,
    });
    assert.isTrue(result.output.indexOf('"a": 2') < result.output.indexOf('"b": 1'));
    assert.isTrue(result.output.includes('"a": 3'));
    assert.equal(1, result.metadata.duplicateKeys);
    const compact = BrowserToolboxJsonTool.run('{"big":9007199254740993,"nested":"{\\"ok\\":true}"}', {
      operation: "compact",
      expandEscaped: true,
    });
    assert.isTrue(compact.output.includes("9007199254740993"));
    assert.isTrue(compact.output.includes('"ok":true'));
    const valid = BrowserToolboxJsonTool.run('{"ok":true}', { operation: "validate" });
    assert.isTrue(valid.metadata.valid);
    const compactViaLoader = BrowserToolboxToolLoader.load("json.format").run({
      input: '{"a": 1}',
      options: { operation: "compact", indent: "2", sortOrder: "original", compact: false },
      state: { repairApplied: false, workingInput: '{"a": 1}' },
    });
    assert.equal('{"a":1}', compactViaLoader.output);
  });

  should("compare text, transform codecs, and convert time values locally", async () => {
    const diff = BrowserToolboxDiffTool.run("same\nold", "same\nnew");
    assert.isTrue(diff.output.includes("- old"));
    assert.isTrue(diff.output.includes("+ new"));
    const encoded = (await BrowserToolboxCodecTool.run("你好", { mode: "base64Encode" })).output;
    assert.equal("你好", (await BrowserToolboxCodecTool.run(encoded, { mode: "base64Decode" })).output);
    const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjMifQ.signature";
    const decodedJwt = (await BrowserToolboxCodecTool.run(jwt, { mode: "jwtDecode" })).output;
    assert.isTrue(decodedJwt.includes('"sub": "123"'));
    assert.equal("2023-11-14T22:13:20.000Z", BrowserToolboxTimeTool.run("1700000000", {
      mode: "timestampToIso",
    }).output);
    const localMilliseconds = new Date(2023, 10, 14, 22, 13, 20, 123).getTime();
    assert.equal(String(localMilliseconds), BrowserToolboxTimeTool.run("2023-11-14 22:13:20.123", {
      mode: "localToUnixMilliseconds",
    }).output);
    assert.equal("2023-11-14 22:13:20.123", BrowserToolboxTimeTool.run(String(localMilliseconds), {
      mode: "unixMillisecondsToLocal",
    }).output);
    const filetime = BrowserToolboxTimeTool.run(String(localMilliseconds), {
      mode: "unixMillisecondsToFiletime",
    }).output;
    assert.equal("2023-11-14 22:13:20.123", BrowserToolboxTimeTool.run(filetime, {
      mode: "filetimeToLocal",
    }).output);
    let ambiguousIso = false;
    try {
      BrowserToolboxTimeTool.run("2023-11-14T22:13:20", { mode: "isoToUnixSeconds" });
    } catch (_) {
      ambiguousIso = true;
    }
    assert.isTrue(ambiguousIso);
    assert.equal("e4 bd a0 e5 a5 bd", (await BrowserToolboxCodecTool.run("你好", {
      mode: "utf8Encode",
    })).output);
    assert.equal("你好", (await BrowserToolboxCodecTool.run("e4 bd a0 e5 a5 bd", {
      mode: "utf8Decode",
    })).output);
    assert.equal("900150983cd24fb0d6963f7d28e17f72", (await BrowserToolboxCodecTool.run("abc", {
      mode: "md5",
    })).output);
    assert.equal("a9993e364706816aba3e25717850c26c9cd0d89d", (await BrowserToolboxCodecTool.run("abc", {
      mode: "sha1",
    })).output);
    if (globalThis.CompressionStream && globalThis.DecompressionStream) {
      const packed = (await BrowserToolboxCodecTool.run("本地 gzip", { mode: "gzipCompress" })).output;
      assert.equal("本地 gzip", (await BrowserToolboxCodecTool.run(packed, {
        mode: "gzipDecompress",
      })).output);
    }
  });

  should("generate cryptographically random identifiers and passwords", () => {
    const ids = BrowserToolboxGeneratorTools.generateId({ mode: "uuid", count: 2 }).output;
    assert.equal(2, ids.split("\n").length);
    assert.isTrue(/^[0-9a-f-]+$/i.test(ids.split("\n")[0]));
    const password = BrowserToolboxGeneratorTools.generatePassword({ length: 24, symbols: false });
    assert.equal(24, password.output.length);
    assert.isTrue(/^[0-9A-Za-z]+$/.test(password.output));
    assert.equal(57, password.metadata.charsetSize);
    assert.equal(79, BrowserToolboxGeneratorTools.generatePassword({ length: 64 }).metadata.charsetSize);
    assert.equal(20, BrowserToolboxGeneratorTools.generateId({ count: 20 }).output.split("\n").length);
  });

  should("自动识别时间格式并保留 FILETIME 精度，手动模式支持纪元与短时间戳", () => {
    const { parseInput } = BrowserToolboxTimeTool;
    const seconds = parseInput("1795149000");
    assert.equal("seconds", seconds.kind);
    assert.equal(1795149000000, seconds.milliseconds);
    assert.equal("milliseconds", parseInput("1795149000000").kind);
    assert.equal("iso", parseInput("2026-11-20T04:30:00Z").kind);
    assert.equal("local", parseInput("2026-11-20 12:30:00").kind);
    const precise = BigInt(seconds.filetime) + 5n;
    assert.equal(String(precise), parseInput(String(precise)).filetime);
    assert.equal("1601-01-01T00:00:00.000Z", new Date(parseInput("0", "filetime").milliseconds).toISOString());
    assert.equal(1000, parseInput("1", "seconds").milliseconds);
    assert.throwsError(() => parseInput("2026-02-30T00:00:00Z"));
  });

  should("保留 JSON 语法错误的实际行列号", () => {
    let position;
    try {
      BrowserToolboxJsonTool.run(' {\n  "a": "bad\\q"\n}');
    } catch (error) {
      position = [error.line, error.column];
    }
    assert.equal([2, 13], position);
  });

  should("MySQL 导出要求至少一条数据行，保留空字段和零值", () => {
    const table = BrowserToolboxTableTool;
    for (const [header, mode] of [["name,age", "csvToMysql"], ["name\tage\r\n", "tsvToMysql"]]) {
      let errorKey;
      try {
        table.run(header, { mode });
      } catch (error) {
        errorKey = error.messageKey;
      }
      assert.equal("toolTableNoDataRows", errorKey);
    }
    assert.isTrue(table.run("name,age\n,0", { mode: "csvToMysql" }).output.includes("(NULL, '0')"));
    assert.equal([], JSON.parse(table.run("name,age", { mode: "csvToJson" }).output));
  });

  should("PHP 导出保留 CSV 与 TSV 字段中的换行和转义字符", () => {
    const expected = [
      "<?php",
      "return [",
      "  [",
      "    'name' => 'Ana',",
      String.raw`    "多行\r\n表头" => "first\r\nsecond\nthird\rfourth \"双引号\" '单引号' \\n \$name",`,
      "  ],",
      "];",
      "",
    ].join("\n");
    for (const [delimiter, mode] of [[",", "csvToPhp"], ["\t", "tsvToPhp"]]) {
      const source = `name${delimiter}"多行\r\n表头"\r\nAna${delimiter}"first\r\nsecond\nthird\rfourth ""双引号"" '单引号' \\n $name"`;
      assert.equal(expected, BrowserToolboxTableTool.run(source, { mode }).output);
    }
  });

  should("Markdown 将 CSV 单元格内的不同换行符都转成单元格内换行", () => {
    const source = 'name,note\r\nAna,"first\r\nsecond\rthird\nfourth"';
    const { output } = BrowserToolboxTableTool.run(source, { mode: "csvToMarkdown" });
    assert.equal("| name | note |\n| --- | --- |\n| Ana | first<br>second<br>third<br>fourth |", output);
  });

  should("表格补齐列数时也遵守单元格上限", () => {
    const table = BrowserToolboxTableTool;
    const source = "name\n" + "value\n".repeat(999) + ",".repeat(499);
    for (const target of ["Markdown", "Json", "Xml", "Mysql", "Php"]) {
      let errorKey;
      try {
        table.run(source, { mode: `csvTo${target}` });
      } catch (error) {
        errorKey = error.messageKey;
      }
      assert.equal("toolTableLimit", errorKey);
    }
    assert.equal(1001, table.run(source, { mode: "csvToTsv" }).metadata.rows);
    assert.equal([{ name: "value", column_2: "" }, { name: "", column_2: "ok" }],
      JSON.parse(table.run("name\nvalue\n,ok", { mode: "csvToJson" }).output));
  });

  should("CSV 与 TSV 互转保留首字段的 BOM 字符和最后的空字段行", () => {
    const table = BrowserToolboxTableTool;
    const source = '"\uFEFFname"\nvalue\n""';
    for (const [mode, delimiter] of [["csvToTsv", "\t"], ["tsvToCsv", ","]]) {
      const { output } = table.run(source, { mode });
      assert.equal([["\uFEFFname"], ["value"], [""]], table.parseDelimited(output, delimiter));
    }
    assert.equal("name\nvalue", table.run("name\nvalue\n", { mode: "csvToTsv" }).output);
  });

  should("重复表头后的实际输出仍遵守 10 MiB 大小限制", () => {
    const table = BrowserToolboxTableTool;
    const header = "h".repeat(64000);
    const source = `${header}\n${"value\n".repeat(200)}`;
    for (const target of ["Json", "Xml", "Php"]) {
      let errorKey;
      try {
        table.run(source, { mode: `csvTo${target}` });
      } catch (error) {
        errorKey = error.messageKey;
      }
      assert.equal("toolCodecOutputTooLarge", errorKey);
    }
    assert.isTrue(table.run(source, { mode: "csvToMarkdown" }).output.startsWith(`| ${header} |`));
    const multibyte = `${"表".repeat(32000)}\n${"value\n".repeat(120)}`;
    assert.throwsError(() => table.run(multibyte, { mode: "csvToJson" }));
    const expected = JSON.stringify([{ name: "first" }, { name: "second" }], null, 2);
    assert.equal(expected, table.run("name\nfirst\nsecond", { mode: "csvToJson" }).output);
  });

  should("parse quoted tables and expose every implementation through the static loader", () => {
    const table = BrowserToolboxTableTool.run('name,note\n"A","x,y"', {
      mode: "csvToMarkdown",
    });
    assert.isTrue(table.output.includes("x,y"));
    const tsv = BrowserToolboxTableTool.run("name\tnote\n\"A\"\t\"line 1\nline 2\"", {
      mode: "tsvToCsv",
    });
    assert.isTrue(tsv.output.includes('"line 1\nline 2"'));
    const json = BrowserToolboxTableTool.run("name,note\nA,ok", { mode: "csvToJson" });
    assert.equal("A", JSON.parse(json.output)[0].name);
    const duplicateHeaders = BrowserToolboxTableTool.run("a,a\n1,2", { mode: "csvToJson" });
    assert.equal({ a: "1", a_2: "2" }, JSON.parse(duplicateHeaders.output)[0]);
    const collidingHeaders = BrowserToolboxTableTool.run("a,a_2,a,a,a_3\n1,2,3,4,5", { mode: "csvToJson" });
    assert.equal({ a: "1", a_2: "2", a_3: "3", a_4: "4", a_3_2: "5" },
      JSON.parse(collidingHeaders.output)[0]);
    const formula = BrowserToolboxTableTool.run("name\n=SUM(A1)", { mode: "csvToTsv" });
    assert.equal(1, formula.metadata.formulaCells);
    const preview = BrowserToolboxTableTool.run('name\tnote\nA\t"line 1\nline 2"', {
      mode: "tsvToCsv", includePreview: true,
    });
    assert.equal([["name", "note"], ["A", "line 1\nline 2"]], preview.preview);
    let malformed = false;
    try {
      BrowserToolboxTableTool.parseDelimited('name,note\n"bad"x,value', ",");
    } catch (_) {
      malformed = true;
    }
    assert.isTrue(malformed);
    for (const id of BrowserToolboxToolRegistry.TOOL_IDS) {
      assert.isTrue(Boolean(BrowserToolboxToolLoader.load(id)));
    }
  });
});

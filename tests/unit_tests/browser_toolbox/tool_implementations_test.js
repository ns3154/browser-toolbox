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
    const formula = BrowserToolboxTableTool.run("name\n=SUM(A1)", { mode: "csvToTsv" });
    assert.equal(1, formula.metadata.formulaCells);
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

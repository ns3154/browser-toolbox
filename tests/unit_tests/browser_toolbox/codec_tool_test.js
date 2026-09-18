import "../test_helper.js";
import "../../../pages/tools/tool_runtime.js";
import "../../../pages/tools/codec_tool.js";

context("BrowserToolbox 编码转换", () => {
  const codec = BrowserToolboxCodecTool;
  const output = async (value, mode, options = {}) =>
    (await codec.run(value, { mode, ...options })).output;

  should("对选定的双向类型保留中文、表情、换行和 BOM", async () => {
    const source = '\ufeff你好 😀\n"A&B" <xml> \\';
    for (
      const type of [
        "base64",
        "url",
        "uri",
        "unicode",
        "unicodeEscape",
        "jsonString",
        "xml",
        "binary",
        "octal",
        "decimal",
        "dataUrl",
      ]
    ) {
      const encoded = await output(source, `${type}Encode`);
      assert.equal(source, await output(encoded, `${type}Decode`));
    }
    assert.equal("A\n\x7f", await output(await output("A\n\x7f", "asciiEncode"), "asciiDecode"));
  });

  should("使用标准已知向量而非只验证往返", async () => {
    for (
      const [input, mode, expected] of [
        ["你好", "base64Encode", "5L2g5aW9"],
        ["你好😀", "unicodeEncode", "U+4F60 U+597D U+1F600"],
        ["你😀", "unicodeEscapeEncode", "\\u4f60\\ud83d\\ude00"],
        ['a\n"b"\\', "jsonStringEncode", '"a\\n\\"b\\"\\\\"'],
        ['<a x="1">&\'</a>', "xmlEncode", "&lt;a x=&quot;1&quot;&gt;&amp;&apos;&lt;/a&gt;"],
        ["A你", "binaryEncode", "01000001 11100100 10111101 10100000"],
        ["A你", "octalEncode", "101 344 275 240"],
        ["A你", "decimalEncode", "65 228 189 160"],
        ["AZ\n", "asciiEncode", "65 90 10"],
        ["Hello", "dataUrlEncode", "data:text/plain;charset=utf-8;base64,SGVsbG8="],
      ]
    ) assert.equal(expected, await output(input, mode));
  });

  should("分别处理 URL 参数和完整 URL 的结构分隔符", async () => {
    const uri = "https://example.test/a b?q=你好&x=1#片段";
    assert.equal(
      "https%3A%2F%2Fexample.test%2Fa%20b%3Fq%3D%E4%BD%A0%E5%A5%BD%26x%3D1%23%E7%89%87%E6%AE%B5",
      await output(uri, "urlEncode"),
    );
    assert.equal(
      "https://example.test/a%20b?q=%E4%BD%A0%E5%A5%BD&x=1#%E7%89%87%E6%AE%B5",
      await output(uri, "uriEncode"),
    );
    assert.equal("a+b c", await output("a+b%20c", "urlDecode"));
    assert.equal("%2F%3F%23", await output("%2F%3F%23", "uriDecode"));
  });

  should("解码 Unicode 和 JSON 字符串时不重复解释新产生的转义", () => {
    assert.equal("😀你", codec.decodeUnicodeEscape("\\u{1F600}\\u4f60"));
    assert.equal("\\u0041", codec.decodeUnicodeEscape("\\u005cu0041"));
    assert.equal("\\u0041", codec.decodeJsonString('"\\\\u0041"'));
    for (const invalid of ["\\u123", "\\uZZZZ", "\\u{110000}", "\\u{41", "\\x41", "\\"]) {
      assert.throwsError(() => codec.decodeUnicodeEscape(invalid));
    }
    for (const invalid of ["{}", "123", "null", '["a"]', "hello"]) {
      assert.throwsError(() => codec.decodeJsonString(invalid));
    }
    for (const invalid of ["U+110000", "U+D800", "U+GGGG"]) {
      assert.throwsError(() => codec.decodeUnicode(invalid));
    }
    assert.throwsError(() => codec.encodeUnicode("\ud800"));
  });

  should("只解码 XML 预定义和有效数字实体，保留单次转义语义", () => {
    assert.equal(
      "<>&\"' 😀你",
      codec.decodeXml("&lt;&gt;&amp;&quot;&apos;&#x20;&#128512;&#x4F60;"),
    );
    assert.equal("&lt;", codec.decodeXml("&amp;lt;"));
    for (
      const invalid of ["&nbsp;", "&AMP;", "&lt", "&", "&#0;", "&#xD800;", "&#x110000;", "\x01"]
    ) {
      assert.throwsError(() => codec.decodeXml(invalid));
    }
    assert.throwsError(() => codec.encodeXml("\x00"));
  });

  should("校验字节的进制、边界和完整 UTF-8 序列", () => {
    assert.equal("你好", codec.decodeByteRadix("228,189,160\n229 165 189", 10));
    for (
      const [value, radix] of [
        ["2", 2],
        ["100000000", 2],
        ["400", 8],
        ["089", 8],
        ["256", 10],
        ["-1", 10],
        ["1.5", 10],
        ["65junk", 10],
        ["255", 10],
        ["228 189", 10],
      ]
    ) {
      assert.throwsError(() => codec.decodeByteRadix(value, radix));
    }
    assert.throwsError(() => codec.encodeAscii("你好"));
    assert.throwsError(() => codec.encodeAscii("é"));
    assert.throwsError(() => codec.decodeAscii("128"));
  });

  should("Base64 支持标准空白和无填充输入并拒绝损坏的文本", () => {
    assert.equal("Hello", codec.decodeBase64("SG Vs\nbG8="));
    assert.equal("Hello", codec.decodeBase64("SGVsbG8"));
    assert.throwsError(() => codec.decodeBase64("not*base64"));
    assert.throwsError(() => codec.decodeBase64("/w=="));
  });

  should("解码 Data URL 的百分号字节、Base64 和字符集", async () => {
    assert.equal("Hello+ world", await output("data:,Hello+%20world", "dataUrlDecode"));
    assert.equal(
      "你好",
      await output("data:text/plain;charset=utf-8,%E4%BD%A0%E5%A5%BD", "dataUrlDecode"),
    );
    assert.equal("Hello", await output("data:text/plain;BASE64,SGVsbG8%3D", "dataUrlDecode"));
    assert.equal("é", await output("data:text/plain;charset=iso-8859-1,%E9", "dataUrlDecode"));
    assert.equal("", await output("data:,", "dataUrlDecode"));
    for (
      const invalid of [
        "https://example.test/a",
        "data:text/plain",
        "data:invalid,hello",
        "data:text/plain;base64;x=1,YQ==",
        "data:,%",
        "data:text/plain;base64,***",
      ]
    ) {
      assert.throwsError(() => codec.decodeDataUrl(invalid));
    }
  });

  should("Data URL 文件往返保留所有二进制字节并限制预览长度", async () => {
    const bytes = Uint8Array.from({ length: 513 }, (_, index) => index % 256);
    const encoded = await output("", "dataUrlEncode", {
      file: { bytes, mime: "application/octet-stream" },
    });
    const decoded = await codec.run(encoded, { mode: "dataUrlDecode" });
    assert.isTrue(decoded.binary);
    assert.equal([...bytes], [...decoded.download.bytes]);
    assert.equal("decoded.bin", decoded.download.filename);
    assert.isTrue(decoded.output.endsWith(" …"));
    assert.isTrue(decoded.output.length < 800);
    const invalidText = codec.decodeDataUrl("data:text/plain,%FF%00");
    assert.isTrue(invalidText.binary);
    assert.equal([255, 0], [...invalidText.download.bytes]);
    const png = codec.decodeDataUrl("data:image/png;base64,iVBORw==");
    assert.equal("decoded.png", png.download.filename);
  });

  should("MD5 保持标准摘要，包括空输入和跨块输入", async () => {
    for (
      const [input, digest] of [["", "d41d8cd98f00b204e9800998ecf8427e"], [
        "abc",
        "900150983cd24fb0d6963f7d28e17f72",
      ], ["1234567890".repeat(8), "57edf4a22be3c955ac49da2e2107b67a"]]
    ) {
      assert.equal(digest, await output(input, "md5"));
    }
  });

  should("阻止过大的字节展开结果", async () => {
    let rejected = false;
    try {
      await codec.run("a".repeat(2 * 1024 * 1024), { mode: "binaryEncode" });
    } catch (_) {
      rejected = true;
    }
    assert.isTrue(rejected);
  });
});

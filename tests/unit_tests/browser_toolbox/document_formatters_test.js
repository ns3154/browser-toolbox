import "../test_helper.js";
import "../../../lib/browser_toolbox/tools/document_formatters.js";

context("BrowserToolbox document formatters", () => {
  const api = () => BrowserToolboxDocumentFormatters;

  should("detect only direct raw-document MIME types or known text extensions", () => {
    assert.equal("json", api().detectDocument({ contentType: "application/json" }));
    assert.equal("xml", api().detectDocument({ contentType: "text/xml; charset=utf-8" }));
    assert.equal(
      "javascript",
      api().detectDocument({
        contentType: "text/plain",
        url: "browser-toolbox://local/app.js",
      }),
    );
    assert.equal(
      null,
      api().detectDocument({
        contentType: "text/html",
        url: "browser-toolbox://local/app.json",
      }),
    );
    assert.equal(
      null,
      api().detectDocument({ contentType: "text/plain", url: "https://example.test/" }),
    );
    assert.equal("json", api().detectDocument({
      contentType: "application/problem+json",
      source: "not parsed here",
    }));
    assert.equal("xml", api().detectDocument({
      contentType: "application/feed+xml",
      source: "not parsed here",
    }));
    assert.equal("javascript", api().detectDocument({
      contentType: "text/javascript",
      source: "not parsed here",
    }));
    assert.equal("java", api().detectDocument({
      contentType: "text/x-java-source",
      source: "not parsed here",
    }));
    assert.equal(null, api().detectDocument({
      contentType: "application/octet-stream",
      url: "https://example.test/App.java",
      source: "class App {}",
    }));
    assert.equal(null, api().detectDocument({
      contentType: "text/plain",
      url: "https://example.test/looks.json",
      source: "{broken",
    }));
  });

  should("format JSON without losing duplicate keys or number text", () => {
    const source = '{"z":1.2300,"a":{"n":2},"a":3}';
    const result = api().formatJsonDocument(source, { indentSize: 2 });
    assert.isTrue(result.formatted.includes("1.2300"));
    assert.isTrue(result.formatted.includes('"a": {'));
    assert.equal(4, result.metadata.keys);
    assert.equal(1, result.metadata.duplicateKeys);
    assert.equal(3, result.metadata.numbers);
    const sorted = api().formatJsonDocument('{"😀":1,"a":2}', { sortKeys: true });
    assert.isTrue(sorted.formatted.indexOf('"a"') < sorted.formatted.indexOf('"😀"'));
    const collapsed = api().formatJsonDocument(source, { collapseDepth: 1 });
    assert.isTrue(collapsed.formatted.includes("{…}"));
    assert.equal(1, api().formatJsonDocument("9007199254740993", {}).metadata.unsafeNumbers);
    assert.equal("object", api().formatJsonDocument(source, {}).metadata.rootType);
  });

  should("repair common mojibake only when the transformation is reversible", () => {
    const broken = api().repairMojibake('{"name":"cafÃ©"}');
    assert.isTrue(broken.changed);
    assert.equal('{"name":"café"}', broken.value);
    assert.isFalse(api().repairMojibake('{"name":"中文"}').changed);
  });

  should("format XML while retaining declaration, comments, CDATA, and attributes", () => {
    const source =
      '<?xml version="1.0"?><root a="x"><!-- keep --><item><![CDATA[a < b]]></item></root>';
    const result = api().formatXmlDocument(source);
    assert.isTrue(result.formatted.includes('<?xml version="1.0"?>'));
    assert.isTrue(result.formatted.includes("<!-- keep -->"));
    assert.isTrue(result.formatted.includes("<![CDATA[a < b]]>"));
    assert.isTrue(result.formatted.includes('<root a="x">'));
    let failed = false;
    try {
      api().formatXmlDocument("<root><item></root>");
    } catch (_) {
      failed = true;
    }
    assert.isTrue(failed);
    const doctype = api().formatXmlDocument(
      '<!DOCTYPE root [<!ENTITY x ">">]><root><value>&amp;</value></root>',
    );
    assert.isTrue(doctype.formatted.includes("<!DOCTYPE root [<!ENTITY x \">\">]>"));
    const text = api().formatXmlDocument("<root>  hello  </root>");
    assert.isTrue(text.formatted.includes(">  hello  </root>"));
    let tooDeep = false;
    try {
      api().formatXmlDocument("<a><b><c/></b></a>", { maxDepth: 2 });
    } catch (_) {
      tooDeep = true;
    }
    assert.isTrue(tooDeep);
    let multipleRoots = false;
    try {
      api().formatXmlDocument("<a/><b/>");
    } catch (_) {
      multipleRoots = true;
    }
    assert.isTrue(multipleRoots);
  });

  should("indent CSS, JavaScript, and Java without rewriting string contents", () => {
    const css = api().formatCodeDocument('.a{content:"}";color:red}', "css");
    assert.isTrue(css.formatted.includes('content:"}";'));
    const javascript = api().formatCodeDocument('function f(){const x="}";return x}', "javascript");
    assert.isTrue(javascript.formatted.includes('const x="}";'));
    const java = api().formatCodeDocument('class A{String value="}";}', "java");
    assert.isTrue(java.formatted.includes('String value="}";'));
    const complexJavaScript = api().formatCodeDocument(
      'const re=/[{}]/g; const text=`${re}`;',
      "javascript",
    );
    assert.equal(true, complexJavaScript.metadata.conservative);
    assert.equal('class A { String text = """{ }"""; }', api().formatCodeDocument(
      'class A { String text = """{ }"""; }',
      "java",
    ).formatted);
    assert.equal("css", api().adapterFor("css").id);
    assert.equal("java", api().adapterFor("java").id);
  });

  should("keep oversized documents unchanged and expose byte budgets", () => {
    const source = "x".repeat(api().CONFIRM_MAX_BYTES + 1);
    const result = api().formatDocument(source, "css");
    assert.isTrue(result.skipped);
    assert.equal(source, result.formatted);
    assert.equal(api().CONFIRM_MAX_BYTES + 1, result.metadata.bytes);
  });
});

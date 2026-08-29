import "../test_helper.js";
import * as jsdom from "jsdom";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/command_invocation.js";
import "../../../content_scripts/mouse/drag_context_classifier.js";

context("Drag context classifier", () => {
  setup(() => {
    const html =
      "<a id='link' href='https://example.com/a'><span>Example</span></a><img id='image' src='https://example.com/a.png'><input id='file' type='file'><div id='card' draggable='true'>card</div>";
    const doc = new jsdom.JSDOM(html).window.document;
    stub(globalThis, "document", doc);
  });

  should("classify nested link targets", () => {
    const result = BrowserToolboxDragContextClassifier.classify(
      document.querySelector("#link span"),
    );
    assert.equal("LINK", result.type);
    assert.equal("https://example.com/a", result.linkUrl);
  });

  should("protect file inputs and custom draggable widgets", () => {
    assert.equal(
      "UNSUPPORTED_NATIVE_DRAG",
      BrowserToolboxDragContextClassifier.classify(document.querySelector("#file")).type,
    );
    assert.equal(
      "UNSUPPORTED_NATIVE_DRAG",
      BrowserToolboxDragContextClassifier.classify(document.querySelector("#card")).type,
    );
  });

  should("protect editors, reject files, and classify shadow DOM links", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    document.body.appendChild(editor);
    assert.equal(
      "UNSUPPORTED_NATIVE_DRAG",
      BrowserToolboxDragContextClassifier.classify(editor).type,
    );

    const link = document.createElement("a");
    link.href = "https://example.com/shadow";
    link.textContent = "Shadow link";
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.appendChild(link);
    document.body.appendChild(host);
    const result = BrowserToolboxDragContextClassifier.classify(link);
    assert.equal("LINK", result.type);
    assert.equal("https://example.com/shadow", result.linkUrl);
    const retargeted = BrowserToolboxDragContextClassifier.classify(host, "", null, [
      link,
      shadow,
      host,
    ]);
    assert.equal("LINK", retargeted.type);
    assert.equal("https://example.com/shadow", retargeted.linkUrl);

    const file = { files: [{ name: "local.txt" }] };
    assert.equal(
      "UNSUPPORTED_NATIVE_DRAG",
      BrowserToolboxDragContextClassifier.classify(link, "", file).type,
    );
  });

  should("reject unsafe link and image schemes", () => {
    const doc = new jsdom.JSDOM(
      "<a id='bad-link' href='javascript:alert(1)'>bad</a><img id='bad-image' src='data:image/png;base64,AA=='>",
    ).window.document;
    assert.equal(
      "UNSUPPORTED_NATIVE_DRAG",
      BrowserToolboxDragContextClassifier.classify(doc.querySelector("#bad-link")).type,
    );
    assert.equal(
      "UNSUPPORTED_NATIVE_DRAG",
      BrowserToolboxDragContextClassifier.classify(doc.querySelector("#bad-image")).type,
    );
  });

  should("classify images and selected text while rejecting unsupported targets", () => {
    const image = document.querySelector("#image");
    assert.equal("IMAGE", BrowserToolboxDragContextClassifier.classify(image).type);
    assert.equal(
      "SELECTED_TEXT",
      BrowserToolboxDragContextClassifier.classify(
        document.body,
        "  selected text  ",
      ).type,
    );
    assert.equal(
      "UNSUPPORTED_NATIVE_DRAG",
      BrowserToolboxDragContextClassifier.classify(
        document.body,
        "",
        null,
        null,
      ).type,
    );
    assert.equal(
      "UNSUPPORTED_NATIVE_DRAG",
      BrowserToolboxDragContextClassifier.classify(null).type,
    );
    assert.isFalse(BrowserToolboxDragContextClassifier.isProtectedTarget(document.body));
    assert.equal(null, BrowserToolboxDragContextClassifier.safeUrl("javascript:alert(1)"));
    assert.equal(null, BrowserToolboxDragContextClassifier.safeUrl("blob:https://example.com/id"));
  });
});

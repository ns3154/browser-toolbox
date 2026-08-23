import "../test_helper.js";
import * as jsdom from "jsdom";
import "../../../lib/open_key_mouse/command_invocation.js";
import "../../../content_scripts/mouse/drag_context_classifier.js";

context("Drag context classifier", () => {
  setup(() => {
    const html =
      "<a id='link' href='https://example.com/a'><span>Example</span></a><img id='image' src='https://example.com/a.png'><input id='file' type='file'><div id='card' draggable='true'>card</div>";
    const doc = new jsdom.JSDOM(html).window.document;
    stub(globalThis, "document", doc);
  });

  should("classify nested link targets", () => {
    const result = OpenKeyMouseDragContextClassifier.classify(document.querySelector("#link span"));
    assert.equal("LINK", result.type);
    assert.equal("https://example.com/a", result.linkUrl);
  });

  should("protect file inputs and custom draggable widgets", () => {
    assert.equal(
      "UNSUPPORTED_NATIVE_DRAG",
      OpenKeyMouseDragContextClassifier.classify(document.querySelector("#file")).type,
    );
    assert.equal(
      "UNSUPPORTED_NATIVE_DRAG",
      OpenKeyMouseDragContextClassifier.classify(document.querySelector("#card")).type,
    );
  });
});

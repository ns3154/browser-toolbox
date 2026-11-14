// SPDX-License-Identifier: GPL-3.0-or-later
import * as testHelper from "./test_helper.js";
import { probeDocument } from "../../pages/ui_component_messenger.js";

context("无痕组件原生存活探测", () => {
  const url = "chrome-extension://synthetic-extension/pages/vomnibar_page.html";
  const request = {
    name: "BrowserToolboxProbeUiDocument",
    nonce: "synthetic-nonce",
    documentId: "synthetic-document",
    tabId: 7,
    frameId: 2,
  };
  const sender = { id: "synthetic-extension" };
  let contexts, reads;
  setup(async () => {
    await testHelper.jsdomStub("pages/vomnibar_page.html");
    stub(globalThis, "location", { href: url });
    stub(chrome.runtime, "id", sender.id);
    stub(chrome.runtime, "getURL", (page) => `chrome-extension://${sender.id}/${page}`);
    stub(chrome, "extension", { inIncognitoContext: true });
    contexts = [{
      documentId: request.documentId,
      tabId: 7,
      frameId: 2,
      incognito: true,
      documentUrl: url,
    }];
    reads = 0;
    stub(chrome.runtime, "getContexts", async (filter) => {
      reads++;
      assert.equal({ documentIds: [request.documentId], incognito: true }, filter);
      return contexts;
    });
  });
  function probe() {
    return new Promise((resolve) => assert.isTrue(probeDocument(request, sender, resolve)));
  }
  should("只回应本上下文的原生身份，输入字段和旧文档不能成为证据", async () => {
    const native = { ...contexts[0] };
    assert.equal({ nonce: request.nonce, context: contexts[0] }, await probe());
    for (
      const mismatch of [
        { documentId: "old-document" },
        { tabId: 8 },
        { frameId: 3 },
        { incognito: false },
        { documentUrl: "https://example.invalid/" },
      ]
    ) {
      contexts = [{ ...native, ...mismatch }];
      assert.equal({ nonce: request.nonce, context: null }, await probe());
    }
    contexts = [];
    assert.equal({ nonce: request.nonce, context: null }, await probe());
  });
  should("其他扩展、普通上下文、非组件页面和预渲染文档不会回应", () => {
    const respond = () => {
      throw new Error("不应回应");
    };
    assert.isFalse(probeDocument(request, { id: "another-extension" }, respond));
    assert.isFalse(probeDocument({ ...request, name: "unknown" }, sender, respond));
    chrome.extension.inIncognitoContext = false;
    assert.isFalse(probeDocument(request, sender, respond));
    chrome.extension.inIncognitoContext = true;
    location.href = "chrome-extension://synthetic-extension/pages/mouse_options.html";
    assert.isFalse(probeDocument(request, sender, respond));
    location.href = url;
    stub(document, "prerendering", true);
    assert.isFalse(probeDocument(request, sender, respond));
    assert.equal(0, reads);
  });
});

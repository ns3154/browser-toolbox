import "../test_helper.js";
import * as jsdom from "jsdom";
import "../../../content_scripts/mouse/cursor_controller.js";

const onePixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

context("BrowserToolbox local cursor", () => {
  function pngWithDimensions(width, height) {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes[16] = (width >>> 24) & 255;
    bytes[17] = (width >>> 16) & 255;
    bytes[18] = (width >>> 8) & 255;
    bytes[19] = width & 255;
    bytes[20] = (height >>> 24) & 255;
    bytes[21] = (height >>> 16) & 255;
    bytes[22] = (height >>> 8) & 255;
    bytes[23] = height & 255;
    return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
  }

  should("accept only a small PNG with bounded dimensions", () => {
    const metadata = BrowserToolboxCursorAsset.readPngAsset(onePixelPng);
    assert.equal(1, metadata.width);
    assert.equal(1, metadata.height);
    assert.isTrue(BrowserToolboxCursorAsset.isSafeAsset(onePixelPng));
    assert.isFalse(BrowserToolboxCursorAsset.isSafeAsset("data:image/svg+xml;base64,abc"));
  });

  should("reject malformed or oversized cursor data", () => {
    assert.equal(null, BrowserToolboxCursorAsset.readPngAsset("not-a-png"));
    assert.equal(null, BrowserToolboxCursorAsset.readPngAsset("data:image/png;base64,"));
    assert.equal(null, BrowserToolboxCursorAsset.readPngAsset("data:image/png;base64,!!!"));
    assert.equal(null, BrowserToolboxCursorAsset.readPngAsset("data:image/png;base64,not-png"));
    assert.equal(
      null,
      BrowserToolboxCursorAsset.readPngAsset(
        `data:image/png;base64,${"A".repeat(350000)}`,
      ),
    );
    assert.equal(
      null,
      BrowserToolboxCursorAsset.readPngAsset(
        `data:image/png;base64,${btoa("x".repeat(24))}`,
      ),
    );
    assert.equal(null, BrowserToolboxCursorAsset.readPngAsset(pngWithDimensions(129, 1)));
    assert.isFalse(BrowserToolboxCursorAsset.isSafeAsset("https://example.com/pointer.png"));
  });

  should("apply and clear a bounded local PNG cursor", () => {
    const doc = new jsdom.JSDOM("<!doctype html><html><body></body></html>").window.document;
    const controller = new BrowserToolboxCursorController(doc);
    assert.isFalse(controller.apply({ enabled: false }, onePixelPng));
    assert.isFalse(controller.apply({ enabled: true }, "bad"));
    assert.isTrue(controller.apply({ enabled: true, hotspotX: 9, hotspotY: 9 }, onePixelPng));
    const style = doc.querySelector("style[data-browser-toolbox-cursor]");
    assert.isTrue(Boolean(style));
    assert.isTrue(style.textContent.includes("0 0"));
    controller.clear();
    assert.equal(null, controller.style);
  });
});

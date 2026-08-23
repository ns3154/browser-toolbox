import "../test_helper.js";
import "../../../content_scripts/mouse/cursor_controller.js";

const onePixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

context("OpenKeyMouse local cursor", () => {
  should("accept only a small PNG with bounded dimensions", () => {
    const metadata = OpenKeyMouseCursorAsset.readPngAsset(onePixelPng);
    assert.equal(1, metadata.width);
    assert.equal(1, metadata.height);
    assert.isTrue(OpenKeyMouseCursorAsset.isSafeAsset(onePixelPng));
    assert.isFalse(OpenKeyMouseCursorAsset.isSafeAsset("data:image/svg+xml;base64,abc"));
  });

  should("reject malformed or oversized cursor data", () => {
    assert.equal(null, OpenKeyMouseCursorAsset.readPngAsset("data:image/png;base64,not-png"));
    assert.isFalse(OpenKeyMouseCursorAsset.isSafeAsset("https://example.com/pointer.png"));
  });
});

// 自定义指针只读取本地 PNG 数据，不允许 SVG、HTML 或远程 URL。
(function () {
  const MAX_BYTES = 256 * 1024;
  const MAX_DIMENSION = 128;

  function readPngAsset(asset) {
    if (typeof asset !== "string" || !asset.startsWith("data:image/png;base64,")) return null;
    const encoded = asset.slice("data:image/png;base64,".length);
    if (encoded.length === 0 || encoded.length > Math.ceil(MAX_BYTES * 4 / 3) + 32) return null;
    let binary;
    try {
      binary = atob(encoded);
    } catch (_) {
      return null;
    }
    if (binary.length < 24 || binary.length > MAX_BYTES) return null;
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((value, index) => binary.charCodeAt(index) === value)) return null;
    const readUint32 = (offset) =>
      ((binary.charCodeAt(offset) << 24) | (binary.charCodeAt(offset + 1) << 16) |
        (binary.charCodeAt(offset + 2) << 8) | binary.charCodeAt(offset + 3)) >>> 0;
    const width = readUint32(16);
    const height = readUint32(20);
    if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
    return { bytes: binary.length, width, height };
  }

  function isSafeAsset(asset) {
    return Boolean(readPngAsset(asset));
  }

  class CursorController {
    constructor(doc = globalThis.document) {
      this.document = doc;
      this.style = null;
    }

    apply(settings, asset) {
      this.clear();
      if (!settings?.enabled || !isSafeAsset(asset)) return false;
      this.style = this.document.createElement("style");
      this.style.dataset.browserToolboxCursor = "true";
      const metadata = readPngAsset(asset);
      const x = Math.max(0, Math.min(metadata.width - 1, Number(settings.hotspotX) || 0));
      const y = Math.max(0, Math.min(metadata.height - 1, Number(settings.hotspotY) || 0));
      this.style.textContent = `*{cursor:url("${asset}") ${x} ${y},auto!important}`;
      this.document.documentElement.appendChild(this.style);
      return true;
    }

    clear() {
      this.style?.remove();
      this.style = null;
    }
  }

  globalThis.BrowserToolboxCursorController = CursorController;
  globalThis.BrowserToolboxCursorAsset = Object.freeze({
    isSafeAsset,
    readPngAsset,
    MAX_BYTES,
    MAX_DIMENSION,
  });
})();

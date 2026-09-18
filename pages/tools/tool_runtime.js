// 工具页共享运行时：输入、输出、复制和下载都留在本地扩展页面内。
(function () {
  const MAX_RENDER_BYTES = 10 * 1024 * 1024;

  function byteLength(value) {
    return new TextEncoder().encode(String(value)).byteLength;
  }

  function assertInput(input, descriptor) {
    if (typeof input !== "string") throw new Error("工具输入必须是文本。");
    if (byteLength(input) > Math.min(descriptor.maxInputBytes, MAX_RENDER_BYTES)) {
      throw new Error("输入超过此工具的本地大小限制。");
    }
    return input;
  }

  async function copyText(value) {
    const text = String(value);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.setAttribute("aria-hidden", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch (_) {
        copied = false;
      }
      textarea.remove();
      return copied;
    }
  }

  function downloadText(value, filename, mime = "text/plain;charset=utf-8") {
    downloadBytes(String(value), filename, mime);
  }

  function downloadBytes(value, filename, mime = "application/octet-stream") {
    const blob = new Blob([value], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  globalThis.BrowserToolboxToolRuntime = Object.freeze({
    MAX_RENDER_BYTES,
    byteLength,
    assertInput,
    copyText,
    downloadText,
    downloadBytes,
    randomBytes,
  });
})();

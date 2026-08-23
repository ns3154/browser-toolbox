// 超级拖拽上下文分类器。文件上传、编辑器和密码框优先走浏览器原生行为。
(function () {
  const blockedProtocols = new Set(["javascript:", "data:", "blob:"]);

  function parentElement(element) {
    if (!element) return null;
    if (element.parentElement) return element.parentElement;
    return element.getRootNode?.().host || null;
  }

  function closest(element, selector) {
    let current = element;
    while (current) {
      if (current.matches?.(selector)) return current;
      current = parentElement(current);
    }
    return null;
  }

  function safeUrl(value) {
    try {
      const url = new URL(value, globalThis.location?.href || "https://openkeymouse.invalid/");
      if (blockedProtocols.has(url.protocol)) return null;
      if (!globalThis.OpenKeyMouseCommandInvocation?.isAllowedUrl(url.href)) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function isProtectedTarget(target) {
    return Boolean(
      closest(
        target,
        "input[type=file], input[type=password], textarea, [contenteditable='true'], [contenteditable=''], canvas, webview, .monaco-editor, .CodeMirror, .ace_editor",
      ),
    );
  }

  function classify(target, selectedText = "", dataTransfer = null, composedPath = []) {
    const pathTarget = Array.isArray(composedPath)
      ? composedPath.find((item) => item?.nodeType === 1)
      : null;
    const actualTarget = pathTarget || target;
    if (!actualTarget || isProtectedTarget(actualTarget)) {
      return { type: "UNSUPPORTED_NATIVE_DRAG", reason: "protected-target" };
    }
    if (dataTransfer?.files?.length) {
      return { type: "UNSUPPORTED_NATIVE_DRAG", reason: "file-drag" };
    }
    const link = closest(actualTarget, "a[href], area[href]");
    if (link) {
      const linkUrl = safeUrl(link.href || link.getAttribute("href"));
      if (!linkUrl) return { type: "UNSUPPORTED_NATIVE_DRAG", reason: "invalid-link" };
      return {
        type: "LINK",
        linkUrl,
        linkText: (link.innerText || link.textContent || "").trim().slice(0, 4096),
      };
    }
    const image = closest(actualTarget, "img[src], picture img");
    if (image) {
      const imageUrl = safeUrl(image.currentSrc || image.src);
      if (!imageUrl) return { type: "UNSUPPORTED_NATIVE_DRAG", reason: "invalid-image" };
      return { type: "IMAGE", imageUrl };
    }
    if (closest(actualTarget, "[draggable='true']")) {
      return { type: "UNSUPPORTED_NATIVE_DRAG", reason: "custom-draggable" };
    }
    const text = typeof selectedText === "string" ? selectedText.trim().slice(0, 16384) : "";
    if (text && !closest(actualTarget, "input, textarea, [contenteditable]")) {
      return { type: "SELECTED_TEXT", selectedText: text };
    }
    return { type: "UNSUPPORTED_NATIVE_DRAG", reason: "no-supported-object" };
  }

  globalThis.OpenKeyMouseDragContextClassifier = Object.freeze({
    classify,
    safeUrl,
    isProtectedTarget,
  });
})();

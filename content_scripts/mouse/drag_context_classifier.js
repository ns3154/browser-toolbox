// 超级拖拽上下文分类器。文件上传、编辑器和密码框优先走浏览器原生行为。
(function () {
  const blockedProtocols = new Set(["javascript:", "data:", "blob:"]);
  const resizeCursors = new Set([
    "col-resize",
    "row-resize",
    "n-resize",
    "s-resize",
    "e-resize",
    "w-resize",
    "ne-resize",
    "nw-resize",
    "se-resize",
    "sw-resize",
    "ew-resize",
    "ns-resize",
    "nesw-resize",
    "nwse-resize",
  ]);
  const nativeResizeHandleSize = 16;

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

  function eventTarget(target, composedPath) {
    return (Array.isArray(composedPath)
      ? composedPath.find((item) => item?.nodeType === 1)
      : null) || target;
  }

  function selectedTextAtTarget(selection, target, composedPath = []) {
    const text = selection?.toString?.() || "";
    const actualTarget = eventTarget(target, composedPath);
    if (!text || !actualTarget) return "";
    // 旧选区不能把在其他控件上开始的普通拖动误判为文字拖拽。
    if (typeof selection.getRangeAt === "function" && Number.isInteger(selection.rangeCount)) {
      let intersects = false;
      for (let index = 0; index < selection.rangeCount; index++) {
        if (selection.getRangeAt(index).intersectsNode(actualTarget)) {
          intersects = true;
          break;
        }
      }
      if (!intersects) return "";
    }
    return text;
  }

  function isResizeHandle(event, customCursorStyle = null) {
    const target = eventTarget(event.target, event.composedPath?.());
    const view = target?.ownerDocument?.defaultView;
    if (!target || typeof view?.getComputedStyle !== "function") return false;
    const targetStyle = view.getComputedStyle(target);
    const cursor = targetStyle.cursor.split(",").at(-1).trim();
    if (resizeCursors.has(cursor)) return true;
    const cursorSheet = customCursorStyle?.sheet;
    if (cursorSheet && !cursorSheet.disabled && targetStyle.cursor.includes("url(")) {
      try {
        // 自定义指针会覆盖站点的缩放光标，短暂读取原站点样式后立即恢复。
        cursorSheet.disabled = true;
        const nativeCursor = view.getComputedStyle(target).cursor.split(",").at(-1).trim();
        if (resizeCursors.has(nativeCursor)) return true;
      } finally {
        cursorSheet.disabled = false;
      }
    }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;

    for (let element = target; element; element = parentElement(element)) {
      if (typeof element.getBoundingClientRect !== "function") continue;
      const style = element === target ? targetStyle : view.getComputedStyle(element);
      if (!style.resize || style.resize === "none") continue;
      if (
        ["visible", "clip", ""].includes(style.overflowX || style.overflow) &&
        ["visible", "clip", ""].includes(style.overflowY || style.overflow)
      ) continue;
      const rect = element.getBoundingClientRect();
      const scaleX = element.offsetWidth ? rect.width / element.offsetWidth : 1;
      const scaleY = element.offsetHeight ? rect.height / element.offsetHeight : 1;
      const bottomEdge = rect.bottom - (parseFloat(style.borderBottomWidth) || 0) * scaleY;
      const bottom = event.clientY >= bottomEdge - nativeResizeHandleSize * scaleY &&
        event.clientY <= bottomEdge;
      const sideEdge = style.direction === "rtl"
        ? rect.left + (parseFloat(style.borderLeftWidth) || 0) * scaleX
        : rect.right - (parseFloat(style.borderRightWidth) || 0) * scaleX;
      const side = style.direction === "rtl"
        ? event.clientX >= sideEdge && event.clientX <= sideEdge + nativeResizeHandleSize * scaleX
        : event.clientX <= sideEdge && event.clientX >= sideEdge - nativeResizeHandleSize * scaleX;
      // 浏览器原生缩放角标位于滚动容器的底角；容器其他位置仍可拖拽文字、链接和图片。
      if (bottom && side) return true;
    }
    return false;
  }

  function safeUrl(value) {
    try {
      const url = new URL(value, globalThis.location?.href || "https://browsertoolbox.invalid/");
      if (blockedProtocols.has(url.protocol)) return null;
      if (!globalThis.BrowserToolboxCommandInvocation?.isAllowedUrl(url.href)) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function isProtectedTarget(target) {
    return Boolean(
      closest(
        target,
        "input, textarea, [contenteditable='true'], [contenteditable=''], canvas, webview, .monaco-editor, .CodeMirror, .ace_editor",
      ),
    );
  }

  function classify(target, selectedText = "", dataTransfer = null, composedPath = []) {
    const actualTarget = eventTarget(target, composedPath);
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

  globalThis.BrowserToolboxDragContextClassifier = Object.freeze({
    classify,
    safeUrl,
    isProtectedTarget,
    isResizeHandle,
    selectedTextAtTarget,
  });
})();

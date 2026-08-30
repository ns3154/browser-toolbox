// 顶层原始文档格式化控制器：普通 HTML、iframe 和受限页面都保持原样。
(function () {
  const formatter = globalThis.BrowserToolboxDocumentFormatters;
  const AUTO_MAX_BYTES = formatter.AUTO_MAX_BYTES;
  const CONFIRM_MAX_BYTES = formatter.CONFIRM_MAX_BYTES;
  const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
  let state = null;
  let initializing = false;

  const message = (key) => globalThis.BrowserToolboxI18n?.message(key) || key;

  function isTopLevel() {
    try {
      return globalThis.top === globalThis;
    } catch (_) {
      return false;
    }
  }

  function readBodySource() {
    const body = document.body;
    if (!body) return "";
    const pre = body.children.length === 1 && body.firstElementChild?.tagName === "PRE"
      ? body.firstElementChild
      : null;
    return String(pre?.textContent ?? body.textContent ?? "");
  }

  function readSource() {
    const bodySource = readBodySource();
    if (!/^(?:application|text)\/[^;]*xml(?:;|$)/i.test(document.contentType || "")) {
      return bodySource;
    }
    // Chrome XML 查看器会在隐藏 source 节点保留解析后的源码树；只读取其序列化文本，避免
    // 重新请求当前 URL。声明和 DOCTYPE 若被浏览器查看器省略，则由原始页面恢复按钮保留查看器快照。
    const viewerSource = document.querySelector("#webkit-xml-viewer-source-xml");
    const serializer = globalThis.XMLSerializer ? new XMLSerializer() : null;
    const source = serializer && viewerSource
      ? Array.from(viewerSource.childNodes, (node) => serializer.serializeToString(node)).join("")
      : "";
    return source || bodySource;
  }

  function createElement(tagName) {
    return document.createElementNS?.(HTML_NAMESPACE, tagName) || document.createElement(tagName);
  }

  function createButton(label, handler, action = "") {
    const button = createElement("button");
    button.className = "browser-toolbox-document-toolbar-button";
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.title = label;
    if (action) button.dataset.documentAction = action;
    button.addEventListener("click", handler);
    return button;
  }

  function showFailureNotice(error) {
    if (!document.body || document.querySelector(".browser-toolbox-document-notice")) return;
    const notice = createElement("div");
    notice.className = "browser-toolbox-document-notice";
    notice.setAttribute("role", "alert");
    const text = createElement("span");
    const detail = String(error?.message || message("documentFormatterKeptOriginal")).slice(0, 240);
    text.textContent = `${message("documentFormatterKeptOriginal")}: ${detail}`;
    const close = createButton(message("close"), () => notice.remove());
    close.className = "browser-toolbox-document-notice-close";
    notice.append(text, close);
    document.body.append(notice);
  }

  function createToolbar(kind) {
    const toolbar = createElement("div");
    toolbar.className = "browser-toolbox-document-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", message("documentFormatterToolbar"));
    const status = createElement("span");
    status.className = "browser-toolbox-document-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const brand = createElement("div");
    brand.className = "browser-toolbox-document-brand";
    const icon = createElement("span");
    icon.className = "browser-toolbox-document-brand-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "{}";
    const label = createElement("strong");
    const formatName = { json: "JSON", xml: "XML", css: "CSS", javascript: "JavaScript", java: "Java" }[kind] || kind;
    label.textContent = `${formatName} ${message("documentFormatterTitleSuffix")}`;
    brand.append(icon, label);
    const brandGroup = createElement("div");
    brandGroup.className = "browser-toolbox-document-brand-group";
    brandGroup.append(brand, status);
    toolbar.append(brandGroup);

    const indent = createElement("select");
    indent.setAttribute("aria-label", message("documentFormatterIndent"));
    for (const value of ["2", "4", "8", "tab"]) {
      const option = createElement("option");
      option.value = value;
      option.textContent = value === "tab"
        ? message("documentFormatterTab")
        : `${value} ${message("documentFormatterSpaces")}`;
      indent.append(option);
    }
    indent.addEventListener("change", () => render({ indent: indent.value }));
    toolbar.append(indent);

    if (kind === "json") {
      const sort = createElement("select");
      sort.setAttribute("aria-label", message("documentFormatterSortAria"));
      for (const [value, label] of [
        ["original", message("documentFormatterKeepOrder")],
        ["ascending", message("documentFormatterSortAscending")],
        ["descending", message("documentFormatterSortDescending")],
      ]) {
        const option = createElement("option");
        option.value = value;
        option.textContent = label;
        sort.append(option);
      }
      sort.addEventListener("change", () => render({ sortOrder: sort.value }));
      toolbar.append(sort);
      toolbar.append(createButton(message("documentFormatterRepair"), () => repairMojibake(), "repair-mojibake"));
      toolbar.append(createButton(message("documentFormatterUndoRepair"), () => undoRepair(), "undo-repair"));
      toolbar.append(createButton(message("documentFormatterCollapse"), () => {
        state?.collapsedPaths.clear();
        render({ collapseDepth: 1 });
      }, "collapse"));
      toolbar.append(createButton(message("documentFormatterExpand"), () => {
        state?.collapsedPaths.clear();
        render({ collapseDepth: null });
      }, "expand"));
      toolbar._sort = sort;
    }
    toolbar.append(createButton(message("documentFormatterCopy"), () => copyOutput(), "copy"));
    toolbar.append(createButton(message("documentFormatterDownload"), () => downloadOutput(), "download"));
    const originalView = createButton(message("documentFormatterViewOriginal"), () => toggleOriginalView(), "toggle-original");
    toolbar.append(originalView);
    toolbar.append(createButton(message("documentFormatterRestore"), () => restoreOriginal(), "restore-original"));
    toolbar._status = status;
    toolbar._indent = indent;
    toolbar._originalView = originalView;
    return toolbar;
  }

  function createMetadataPanel() {
    const details = createElement("details");
    details.className = "browser-toolbox-document-metadata";
    const summary = createElement("summary");
    summary.textContent = message("documentFormatterMetadata");
    const list = createElement("dl");
    details.append(summary, list);
    details._list = list;
    return details;
  }

  function renderMetadata(panel, metadata, currentState) {
    if (!panel?._list) return;
    const labels = {
      characters: "documentFormatterCharacters",
      bytes: "documentFormatterBytes",
      rootType: "documentFormatterRootType",
      objects: "documentFormatterObjects",
      arrays: "documentFormatterArrays",
      keys: "documentFormatterKeys",
      strings: "documentFormatterStrings",
      numbers: "documentFormatterNumbers",
      booleans: "documentFormatterBooleans",
      nulls: "documentFormatterNulls",
      maxDepth: "documentFormatterMaxDepth",
      duplicateKeys: "documentFormatterDuplicateKeys",
      duplicateKeyPositions: "documentFormatterDuplicateKeyPositions",
      unsafeNumbers: "documentFormatterUnsafeNumbers",
      contentType: "documentFormatterContentType",
      charset: "documentFormatterCharset",
      parseMs: "documentFormatterParseMs",
      renderMs: "documentFormatterRenderMs",
      sortOrder: "documentFormatterSortState",
      collapseDepth: "documentFormatterCollapseState",
      repairApplied: "documentFormatterRepairState",
    };
    panel._list.replaceChildren();
    const values = {
      ...metadata,
      contentType: currentState?.contentType || "",
      charset: currentState?.charset || "",
      collapseDepth: currentState?.collapseDepth == null
        ? message("documentFormatterExpanded")
        : currentState.collapseDepth,
      repairApplied: currentState?.repairApplied
        ? message("documentFormatterApplied")
        : message("documentFormatterNotApplied"),
    };
    for (const [key, labelKey] of Object.entries(labels)) {
      if (values[key] == null) continue;
      const name = createElement("dt");
      name.textContent = message(labelKey);
      const value = createElement("dd");
      value.textContent = typeof values[key] === "object"
        ? JSON.stringify(values[key])
        : String(values[key]);
      panel._list.append(name, value);
    }
  }

  function appendHighlightedText(root, text, kind) {
    const fragment = document.createDocumentFragment();
    const pattern = kind === "css"
      ? /(\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[0-9a-f]{3,8}\b|\b\d+(?:\.\d+)?\b)/gi
      : /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b(?:true|false|null|class|interface|enum|record|public|private|protected|static|final|return|const|let|var|function|import|package|new|if|else|for|while)\b)/g;
    let last = 0;
    for (const match of String(text).matchAll(pattern)) {
      if (match.index > last) fragment.append(document.createTextNode(text.slice(last, match.index)));
      const span = createElement("span");
      const token = match[0];
      span.className = token.startsWith("/") ? "browser-toolbox-token-comment"
        : token.startsWith('"') || token.startsWith("'") || token.startsWith("`")
        ? "browser-toolbox-token-string"
        : /^\d/.test(token) ? "browser-toolbox-token-number" : "browser-toolbox-token-keyword";
      span.textContent = token;
      fragment.append(span);
      last = match.index + token.length;
    }
    if (last < String(text).length) fragment.append(document.createTextNode(String(text).slice(last)));
    root.append(fragment);
  }

  function appendIndent(root, indent, level) {
    root.append(document.createTextNode(indent.repeat(level)));
  }

  function appendToggle(root, text, path, expanded) {
    const button = createElement("button");
    button.type = "button";
    button.className = "browser-toolbox-json-toggle";
    button.textContent = text;
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute(
      "aria-label",
      expanded ? message("documentFormatterCollapseNode") : message("documentFormatterExpandNode"),
    );
    button.title = button.getAttribute("aria-label");
    button.addEventListener("click", () => {
      if (expanded) state.collapsedPaths.add(path);
      else state.collapsedPaths.delete(path);
      render();
    });
    root.append(button);
  }

  function orderedEntries(node) {
    if (!state || !state.sortOrder || state.sortOrder === "original") return node.entries;
    return node.entries.map((entry, index) => ({ entry, index })).sort((left, right) => {
      const compare = formatter.compareCodePoints
        ? formatter.compareCodePoints(left.entry.keyValue, right.entry.keyValue)
        : left.entry.keyValue.localeCompare(right.entry.keyValue);
      return (state.sortOrder === "descending" ? -1 : 1) * compare || left.index - right.index;
    }).map(({ entry }) => entry);
  }

  function shouldCollapse(path, level) {
    return state.collapsedPaths.has(path) ||
      (state.collapseDepth != null && level >= state.collapseDepth);
  }

  function appendJsonNode(root, node, level, path) {
    const indent = state.indent === "tab" ? "\t" : " ".repeat(Number(state.indent));
    if (node.kind === "literal" || node.kind === "number" || node.kind === "string") {
      appendHighlightedText(root, node.raw, "json");
      return;
    }
    const isObject = node.kind === "object";
    const items = isObject ? orderedEntries(node) : node.items;
    const open = isObject ? "{" : "[";
    const close = isObject ? "}" : "]";
    if (items.length === 0) {
      root.append(document.createTextNode(open + close));
      return;
    }
    const collapsed = shouldCollapse(path, level);
    appendToggle(root, collapsed ? `${open}…${close}` : open, path, !collapsed);
    if (collapsed) return;
    items.forEach((item, index) => {
      root.append(document.createTextNode("\n"));
      appendIndent(root, indent, level + 1);
      if (isObject) {
        appendHighlightedText(root, item.key.raw, "json");
        root.append(document.createTextNode(": "));
        appendJsonNode(root, item.value, level + 1, `${path}.${index}`);
      } else {
        appendJsonNode(root, item, level + 1, `${path}.${index}`);
      }
      if (index < items.length - 1) root.append(document.createTextNode(","));
    });
    root.append(document.createTextNode("\n"));
    appendIndent(root, indent, level);
    root.append(document.createTextNode(close));
  }

  function render(overrides = {}) {
    if (!state) return;
    Object.assign(state, overrides);
    if (state.showingOriginal) {
      state.output.replaceChildren(document.createTextNode(state.originalSource));
      state.toolbar._originalView.textContent = message("documentFormatterRestoreView");
      state.toolbar._status.textContent = message("documentFormatterShowingOriginal");
      return;
    }
    const options = {
      indent: state.indent,
      indentSize: state.indent === "tab" ? 2 : Number(state.indent),
      sortOrder: state.sortOrder,
      collapseDepth: state.collapseDepth,
    };
    try {
      const started = globalThis.performance?.now?.() ?? Date.now();
      const fullResult = formatter.formatDocument(state.workingSource, state.kind, {
        ...options,
        collapseDepth: null,
      });
      state.formatted = fullResult.formatted;
      state.root = fullResult.root || null;
      state.metadata = {
        ...fullResult.metadata,
        renderMs: (globalThis.performance?.now?.() ?? Date.now()) - started,
      };
      state.output.replaceChildren();
      if (state.kind === "json" && state.root) appendJsonNode(state.output, state.root, 0, "root");
      else appendHighlightedText(state.output, fullResult.formatted, state.kind);
      renderMetadata(state.metadataPanel, state.metadata, state);
      state.toolbar._originalView.textContent = message("documentFormatterViewOriginal");
      state.toolbar._status.textContent = `${state.kind} · ${fullResult.metadata.bytes || 0} ${message("documentFormatterBytes")}`;
      if (state.kind === "json") {
        state.toolbar._status.textContent += ` · ${message("documentFormatterKeys")} ${fullResult.metadata.keys || 0}`;
        if (fullResult.metadata.duplicateKeys > 0) {
          state.toolbar._status.textContent += ` · ${message("documentFormatterDuplicateKeys")} ${fullResult.metadata.duplicateKeys}`;
        }
      }
    } catch (error) {
      state.formatted = state.workingSource;
      state.output.replaceChildren(document.createTextNode(state.workingSource));
      state.toolbar._status.textContent = `${message("documentFormatterKeptOriginal")}: ${error.message}`;
    }
  }

  async function copyOutput() {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.formatted);
      state.toolbar._status.textContent = message("documentFormatterCopied");
    } catch (_) {
      state.toolbar._status.textContent = message("documentFormatterCopyUnavailable");
    }
  }

  function downloadOutput() {
    if (!state) return;
    const blob = new Blob([state.formatted], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = createElement("a");
    anchor.href = url;
    anchor.download = downloadFilename(state.kind);
    anchor.click();
    URL.revokeObjectURL(url);
    state.toolbar._status.textContent = message("documentFormatterDownloaded");
  }

  function downloadFilename(kind) {
    const original = String(location.pathname || "").split("/").at(-1)
      ?.replace(/[^a-zA-Z0-9._-]/g, "") || "formatted";
    if (kind === "json" && /\.json$/i.test(original)) {
      return `${original.replace(/\.json$/i, "")}.formatted.json`;
    }
    return original.includes(".") ? `${original}.formatted.txt` : `formatted.${kind}.txt`;
  }

  function repairMojibake() {
    if (!state || state.kind !== "json") return;
    const candidate = formatter.repairMojibake(state.workingSource);
    if (!candidate.changed) {
      state.toolbar._status.textContent = message("documentFormatterNoRepair");
      return;
    }
    const preview = [
      message("documentFormatterRepairConfirm"),
      `${message("documentFormatterRepairPreviewCount")}: ${candidate.count}`,
      `${message("documentFormatterRepairPreviewBefore")}: ${candidate.previewBefore}`,
      `${message("documentFormatterRepairPreviewAfter")}: ${candidate.previewAfter}`,
    ].join("\n\n");
    if (!globalThis.confirm?.(preview)) return;
    state.workingSource = candidate.value;
    state.repairApplied = true;
    render();
    state.toolbar._status.textContent += ` · ${message("documentFormatterRepairApplied")}`;
  }

  function undoRepair() {
    if (!state?.repairApplied) return;
    state.workingSource = state.originalSource;
    state.repairApplied = false;
    render();
  }

  function toggleOriginalView() {
    if (!state) return;
    state.showingOriginal = !state.showingOriginal;
    render();
  }

  function restoreOriginal() {
    if (!state) return;
    document.body.classList.remove("browser-toolbox-document-formatted");
    document.body.replaceChildren(
      ...state.originalBodyChildren.map((node) => node.cloneNode(true)),
    );
    state = null;
  }

  function start(kind, source, settings) {
    const bytes = formatter.byteLength(source);
    if (bytes > CONFIRM_MAX_BYTES) return;
    const configuredAutoMax = Number(settings?.tools?.documentFormatter?.maxAutoBytes);
    const autoMax = Number.isInteger(configuredAutoMax)
      ? Math.min(AUTO_MAX_BYTES, Math.max(0, configuredAutoMax))
      : AUTO_MAX_BYTES;
    if (bytes > autoMax && !globalThis.confirm?.(message("documentFormatterLargeConfirm"))) {
      return;
    }
    let result;
    try {
      result = formatter.formatDocument(source, kind);
    } catch (error) {
      showFailureNotice(error);
      return;
    }
    if (result.skipped) return;
    const body = document.body;
    if (!body) return;
    const output = createElement("pre");
    output.className = "browser-toolbox-document-output";
    const toolbar = createToolbar(kind);
    const metadataPanel = createMetadataPanel();
    const documentSettings = settings?.tools?.documentFormatter;
    state = {
      kind,
      originalSource: source,
      originalBodyChildren: Array.from(body.childNodes, (node) => node.cloneNode(true)),
      workingSource: source,
      formatted: result.formatted,
      root: result.root || null,
      output,
      toolbar,
      metadataPanel,
      indent: "2",
      sortOrder: documentSettings?.json?.defaultSort || "original",
      collapseDepth: documentSettings?.json?.defaultCollapseDepth ?? null,
      collapsedPaths: new Set(),
      repairApplied: false,
      showingOriginal: false,
      metadata: result.metadata,
      contentType: document.contentType || "",
      charset: document.characterSet || "",
    };
    toolbar._indent.value = state.indent;
    if (toolbar._sort) toolbar._sort.value = state.sortOrder;
    body.classList.add("browser-toolbox-document-formatted");
    body.replaceChildren(toolbar, metadataPanel, output);
    render();
  }

  async function runInit() {
    if (!isTopLevel() || !document.body) return;
    if (state || document.querySelector(".browser-toolbox-document-toolbar")) return;
    const settingsClient = globalThis.BrowserToolboxSettingsRuntimeClientInstance;
    if (!settingsClient?.ensureLoaded) return;
    let settings;
    try {
      settings = await settingsClient.ensureLoaded(location.href);
    } catch (_) {
      return;
    }
    if (
      settings?.tools?.enabled === false ||
      settings?.effectiveModules?.documentFormatter === false ||
      settings?.tools?.documentFormatter?.enabled === false
    ) return;
    const source = readSource();
    if (!source || formatter.byteLength(source) > CONFIRM_MAX_BYTES) return;
    const kind = formatter.detectDocument({
      contentType: document.contentType,
      url: location.href,
      source,
    });
    if (!kind || settings?.tools?.documentFormatter?.autoFormat?.[kind] === false) return;
    start(kind, source, settings);
  }

  async function init() {
    if (initializing) return;
    initializing = true;
    try {
      await runInit();
    } finally {
      initializing = false;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    globalThis.setTimeout(init, 0);
  }

  globalThis.BrowserToolboxDocumentFormatterController = Object.freeze({
    init,
    readSource,
  });
})();

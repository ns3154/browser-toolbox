// 独立工具页控制器：每个页面只负责当前工具，工具选择交给弹窗、右键菜单和设置页入口。
(function () {
  const registry = globalThis.BrowserToolboxToolRegistry;
  const loader = globalThis.BrowserToolboxToolLoader;
  const runtime = globalThis.BrowserToolboxToolRuntime;
  const formatter = globalThis.BrowserToolboxDocumentFormatters;
  let descriptor;
  let implementation;
  let state;
  let configView;

  const message = (key) => globalThis.BrowserToolboxI18n?.message(key) || key;
  const byId = (id) => document.querySelector(`#${id}`);
  const metadataLabels = Object.freeze({
    mode: "toolMetadataMode",
    representation: "toolMetadataRepresentation",
    outputEncoding: "toolMetadataOutputEncoding",
    inputEncoding: "toolMetadataInputEncoding",
    milliseconds: "toolMetadataMilliseconds",
    timezone: "toolMetadataTimezone",
    unit: "toolMetadataUnit",
    count: "toolMetadataCount",
    length: "toolMetadataLength",
    symbols: "toolMetadataSymbols",
    valid: "toolMetadataValid",
    operation: "toolMetadataOperation",
    expandedEscaped: "toolMetadataExpandedEscaped",
    leftLines: "toolMetadataLeftLines",
    rightLines: "toolMetadataRightLines",
    rows: "toolMetadataRows",
    columns: "toolMetadataColumns",
    formulaCells: "toolMetadataFormulaCells",
    formulaWarning: "toolMetadataFormulaWarning",
    warning: "toolMetadataWarning",
    bytes: "toolMetadataBytes",
    nodes: "toolMetadataNodes",
    strings: "toolMetadataStrings",
    numbers: "toolMetadataNumbers",
    booleans: "toolMetadataBooleans",
    nulls: "toolMetadataNulls",
    unsafeNumbers: "toolMetadataUnsafeNumbers",
    stringCharacters: "toolMetadataStringCharacters",
    characters: "toolMetadataCharacters",
    objects: "toolMetadataObjects",
    arrays: "toolMetadataArrays",
    keys: "toolMetadataKeys",
    duplicateKeys: "toolMetadataDuplicateKeys",
    duplicateKeyPositions: "toolMetadataDuplicateKeyPositions",
    maxDepth: "toolMetadataMaxDepth",
    parseMs: "toolMetadataParseMs",
    formatMs: "toolMetadataFormatMs",
    sortOrder: "toolMetadataSortOrder",
    collapsed: "toolMetadataCollapsed",
    lines: "toolMetadataLines",
    conservative: "toolMetadataConservative",
  });

  const CODEC_TYPES = Object.freeze([
    { id: "base64", labelKey: "toolCodecBase64", hintKey: "toolCodecBase64Hint", encode: "base64Encode", decode: "base64Decode" },
    { id: "url", labelKey: "toolCodecUrl", hintKey: "toolCodecUrlHint", encode: "urlEncode", decode: "urlDecode" },
    { id: "uri", labelKey: "toolCodecUri", hintKey: "toolCodecUriHint", encode: "uriEncode", decode: "uriDecode" },
    { id: "unicode", labelKey: "toolCodecUnicode", hintKey: "toolCodecUnicodeHint", encode: "unicodeEncode", decode: "unicodeDecode" },
    { id: "unicodeEscape", labelKey: "toolCodecUnicodeEscape", hintKey: "toolCodecUnicodeEscapeHint", encode: "unicodeEscapeEncode", decode: "unicodeEscapeDecode" },
    { id: "jsonString", labelKey: "toolCodecJsonString", hintKey: "toolCodecJsonStringHint", encode: "jsonStringEncode", decode: "jsonStringDecode" },
    { id: "xml", labelKey: "toolCodecXml", hintKey: "toolCodecXmlHint", encode: "xmlEncode", decode: "xmlDecode" },
    { id: "ascii", labelKey: "toolCodecAscii", hintKey: "toolCodecAsciiHint", encode: "asciiEncode", decode: "asciiDecode" },
  ]);
  const ADVANCED_CODEC_TYPES = Object.freeze([
    { id: "binary", labelKey: "toolCodecBinary", hintKey: "toolCodecBytesHint", encode: "binaryEncode", decode: "binaryDecode" },
    { id: "octal", labelKey: "toolCodecOctal", hintKey: "toolCodecBytesHint", encode: "octalEncode", decode: "octalDecode" },
    { id: "decimal", labelKey: "toolCodecDecimal", hintKey: "toolCodecBytesHint", encode: "decimalEncode", decode: "decimalDecode" },
    { id: "dataUrl", labelKey: "toolCodecDataUrl", hintKey: "toolCodecDataUrlHint", encode: "dataUrlEncode", decode: "dataUrlDecode" },
    { id: "md5", labelKey: "toolCodecMd5", hintKey: "toolCodecMd5Hint", encode: "md5" },
  ]);

  const CODEC_DIRECTIONS = ["encode", "decode"];

  function icon(name) {
    return globalThis.BrowserToolboxToolIcons?.createIcon(name, {
      className: "browser-toolbox-tool-icon",
    }) || document.createElement("span");
  }

  function setIcon(slotId, name) {
    const slot = byId(slotId);
    if (slot) slot.replaceChildren(icon(name));
  }

  function setStatus(value, error = false) {
    const status = byId("tool-status");
    if (status) {
      status.textContent = value;
      status.classList.toggle("is-error", error);
    }
  }

  function renderMetadata(metadata = {}) {
    const list = byId("tool-metadata");
    if (!list) return;
    list.replaceChildren();
    for (const [key, value] of Object.entries(metadata)) {
      if (value == null || value === "") continue;
      const name = document.createElement("dt");
      name.textContent = message(metadataLabels[key] || "toolMetadataField");
      const detail = document.createElement("dd");
      detail.textContent = typeof value === "object" ? JSON.stringify(value) : String(value);
      list.append(name, detail);
    }
  }

  function optionControl(labelKey, type, options, value) {
    const label = document.createElement("label");
    label.className = "browser-toolbox-tool-control";
    const text = document.createElement("span");
    text.textContent = message(labelKey);
    const input = document.createElement(
      type === "checkbox" ? "input" : type === "text" ? "input" : "select",
    );
    if (type === "checkbox") {
      input.type = "checkbox";
      input.checked = Boolean(value);
    } else if (type === "text") {
      input.type = "text";
      input.value = value || "";
    } else {
      for (const [optionValue, optionLabel] of options) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionLabel;
        input.append(option);
      }
      input.value = value;
    }
    label.append(text, input);
    return { label, input };
  }

  function currentInput() {
    return byId("tool-input")?.value || "";
  }

  function currentOptions() {
    if (configView) return configView.options();
    const options = {};
    for (const input of byId("tool-controls")?.querySelectorAll("[data-tool-option]") || []) {
      const key = input.dataset.toolOption;
      options[key] = input.type === "checkbox" ? input.checked : input.value;
    }
    return options;
  }

  function addControl(control, key, parent = byId("tool-controls")) {
    control.input.dataset.toolOption = key;
    control.label.dataset.toolOptionKey = key;
    control.label.classList.toggle("browser-toolbox-tool-sort-control", key === "sortOrder");
    parent?.append(control.label);
  }

  function updateJsonInputHighlight() {
    if (descriptor?.id !== "json.format") return;
    const input = byId("tool-input");
    const highlight = byId("json-input-highlight");
    if (!input || !highlight) return;
    const source = String(input.value);
    const tokenPattern = /"(?:\\.|[^"\\])*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    let cursor = 0;
    highlight.replaceChildren();
    const appendText = (text, className = "") => {
      if (!text) return;
      if (!className) {
        highlight.append(document.createTextNode(text));
        return;
      }
      const token = document.createElement("span");
      token.className = className;
      token.textContent = text;
      highlight.append(token);
    };
    for (const match of source.matchAll(tokenPattern)) {
      const start = match.index ?? cursor;
      appendText(source.slice(cursor, start));
      const value = match[0];
      const after = source.slice(start + value.length);
      const className = value.startsWith('"')
        ? /^\s*:/.test(after)
          ? "browser-toolbox-json-input-token-key"
          : "browser-toolbox-json-input-token-string"
        : /^(?:true|false|null)$/.test(value)
        ? "browser-toolbox-json-input-token-literal"
        : "browser-toolbox-json-input-token-number";
      appendText(value, className);
      cursor = start + value.length;
    }
    appendText(source.slice(cursor));
    highlight.scrollTop = input.scrollTop;
    highlight.scrollLeft = input.scrollLeft;
  }

  function updateJsonInputLineNumbers() {
    if (descriptor?.id !== "json.format") return;
    const input = byId("tool-input");
    const gutter = byId("json-input-line-numbers");
    if (!input || !gutter) return;
    const lineCount = Math.max(1, String(input.value).split(/\r?\n/).length);
    const visibleLineCount = Math.min(lineCount, 5000);
    gutter.textContent = Array.from({ length: visibleLineCount }, (_, index) => String(index + 1)).join("\n");
    if (lineCount > visibleLineCount) gutter.textContent += "\n…";
    gutter.scrollTop = input.scrollTop;
    updateJsonInputHighlight();
  }

  function jsonCursorPosition() {
    const input = byId("tool-input");
    if (!input) return { line: 1, column: 1 };
    const value = String(input.value);
    const position = Math.max(0, Math.min(value.length, input.selectionStart ?? value.length));
    const before = value.slice(0, position);
    const lineBreak = before.lastIndexOf("\n");
    return {
      line: before.split("\n").length,
      column: position - lineBreak,
    };
  }

  function updateJsonSummary(metadata = {}) {
    if (descriptor?.id !== "json.format") return;
    const summary = byId("json-tool-summary");
    if (!summary) return;
    const cursor = jsonCursorPosition();
    const rootType = metadata.rootType === "array"
      ? message("toolJsonArray")
      : metadata.rootType === "object"
      ? message("toolJsonObject")
      : message("toolJsonValue");
    const values = [
      ["json-cursor-summary", `${message("toolJsonLine")} ${cursor.line}, ${message("toolJsonColumn")} ${cursor.column}`],
      ["json-character-summary", `${message("toolJsonCharacters")} ${metadata.characters ?? 0}`],
      ["json-length-summary", `${message("toolJsonLength")} ${metadata.bytes ?? 0}`],
      ["json-type-summary", rootType],
      ["json-depth-summary", `${message("toolJsonDepth")} ${metadata.maxDepth ?? 0}`],
    ];
    for (const [id, value] of values) byId(id).textContent = value;
    summary.hidden = !state?.lastResult;
  }

  function syncJsonToolbarState() {
    const action = byId("json-compact-action");
    const operation = byId("tool-controls")?.querySelector('[data-tool-option="operation"]');
    const compact = byId("tool-controls")?.querySelector('[data-tool-option="compact"]');
    if (!action || !operation) return;
    const active = operation.value === "compact" || Boolean(compact?.checked);
    action.classList.toggle("is-active", active);
    action.setAttribute("aria-pressed", String(active));
  }

  function createJsonToolbarButton(id, labelKey, className = "", iconName = "") {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = `browser-toolbox-json-toolbar-button ${className}`.trim();
    const label = document.createElement("span");
    label.className = "browser-toolbox-json-toolbar-label";
    label.textContent = message(labelKey);
    if (iconName) button.append(icon(iconName));
    button.append(label);
    return button;
  }

  function positionJsonAdvancedPanel(advanced) {
    if (!advanced?.open) return;
    const panel = advanced.querySelector(":scope > .browser-toolbox-json-advanced-panel");
    const summary = advanced.querySelector(":scope > summary");
    if (!panel || !summary) return;
    const viewportPadding = 12;
    const panelWidth = Math.min(360, Math.max(0, globalThis.innerWidth - viewportPadding * 2));
    const maxLeft = Math.max(viewportPadding, globalThis.innerWidth - viewportPadding - panelWidth);
    const summaryRect = summary.getBoundingClientRect();
    const left = Math.min(maxLeft, Math.max(viewportPadding, summaryRect.right - panelWidth));
    const provisionalTop = summaryRect.bottom + 8;
    panel.style.setProperty("--json-advanced-panel-left", `${Math.round(left)}px`);
    panel.style.setProperty("--json-advanced-panel-top", `${Math.round(provisionalTop)}px`);
    panel.style.setProperty("--json-advanced-panel-width", `${Math.round(panelWidth)}px`);
    const panelRect = panel.getBoundingClientRect();
    const maxTop = Math.max(viewportPadding, globalThis.innerHeight - viewportPadding - panelRect.height);
    const top = Math.min(maxTop, Math.max(viewportPadding, provisionalTop));
    panel.style.setProperty("--json-advanced-panel-top", `${Math.round(top)}px`);
  }

  function positionJsonSortMenu(menu, trigger) {
    if (!menu?.classList.contains("is-open") || !trigger) return;
    const viewportPadding = 12;
    const menuWidth = Math.min(180, Math.max(120, globalThis.innerWidth - viewportPadding * 2));
    const maxLeft = Math.max(viewportPadding, globalThis.innerWidth - viewportPadding - menuWidth);
    const triggerRect = trigger.getBoundingClientRect();
    const left = Math.min(maxLeft, Math.max(viewportPadding, triggerRect.right - menuWidth));
    const provisionalTop = triggerRect.bottom + 8;
    menu.style.setProperty("--json-sort-menu-left", `${Math.round(left)}px`);
    menu.style.setProperty("--json-sort-menu-top", `${Math.round(provisionalTop)}px`);
    menu.style.setProperty("--json-sort-menu-width", `${Math.round(menuWidth)}px`);
    const menuRect = menu.getBoundingClientRect();
    const maxTop = Math.max(viewportPadding, globalThis.innerHeight - viewportPadding - menuRect.height);
    const top = provisionalTop + menuRect.height <= globalThis.innerHeight - viewportPadding
      ? provisionalTop
      : triggerRect.top - menuRect.height - 8;
    menu.style.setProperty("--json-sort-menu-top", `${Math.round(Math.min(maxTop, Math.max(viewportPadding, top)))}px`);
  }

  function buildJsonControls() {
    const controls = byId("tool-controls");
    controls.replaceChildren();
    controls.classList.add("browser-toolbox-json-controls");
    const descriptorControls = new Map(descriptor.controls.map((control) => [control.key, control]));
    const createOption = (key) => {
      const control = descriptorControls.get(key);
      const options = (control.options || []).map(([value, labelKey]) => [value, message(labelKey)]);
      return optionControl(control.labelKey, control.type, options, control.defaultValue);
    };

    const runButton = byId("tool-run");
    if (runButton) {
      runButton.dataset.i18n = "toolJsonFormatOperation";
      const runLabel = document.createElement("span");
      runLabel.className = "browser-toolbox-json-toolbar-label";
      runLabel.textContent = runButton.textContent;
      runButton.replaceChildren(icon("braces"), runLabel);
    }

    const compactAction = createJsonToolbarButton("json-compact-action", "toolJsonCompactOperation", "", "compress");
    compactAction.setAttribute("aria-pressed", "false");
    compactAction.addEventListener("click", () => {
      const operation = controls.querySelector('[data-tool-option="operation"]');
      const compact = controls.querySelector('[data-tool-option="compact"]');
      if (!operation) return;
      operation.value = operation.value === "compact" ? "format" : "compact";
      if (compact) compact.checked = false;
      syncJsonToolbarState();
      run();
    });

    const operationGroup = document.createElement("div");
    operationGroup.className = "browser-toolbox-json-operation-group";
    if (runButton) operationGroup.append(runButton);
    operationGroup.append(compactAction);

    const sortControl = createOption("sortOrder");
    const sortGroup = document.createElement("div");
    sortGroup.className = "browser-toolbox-json-sort-group";
    const sortIcon = icon("sort");
    sortIcon.classList.add("browser-toolbox-json-sort-icon");
    const sortLabel = document.createElement("span");
    sortLabel.className = "browser-toolbox-json-sort-label";
    sortLabel.textContent = message("toolSort");

    const sortNativeSelect = sortControl.input;
    sortNativeSelect.classList.add("browser-toolbox-json-sort-native");
    sortNativeSelect.tabIndex = -1;
    sortNativeSelect.hidden = true;
    sortNativeSelect.setAttribute("aria-hidden", "true");
    const sortControlWrap = document.createElement("div");
    sortControlWrap.className = "browser-toolbox-tool-control browser-toolbox-json-sort-control";
    sortControl.label = sortControlWrap;

    const sortTrigger = document.createElement("button");
    sortTrigger.id = "json-sort-trigger";
    sortTrigger.type = "button";
    sortTrigger.className = "browser-toolbox-json-sort-trigger";
    sortTrigger.setAttribute("aria-haspopup", "listbox");
    sortTrigger.setAttribute("aria-expanded", "false");
    sortTrigger.setAttribute("aria-controls", "json-sort-menu");
    const sortValue = document.createElement("span");
    sortValue.className = "browser-toolbox-json-sort-value";
    const sortChevron = icon("chevron");
    sortChevron.classList.add("browser-toolbox-json-sort-chevron");
    sortTrigger.append(sortValue, sortChevron);

    const sortMenu = document.createElement("div");
    sortMenu.id = "json-sort-menu";
    sortMenu.className = "browser-toolbox-json-sort-menu";
    sortMenu.setAttribute("role", "listbox");
    for (const option of sortNativeSelect.options) {
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "browser-toolbox-json-sort-option";
      optionButton.dataset.sortValue = option.value;
      optionButton.setAttribute("role", "option");
      const optionLabel = document.createElement("span");
      optionLabel.className = "browser-toolbox-json-sort-option-label";
      optionLabel.textContent = option.textContent;
      const optionCheck = document.createElement("span");
      optionCheck.className = "browser-toolbox-json-sort-option-check";
      optionCheck.setAttribute("aria-hidden", "true");
      optionCheck.textContent = "✓";
      optionButton.append(optionLabel, optionCheck);
      optionButton.addEventListener("click", () => {
        sortNativeSelect.value = option.value;
        sortNativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        sortMenu.classList.remove("is-open");
        sortTrigger.setAttribute("aria-expanded", "false");
      });
      sortMenu.append(optionButton);
    }

    const syncSortMenu = () => {
      const selected = [...sortNativeSelect.options].find((option) => option.value === sortNativeSelect.value);
      sortValue.textContent = selected?.textContent || "";
      sortTrigger.setAttribute("aria-label", `${message("toolSort")}: ${sortValue.textContent}`);
      for (const optionButton of sortMenu.querySelectorAll("[role=option]")) {
        const selectedOption = optionButton.dataset.sortValue === sortNativeSelect.value;
        optionButton.setAttribute("aria-selected", String(selectedOption));
      }
    };
    sortNativeSelect.addEventListener("change", syncSortMenu);
    sortControlWrap.append(sortNativeSelect, sortTrigger);

    addControl(sortControl, "sortOrder", sortGroup);
    sortGroup.prepend(sortIcon, sortLabel);
    sortGroup.append(sortMenu);

    const advanced = document.createElement("details");
    advanced.className = "browser-toolbox-json-advanced";
    const advancedSummary = document.createElement("summary");
    advancedSummary.append(icon("more"));
    const advancedLabel = document.createElement("span");
    advancedLabel.className = "browser-toolbox-json-toolbar-label";
    advancedLabel.textContent = message("toolJsonMoreOptions");
    advancedSummary.append(advancedLabel);
    const advancedPanel = document.createElement("div");
    advancedPanel.className = "browser-toolbox-json-advanced-panel";
    const advancedKeys = ["operation", "indent", "compact", "expandEscaped", "repair"];
    for (const key of advancedKeys) {
      const control = createOption(key);
      addControl(control, key, advancedPanel);
    }
    const fileControl = byId("tool-file")?.closest(".browser-toolbox-tool-file");
    if (fileControl) advancedPanel.append(fileControl);
    const restore = createJsonToolbarButton("json-restore-action", "toolRestore");
    restore.addEventListener("click", () => restoreInput());
    advancedPanel.append(restore);
    advanced.append(advancedSummary, advancedPanel);
    const setSortMenuOpen = (open) => {
      sortMenu.classList.toggle("is-open", open);
      sortTrigger.setAttribute("aria-expanded", String(open));
      if (open) {
        advanced.open = false;
        globalThis.requestAnimationFrame(() => positionJsonSortMenu(sortMenu, sortTrigger));
      }
    };
    sortTrigger.addEventListener("click", () => setSortMenuOpen(!sortMenu.classList.contains("is-open")));
    advancedSummary.addEventListener("click", () => setSortMenuOpen(false));
    const repositionPanels = () => {
      positionJsonAdvancedPanel(advanced);
      positionJsonSortMenu(sortMenu, sortTrigger);
    };
    advanced.addEventListener("toggle", () => {
      if (advanced.open) globalThis.requestAnimationFrame(repositionPanels);
    });
    document.addEventListener("click", (event) => {
      if (!advanced.contains(event.target)) advanced.open = false;
      if (!sortGroup.contains(event.target)) setSortMenuOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (advanced.open) advanced.open = false;
      if (sortMenu.classList.contains("is-open")) {
        setSortMenuOpen(false);
        sortTrigger.focus();
      }
    });
    globalThis.addEventListener("resize", repositionPanels);
    globalThis.addEventListener("scroll", repositionPanels, { passive: true });
    byId("tool-header-toolbar")?.addEventListener("scroll", repositionPanels, { passive: true });
    controls.append(operationGroup, sortGroup, advanced);
    syncSortMenu();
    syncJsonToolbarState();
  }

  function buildCodecLayout() {
    const workspace = byId("tool-workspace");
    const header = document.querySelector(".browser-toolbox-tools-header");
    const toolbar = byId("tool-header-toolbar");
    const localNote = header.querySelector(".browser-toolbox-local-badge");
    localNote.dataset.i18n = "toolCodecLocalOnly";
    localNote.textContent = message("toolCodecLocalOnly");
    localNote.after(byId("tool-restore"));
    const restoreLabel = document.createElement("span");
    restoreLabel.id = "codec-restore-label";
    byId("tool-restore").append(restoreLabel);
    toolbar.querySelector(".browser-toolbox-tool-actions").hidden = true;
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", message("toolCodecType"));
    header.after(toolbar);
    workspace.removeAttribute("aria-labelledby");
    workspace.setAttribute("aria-label", message("toolCodecTransform"));

    const inputPanel = document.createElement("section");
    inputPanel.className = "browser-toolbox-codec-input-panel";
    inputPanel.setAttribute("aria-labelledby", "tool-input-title");
    const inputHeading = document.querySelector(".browser-toolbox-workspace-heading");
    inputHeading.classList.add("browser-toolbox-codec-pane-heading");
    inputHeading.firstElementChild.classList.add("browser-toolbox-codec-pane-label");
    inputHeading.firstElementChild.append(byId("tool-input-label"));
    byId("tool-input").setAttribute("aria-labelledby", "tool-input-title");
    byId("tool-input").setAttribute("aria-describedby", "tool-input-label codec-type-hint");

    const inputActions = document.createElement("div");
    inputActions.className = "browser-toolbox-codec-actions";
    const fileControl = document.querySelector(".browser-toolbox-tool-file");
    const fileButton = byId("tool-file-trigger");
    const fileLabel = document.createElement("span");
    fileLabel.textContent = message("toolFileChoose");
    fileButton.removeAttribute("data-i18n");
    fileButton.className = "browser-toolbox-codec-button";
    fileButton.replaceChildren(icon("document"), fileLabel);
    const clearButton = document.createElement("button");
    clearButton.id = "codec-clear";
    clearButton.type = "button";
    clearButton.className = "browser-toolbox-codec-button";
    clearButton.textContent = message("toolCodecClear");
    clearButton.addEventListener("click", clearCodecInput);
    inputActions.append(fileControl, clearButton);
    inputHeading.append(inputActions);

    const inputGrid = document.querySelector(".browser-toolbox-tool-input-grid");
    const oldInputWrap = inputGrid.querySelector('label[for="tool-input"]');
    const inputWrap = document.createElement("div");
    inputWrap.className = oldInputWrap.className;
    inputWrap.append(...oldInputWrap.childNodes);
    oldInputWrap.replaceWith(inputWrap);
    inputPanel.append(inputHeading, inputGrid);
    workspace.prepend(inputPanel);

    const fileSource = document.createElement("div");
    fileSource.id = "codec-file-source";
    fileSource.hidden = true;
    const fileInfo = document.createElement("p");
    fileInfo.id = "codec-file-info";
    const useText = document.createElement("button");
    useText.type = "button";
    useText.className = "browser-toolbox-codec-button";
    useText.textContent = message("toolCodecUseText");
    useText.addEventListener("click", clearCodecInput);
    fileSource.append(icon("document"), fileInfo, useText);
    inputGrid.querySelector(".browser-toolbox-tool-editor").append(fileSource);

    for (const direction of CODEC_DIRECTIONS) {
      setIcon(`codec-${direction}-copy-icon`, "copy");
      setIcon(`codec-${direction}-download-icon`, "download");
      byId(`codec-${direction}-copy`).addEventListener("click", () => copyCodecResult(direction));
      byId(`codec-${direction}-download`).addEventListener(
        "click",
        () => downloadCodecResult(direction),
      );
    }
    byId("tool-restore").className = "browser-toolbox-codec-button";
    byId("codec-statusbar").prepend(byId("tool-status"));
    byId("codec-statusbar").hidden = false;
    byId("codec-results").hidden = false;
    document.querySelector(".browser-toolbox-tool-footer").hidden = true;
    updateFileName();
  }

  function clearCodecInput() {
    const input = byId("tool-input");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  function activeCodecFile() {
    return state.codecType.id === "dataUrl" ? state.codecFile : null;
  }

  function updateCodecFileSource() {
    const file = activeCodecFile();
    byId("codec-file-source").hidden = !file;
    byId("tool-input").hidden = Boolean(file);
    if (file) {
      byId("codec-file-info").textContent = `${file.name}\n${
        file.mime || "application/octet-stream"
      } · ${file.bytes.length.toLocaleString()} ${message("toolCodecByteUnit")}`;
    }
  }

  function updateCodecRestoreLabel() {
    const key = state.originalInput || state.originalFilename
      ? "toolRestore"
      : "toolCodecRestoreExample";
    byId("codec-restore-label").textContent = message(key);
    const button = byId("tool-restore");
    button.dataset.i18nAriaLabel = key;
    button.dataset.i18nTitle = key;
    button.setAttribute("aria-label", message(key));
    button.title = message(key);
  }

  function markCodecSelection() {
    const type = state.codecType;
    for (const button of byId("tool-controls").querySelectorAll("[data-codec-type]")) {
      button.setAttribute("aria-pressed", String(button.dataset.codecType === type.id));
    }
    byId("codec-type-hint").textContent = message(type.hintKey);
    byId("codec-encode-title").textContent = message(
      type.decode ? "toolCodecEncodeResult" : "toolCodecDigestResult",
    );
    const fileInput = byId("tool-file");
    if (!fileInput.dataset.textAccept) fileInput.dataset.textAccept = fileInput.accept;
    fileInput.accept = type.id === "dataUrl" ? "" : fileInput.dataset.textAccept;
    updateCodecFileSource();
  }

  function selectCodecType(type) {
    if (state.codecType === type) return;
    state.codecType = type;
    state.inputRevision++;
    markCodecSelection();
    clearResult();
    scheduleAutoRun();
  }

  function buildCodecControls() {
    const controls = byId("tool-controls");
    controls.classList.add("browser-toolbox-codec-controls");
    for (
      const [types, labelKey, hintKey] of [
        [CODEC_TYPES, "toolCodecCommon", "toolCodecLiveHint"],
        [ADVANCED_CODEC_TYPES, "toolCodecMore", null],
      ]
    ) {
      const row = document.createElement("div");
      row.className = "browser-toolbox-codec-format-row";
      const label = document.createElement("span");
      label.textContent = message(labelKey);
      const options = document.createElement("div");
      options.className = "browser-toolbox-codec-formats";
      options.setAttribute("role", "group");
      options.setAttribute("aria-label", label.textContent);
      for (const type of types) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "browser-toolbox-codec-format";
        button.dataset.codecType = type.id;
        button.textContent = message(type.labelKey);
        button.addEventListener("click", () => selectCodecType(type));
        options.append(button);
      }
      const hint = document.createElement("p");
      if (hintKey) hint.textContent = message(hintKey);
      else hint.id = "codec-type-hint";
      row.append(label, options, hint);
      controls.append(row);
    }
    markCodecSelection();
  }

  function renderCodecResult(direction, { result = null, note = "" } = {}) {
    state.codecResults[direction] = result;
    const pane = byId(`codec-${direction}-result`);
    const output = pane.querySelector("pre");
    output.textContent = result?.output ?? "";
    output.hidden = !result;
    byId(`codec-${direction}-note`).textContent = note;
    byId(`codec-${direction}-copy`).disabled = !result || Boolean(result.binary);
    byId(`codec-${direction}-download`).disabled = !result;

    const labels = [message(state.codecType.labelKey)];
    if (result?.binary) {
      labels.push(
        result.metadata.mime,
        `${result.metadata.bytes.toLocaleString()} ${message("toolCodecByteUnit")}`,
      );
    } else if (result) {
      labels.push(
        message("toolCodecCharacterCount").replace(
          "{count}",
          result.output.length.toLocaleString(),
        ),
      );
    } else if (direction === "decode" && state.codecType.decode) {
      labels.push(message("toolDecode"));
    }
    pane.querySelector(".browser-toolbox-codec-result-meta").textContent = labels.join(" · ");
  }

  async function runCodecDirection(mode, input, size, file) {
    if (!mode) return { note: message("toolCodecMd5Hint") };
    if (input === null) return { note: message("toolCodecFileDecodeHint") };
    // Data URL 的包装文本较大，解码可接收本工具生成的完整包装。
    const limit = mode === "dataUrlDecode"
      ? runtime.MAX_RENDER_BYTES
      : Math.min(descriptor.maxInputBytes, runtime.MAX_RENDER_BYTES);
    if (size > limit) return { note: message("toolCodecInputTooLarge") };
    try {
      const result = await implementation.run({ input, options: { mode, file } });
      return { result, note: result.binary ? message("toolCodecBinaryResult") : "" };
    } catch (error) {
      return { note: error.message || message("toolInvalid") };
    }
  }

  async function runCodec(revision) {
    const input = currentInput();
    const file = activeCodecFile();
    const size = file?.bytes.length ?? runtime.byteLength(input);
    byId("codec-input-count").textContent = message("toolCodecInputCount").replace(
      "{count}",
      size.toLocaleString(),
    );
    const { encode, decode } = state.codecType;
    if (!input && !file) {
      clearResult();
      return;
    }
    const [encoded, decoded] = await Promise.all([
      runCodecDirection(encode, input, size, file),
      runCodecDirection(decode, file ? file.text : input, size),
    ]);
    if (revision !== state.inputRevision) return;
    renderCodecResult("encode", encoded);
    renderCodecResult("decode", decoded);
    const converted = Boolean(encoded.result || decoded.result);
    setStatus(message(converted ? "toolCodecAutoConverted" : "toolInvalid"), !converted);
  }

  async function copyCodecResult(direction) {
    const result = state.codecResults[direction];
    if (!result || result.binary) return;
    const success = await runtime.copyText(result.output);
    if (result === state.codecResults[direction]) {
      setStatus(message(success ? "toolCopied" : "toolCopyUnavailable"), !success);
    }
  }

  function downloadCodecResult(direction) {
    const result = state.codecResults[direction];
    if (!result) return;
    if (result.download) {
      const { bytes, filename, mime } = result.download;
      runtime.downloadBytes(bytes, filename, mime);
    } else {
      runtime.downloadText(result.output, `browser-toolbox-codec-${direction}.txt`);
    }
    setStatus(message("toolDownloaded"));
  }

  function buildControls() {
    const controls = byId("tool-controls");
    controls.replaceChildren();
    controls.classList.remove("browser-toolbox-codec-controls");
    const input = byId("tool-input");
    input.disabled = descriptor.inputMode === "none";
    input.closest(".browser-toolbox-tool-input")?.classList.toggle("is-disabled", descriptor.inputMode === "none");
    const right = byId("tool-input-right-wrap");
    right.hidden = descriptor.inputMode !== "dual";
    if (descriptor.inputMode === "none") input.value = "";
    if (descriptor.id === "codec.transform") {
      buildCodecControls();
      return;
    }
    for (const control of descriptor.controls) {
      const options = (control.options || []).map(([value, labelKey]) => [value, message(labelKey)]);
      addControl(optionControl(control.labelKey, control.type, options, control.defaultValue), control.key);
    }
  }

  function buildTimeLayout() {
    const workspace = byId("tool-workspace");
    if (!workspace) return;
    workspace.classList.add("browser-toolbox-time-workspace");
    workspace.replaceChildren();
    workspace.innerHTML = `
      <div class="browser-toolbox-time-layout">
        <section class="browser-toolbox-time-section" aria-labelledby="time-definition-title">
          <div class="browser-toolbox-time-section-heading">
            <h2 id="time-definition-title" data-i18n="toolTimeDefinition"></h2>
          </div>
          <div class="browser-toolbox-time-row browser-toolbox-time-definition-row">
            <label class="browser-toolbox-time-label" for="time-current-local" data-i18n="toolTimeCurrentLocal"></label>
            <div class="browser-toolbox-time-control-line">
              <input id="time-current-local" class="browser-toolbox-time-field browser-toolbox-time-current-field" type="text" readonly>
              <button id="time-current-toggle" class="browser-toolbox-time-button" type="button" data-i18n="toolTimePause"></button>
            </div>
          </div>
          <div class="browser-toolbox-time-row browser-toolbox-time-definition-row">
            <span id="time-current-unix-label" class="browser-toolbox-time-label" data-i18n="toolTimeCurrentUnix"></span>
            <div class="browser-toolbox-time-control-line browser-toolbox-time-unix-values">
              <input id="time-current-seconds" class="browser-toolbox-time-field browser-toolbox-time-value-field" type="text" readonly aria-labelledby="time-current-unix-label time-current-seconds-unit">
              <span id="time-current-seconds-unit" class="browser-toolbox-time-unit-label" data-i18n="toolTimeSecondsLabel"></span>
              <input id="time-current-milliseconds" class="browser-toolbox-time-field browser-toolbox-time-value-field" type="text" readonly aria-labelledby="time-current-unix-label time-current-milliseconds-unit">
              <span id="time-current-milliseconds-unit" class="browser-toolbox-time-unit-label" data-i18n="toolTimeMillisecondsLabel"></span>
            </div>
          </div>
        </section>

        <section class="browser-toolbox-time-section" aria-labelledby="time-unix-title">
          <div class="browser-toolbox-time-section-heading">
            <h2 id="time-unix-title" data-i18n="toolTimeUnixToLocal"></h2>
          </div>
          <div class="browser-toolbox-time-row browser-toolbox-time-convert-row">
            <label class="browser-toolbox-time-label browser-toolbox-time-label-placeholder" for="time-unix-input" data-i18n="toolTimeTimestampPlaceholder"></label>
            <div class="browser-toolbox-time-control-line browser-toolbox-time-convert-line">
              <input id="time-unix-input" class="browser-toolbox-time-field browser-toolbox-time-input-field" type="text" data-i18n-placeholder="toolTimeTimestampPlaceholder">
              <select id="time-unix-unit" class="browser-toolbox-time-select" data-i18n-aria-label="toolTimeUnit">
                <option value="seconds" data-i18n="toolTimeSecondsShort"></option>
                <option value="milliseconds" data-i18n="toolTimeMillisecondsShort"></option>
              </select>
              <button id="time-unix-convert" class="browser-toolbox-time-button" type="button" data-i18n="toolConvert"></button>
              <input id="time-unix-output" class="browser-toolbox-time-field browser-toolbox-time-output-field" type="text" readonly data-i18n-aria-label="toolTimeLocalOutput">
            </div>
          </div>
        </section>

        <section class="browser-toolbox-time-section" aria-labelledby="time-local-title">
          <div class="browser-toolbox-time-section-heading">
            <h2 id="time-local-title" data-i18n="toolTimeLocalToUnix"></h2>
          </div>
          <div class="browser-toolbox-time-row browser-toolbox-time-convert-row">
            <label class="browser-toolbox-time-label browser-toolbox-time-label-placeholder" for="time-local-input" data-i18n="toolTimeDatePlaceholder"></label>
            <div class="browser-toolbox-time-control-line browser-toolbox-time-convert-line">
              <input id="time-local-input" class="browser-toolbox-time-field browser-toolbox-time-input-field" type="text" data-i18n-placeholder="toolTimeDatePlaceholder">
              <button id="time-local-convert" class="browser-toolbox-time-button" type="button" data-i18n="toolConvert"></button>
              <input id="time-local-output" class="browser-toolbox-time-field browser-toolbox-time-output-field" type="text" readonly data-i18n-aria-label="toolTimeUnixOutput">
              <select id="time-local-unit" class="browser-toolbox-time-select" data-i18n-aria-label="toolTimeUnit">
                <option value="seconds" data-i18n="toolTimeSecondsShort"></option>
                <option value="milliseconds" data-i18n="toolTimeMillisecondsShort"></option>
              </select>
            </div>
          </div>
        </section>

        <section class="browser-toolbox-time-section" aria-labelledby="time-filetime-title">
          <div class="browser-toolbox-time-section-heading">
            <h2 id="time-filetime-title" data-i18n="toolTimeFiletime"></h2>
          </div>
          <div class="browser-toolbox-time-row browser-toolbox-time-convert-row">
            <label class="browser-toolbox-time-label browser-toolbox-time-label-placeholder" for="time-filetime-input" data-i18n="toolTimeFiletimePlaceholder"></label>
            <div class="browser-toolbox-time-control-line browser-toolbox-time-convert-line browser-toolbox-time-filetime-line">
              <input id="time-filetime-input" class="browser-toolbox-time-field browser-toolbox-time-input-field browser-toolbox-time-filetime-input" type="text" data-i18n-placeholder="toolTimeFiletimePlaceholder">
              <button id="time-filetime-date" class="browser-toolbox-time-button" type="button" data-i18n="toolTimeFiletimeToDate"></button>
              <button id="time-current-filetime" class="browser-toolbox-time-button browser-toolbox-time-secondary-button" type="button" data-i18n="toolTimeCurrentToFiletime"></button>
              <input id="time-filetime-output" class="browser-toolbox-time-field browser-toolbox-time-output-field" type="text" readonly data-i18n-aria-label="toolTimeFiletimeOutput">
            </div>
          </div>
        </section>

        <section class="browser-toolbox-time-section browser-toolbox-time-world-section" aria-labelledby="time-world-title">
          <div class="browser-toolbox-time-section-heading">
            <h2 id="time-world-title" data-i18n="toolTimeWorldClock"></h2>
          </div>
          <div class="browser-toolbox-time-table-wrap">
            <table class="browser-toolbox-time-table">
              <thead>
                <tr>
                  <th scope="col" data-i18n="toolTimeRegion"></th>
                  <th scope="col" data-i18n="toolTimeClockTime"></th>
                  <th scope="col" data-i18n="toolTimeRegion"></th>
                  <th scope="col" data-i18n="toolTimeClockTime"></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" data-i18n="toolTimeLocal"></th>
                  <td data-time-zone-value="local"></td>
                  <th scope="row" data-i18n="toolTimeGmt"></th>
                  <td data-time-zone-value="Etc/UTC"></td>
                </tr>
                <tr>
                  <th scope="row" data-i18n="toolTimeNewYork"></th>
                  <td data-time-zone-value="America/New_York"></td>
                  <th scope="row" data-i18n="toolTimeLondon"></th>
                  <td data-time-zone-value="Europe/London"></td>
                </tr>
                <tr>
                  <th scope="row" data-i18n="toolTimeTokyo"></th>
                  <td data-time-zone-value="Asia/Tokyo"></td>
                  <th scope="row" data-i18n="toolTimeBeijing"></th>
                  <td data-time-zone-value="Asia/Shanghai"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <p id="tool-status" class="browser-toolbox-time-status" role="status" aria-live="polite"></p>
        <div id="time-copy-toast" class="browser-toolbox-time-copy-toast" role="status" aria-live="polite" aria-atomic="true" hidden></div>
      </div>
    `;
    globalThis.BrowserToolboxI18n?.apply?.(workspace);
  }

  function setTimeOutput(id, value, error = false) {
    const output = byId(id);
    if (!output) return;
    output.value = error ? "" : String(value ?? "");
    output.classList.toggle("is-error", error);
  }

  function showTimeToast(value) {
    const toast = byId("time-copy-toast");
    if (!toast) return;
    if (state.timeCopyToastTimer) globalThis.clearTimeout(state.timeCopyToastTimer);
    toast.textContent = value;
    toast.hidden = false;
    toast.classList.add("is-visible");
    state.timeCopyToastTimer = globalThis.setTimeout(() => {
      toast.classList.remove("is-visible");
      globalThis.setTimeout(() => {
        if (!toast.classList.contains("is-visible")) toast.hidden = true;
      }, 180);
    }, 1600);
  }

  async function copyTimeValue(event) {
    const output = event.currentTarget;
    const value = String(output?.value || "").trim();
    if (!value) return;
    const success = await globalThis.BrowserToolboxToolRuntime.copyText(value);
    const status = success ? message("toolCopied") : message("toolCopyUnavailable");
    setStatus(status);
    showTimeToast(status);
    if (!success) return;
    output.classList.add("is-copied");
    globalThis.setTimeout(() => output.classList.remove("is-copied"), 900);
  }

  function setupTimeCopyControls() {
    for (const output of document.querySelectorAll(
      ".browser-toolbox-tools-document.browser-toolbox-tool-is-time input[readonly]",
    )) {
      output.addEventListener("click", copyTimeValue);
    }
  }

  function runTimeConversion(inputId, outputId, options) {
    try {
      const result = globalThis.BrowserToolboxTimeTool.run(byId(inputId)?.value || "", options);
      setTimeOutput(outputId, result.output);
      setStatus(message("toolReady"));
    } catch (error) {
      setTimeOutput(outputId, "", true);
      setStatus(error.message || message("toolInvalid"));
    }
  }

  function updateTimeSnapshot() {
    const now = new Date();
    const milliseconds = now.getTime();
    byId("time-current-local").value = globalThis.BrowserToolboxTimeTool.formatLocalDate(milliseconds, false);
    byId("time-current-seconds").value = String(Math.floor(milliseconds / 1000));
    byId("time-current-milliseconds").value = String(milliseconds);
    for (const cell of document.querySelectorAll("[data-time-zone-value]")) {
      const zone = cell.dataset.timeZoneValue;
      cell.textContent = zone === "local"
        ? globalThis.BrowserToolboxTimeTool.formatLocalDate(milliseconds, false)
        : globalThis.BrowserToolboxTimeTool.formatTimeZone(milliseconds, zone);
    }
  }

  function setupTimeControls() {
    state.timeClockPaused = false;
    updateTimeSnapshot();
    state.timeClockTimer = globalThis.setInterval(() => {
      if (!state.timeClockPaused) updateTimeSnapshot();
    }, 1000);

    byId("time-current-toggle").addEventListener("click", (event) => {
      state.timeClockPaused = !state.timeClockPaused;
      event.currentTarget.textContent = message(state.timeClockPaused ? "toolTimeResume" : "toolTimePause");
      event.currentTarget.setAttribute("aria-pressed", String(state.timeClockPaused));
      if (!state.timeClockPaused) updateTimeSnapshot();
    });
    byId("time-unix-convert").addEventListener("click", () => {
      const mode = byId("time-unix-unit").value === "milliseconds"
        ? "unixMillisecondsToLocal"
        : "unixSecondsToLocal";
      runTimeConversion("time-unix-input", "time-unix-output", { mode });
    });
    byId("time-local-convert").addEventListener("click", () => {
      const mode = byId("time-local-unit").value === "milliseconds"
        ? "localToUnixMilliseconds"
        : "localToUnixSeconds";
      runTimeConversion("time-local-input", "time-local-output", { mode });
    });
    byId("time-filetime-date").addEventListener("click", () => {
      runTimeConversion("time-filetime-input", "time-filetime-output", { mode: "filetimeToLocal" });
    });
    byId("time-current-filetime").addEventListener("click", () => {
      try {
        const result = globalThis.BrowserToolboxTimeTool.run(String(Date.now()), {
          mode: "unixMillisecondsToFiletime",
        });
        setTimeOutput("time-filetime-output", result.output);
        setStatus(message("toolReady"));
      } catch (error) {
        setTimeOutput("time-filetime-output", "", true);
        setStatus(error.message || message("toolInvalid"));
      }
    });
    if (byId("time-unix-input").value.trim()) {
      byId("time-unix-convert").click();
    } else if (!state.tokenInvalid) {
      setStatus(message("toolReady"));
    }
    setupTimeCopyControls();
  }

  function jsonRenderOptions() {
    const options = currentOptions();
    const indentSize = Math.min(8, Math.max(0, Number(options.indent === "tab" ? 2 : options.indent || 2)));
    return {
      indent: options.indent === "tab" ? "\t" : " ".repeat(indentSize),
      sortOrder: options.sortOrder || "original",
      compact: options.compact === true || options.operation === "compact",
    };
  }

  function isJsonContainer(node) {
    return node?.kind === "object" || node?.kind === "array";
  }

  function cloneJsonNode(node) {
    if (!node || typeof node !== "object") return node;
    if (node.kind === "object") {
      return {
        ...node,
        entries: node.entries.map((entry) => ({
          ...entry,
          key: entry.key ? { ...entry.key } : entry.key,
          value: cloneJsonNode(entry.value),
        })),
      };
    }
    if (node.kind === "array") return { ...node, items: node.items.map(cloneJsonNode) };
    return { ...node };
  }

  function jsonPathKey(path) {
    return path.length === 0 ? "$" : path.join("/");
  }

  function compareJsonCodePoints(left, right) {
    const a = Array.from(left, (char) => char.codePointAt(0));
    const b = Array.from(right, (char) => char.codePointAt(0));
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
  }

  function orderedJsonEntries(node) {
    const entries = node.entries.map((entry, index) => ({ entry, index }));
    const sortOrder = jsonRenderOptions().sortOrder;
    if (sortOrder === "original") return entries;
    return entries.sort((left, right) =>
      (sortOrder === "descending" ? -1 : 1) * compareJsonCodePoints(left.entry.keyValue, right.entry.keyValue) ||
      left.index - right.index
    );
  }

  function jsonNodeLabel(node) {
    if (node.kind === "object") return node.entries.length ? "{" : "{}";
    if (node.kind === "array") return node.items.length ? "[" : "[]";
    return node.raw;
  }

  function createIconButton(iconName, labelKey, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `browser-toolbox-icon-button ${className}`.trim();
    button.setAttribute("aria-label", message(labelKey));
    button.title = message(labelKey);
    button.append(icon(iconName));
    return button;
  }

  function removeJsonNode(parent, index) {
    if (parent.kind === "object") parent.entries.splice(index, 1);
    else if (parent.kind === "array") parent.items.splice(index, 1);
    updateJsonOutputFromRoot();
    setStatus(message("toolJsonNodeDeleted"));
  }

  function renderJsonNode(node, path = [], parent = null, index = -1, lineState = { value: 0 }) {
    const container = document.createElement("div");
    container.className = `browser-toolbox-json-node browser-toolbox-json-node-${node.kind}`;
    const row = document.createElement("div");
    row.className = "browser-toolbox-json-row";
    const lineNumber = document.createElement("span");
    lineNumber.className = "browser-toolbox-json-line-number";
    lineNumber.textContent = String(++lineState.value);
    row.append(lineNumber);

    const hasChildren = isJsonContainer(node) && (node.entries?.length || node.items?.length);
    if (hasChildren) {
      const key = jsonPathKey(path);
      const collapsed = state.jsonCollapsed.has(key);
      const toggle = createIconButton("chevron", collapsed ? "toolExpandNode" : "toolCollapseNode", "browser-toolbox-json-toggle");
      toggle.dataset.jsonPath = key;
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.classList.toggle("is-collapsed", collapsed);
      toggle.addEventListener("click", () => {
        if (state.jsonCollapsed.has(key)) state.jsonCollapsed.delete(key);
        else state.jsonCollapsed.add(key);
        renderJsonTree();
      });
      row.append(toggle);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "browser-toolbox-json-toggle-spacer";
      spacer.setAttribute("aria-hidden", "true");
      row.append(spacer);
    }

    if (parent) {
      const label = document.createElement("span");
      label.className = "browser-toolbox-json-key";
      if (parent.kind === "object") {
        row.dataset.jsonKey = String(parent.entries[index].keyValue);
        label.textContent = parent.entries[index].key.raw;
      } else {
        row.dataset.jsonKey = `[${index}]`;
        label.textContent = `[${index}]`;
      }
      row.append(label);
      const separator = document.createElement("span");
      separator.className = "browser-toolbox-json-separator";
      separator.textContent = ":";
      row.append(separator);
    }

    const value = document.createElement("span");
    value.className = `browser-toolbox-json-value browser-toolbox-json-value-${node.kind}`;
    const collapsed = state.jsonCollapsed.has(jsonPathKey(path));
    value.textContent = collapsed && isJsonContainer(node)
      ? node.kind === "object" ? "{…}" : "[…]"
      : jsonNodeLabel(node);
    row.append(value);

    const actions = document.createElement("span");
    actions.className = "browser-toolbox-json-node-actions";
    const copyButton = createIconButton("copy", "toolCopyNode", "browser-toolbox-json-node-action");
    copyButton.dataset.action = "copy";
    copyButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      const success = await runtime.copyText(formatter.renderJsonNode(node, 0, jsonRenderOptions()));
      setStatus(success ? message("toolCopied") : message("toolCopyUnavailable"));
    });
    actions.append(copyButton);
    if (parent) {
      const deleteButton = createIconButton("trash", "toolDeleteNode", "browser-toolbox-json-node-action");
      deleteButton.dataset.action = "delete";
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        removeJsonNode(parent, index);
      });
      actions.append(deleteButton);
    }
    row.append(actions);
    container.append(row);

    if (hasChildren) {
      const children = document.createElement("div");
      children.className = "browser-toolbox-json-children";
      children.hidden = collapsed;
      if (node.kind === "object") {
        orderedJsonEntries(node).forEach(({ entry, index: childIndex }) => {
          children.append(renderJsonNode(entry.value, [...path, `key-${childIndex}`], node, childIndex, lineState));
        });
      } else {
        node.items.forEach((item, childIndex) => {
          children.append(renderJsonNode(item, [...path, `item-${childIndex}`], node, childIndex, lineState));
        });
      }
      const closing = document.createElement("div");
      closing.className = "browser-toolbox-json-closing";
      const closingLineNumber = document.createElement("span");
      closingLineNumber.className = "browser-toolbox-json-line-number";
      closingLineNumber.textContent = String(++lineState.value);
      const closingValue = document.createElement("span");
      closingValue.textContent = node.kind === "object" ? "}" : "]";
      closing.append(closingLineNumber, closingValue);
      children.append(closing);
      container.append(children);
    }
    return container;
  }

  function renderJsonTree() {
    const tree = byId("json-result-tree");
    const panel = byId("json-result-panel");
    const copyRoot = byId("json-copy-root");
    if (!tree) return;
    tree.replaceChildren();
    if (!state.jsonRoot) {
      panel?.classList.add("is-empty");
      if (copyRoot) copyRoot.hidden = true;
      const empty = document.createElement("div");
      empty.className = "browser-toolbox-json-empty";
      if (currentInput().trim()) {
        empty.classList.add("browser-toolbox-json-empty-error");
        empty.textContent = message("toolJsonNoResult");
      } else {
        const badge = document.createElement("span");
        badge.className = "browser-toolbox-json-empty-badge";
        badge.textContent = "JSON";
        const title = document.createElement("strong");
        title.textContent = message("toolJsonEmptyTitle");
        const hint = document.createElement("p");
        hint.textContent = message("toolJsonEmptyHint");
        empty.append(badge, title, hint);
      }
      tree.append(empty);
      return;
    }
    panel?.classList.remove("is-empty");
    if (copyRoot) copyRoot.hidden = false;
    tree.append(renderJsonNode(state.jsonRoot, [], null, -1, { value: 0 }));
  }

  function updateJsonOutputFromRoot() {
    state.output = formatter.renderJsonNode(state.jsonRoot, 0, jsonRenderOptions());
    byId("tool-output").textContent = state.output;
    renderJsonTree();
  }

  function collectJsonContainerPaths(node, path = [], result = []) {
    if (!isJsonContainer(node) || !(node.entries?.length || node.items?.length)) return result;
    result.push(jsonPathKey(path));
    if (node.kind === "object") {
      node.entries.forEach((entry, index) => collectJsonContainerPaths(entry.value, [...path, `key-${index}`], result));
    } else {
      node.items.forEach((item, index) => collectJsonContainerPaths(item, [...path, `item-${index}`], result));
    }
    return result;
  }

  function renderDiff(result) {
    const list = byId("diff-result-list");
    if (!list) return;
    list.replaceChildren();
    const entries = result.entries || String(result.output || "").split("\n").map((line) => ({
      type: line.startsWith("+ ") ? "add" : line.startsWith("- ") ? "remove" : "same",
      text: line.slice(2),
    }));
    let additions = 0;
    let removals = 0;
    entries.forEach((entry, index) => {
      if (entry.type === "add") additions++;
      if (entry.type === "remove") removals++;
      const row = document.createElement("div");
      row.className = `browser-toolbox-diff-row browser-toolbox-diff-row-${entry.type}`;
      row.setAttribute("role", "listitem");
      const marker = document.createElement("span");
      marker.className = "browser-toolbox-diff-marker";
      marker.textContent = entry.type === "add" ? "+" : entry.type === "remove" ? "−" : "·";
      const number = document.createElement("span");
      number.className = "browser-toolbox-diff-line-number";
      number.textContent = String(index + 1);
      const text = document.createElement("code");
      text.textContent = entry.text;
      row.append(marker, number, text);
      list.append(row);
    });
    const summary = byId("diff-summary");
    if (summary) summary.textContent = `+${additions} / −${removals}`;
  }

  function applyLayout() {
    document.body.dataset.toolId = descriptor.id;
    document.body.classList.toggle("browser-toolbox-tool-is-json", descriptor.id === "json.format");
    document.body.classList.toggle("browser-toolbox-tool-is-diff", descriptor.id === "text.diff");
    document.body.classList.toggle("browser-toolbox-tool-is-codec", descriptor.id === "codec.transform");
    document.body.classList.toggle("browser-toolbox-tool-is-time", descriptor.id === "time.convert");
    document.body.classList.toggle("browser-toolbox-tool-is-config", descriptor.id === "config.convert");
    const inputLabel = byId("tool-input-label");
    const outputTitle = byId("tool-output-title");
    if (descriptor.id === "codec.transform") {
      inputLabel.dataset.i18n = "toolCodecInputLabel";
      inputLabel.textContent = message("toolCodecInputLabel");
      byId("tool-result-workspace").hidden = true;
    } else if (descriptor.id === "json.format") {
      inputLabel.dataset.i18n = "toolInput";
      inputLabel.textContent = message("toolInput");
      outputTitle.dataset.i18n = "toolJsonOutput";
      outputTitle.textContent = message("toolJsonOutput");
      byId("tool-run").textContent = message("toolJsonFormatOperation");
      byId("tool-input").dataset.i18nPlaceholder = "toolJsonInputHint";
      byId("tool-input").placeholder = message("toolJsonInputHint");
    } else {
      inputLabel.dataset.i18n = descriptor.inputMode === "dual" ? "toolInputLeft" : "toolInput";
      inputLabel.textContent = message(inputLabel.dataset.i18n);
      outputTitle.dataset.i18n = "toolOutput";
      outputTitle.textContent = message("toolOutput");
      byId("tool-run").textContent = message("toolRun");
      byId("tool-input").dataset.i18nPlaceholder = "toolInputHint";
      byId("tool-input").placeholder = message("toolInputHint");
    }
    byId("json-result-panel").hidden = descriptor.id !== "json.format";
    byId("diff-result-panel").hidden = descriptor.id !== "text.diff";
    byId("tool-output").hidden = ["json.format", "text.diff", "codec.transform"].includes(descriptor.id);
    byId("tool-copy").hidden = descriptor.id === "json.format";
    byId("json-copy-root").hidden = descriptor.id !== "json.format";
    byId("json-tool-summary").hidden = descriptor.id !== "json.format";
  }

  function clearResult() {
    if (descriptor.id === "codec.transform") {
      renderCodecResult("encode");
      renderCodecResult("decode", { note: state.codecType.decode ? "" : message("toolCodecMd5Hint") });
      setStatus(message("toolReady"));
      return;
    }
    state.output = "";
    state.lastResult = null;
    state.jsonRoot = null;
    byId("tool-output").textContent = "";
    if (descriptor?.id === "json.format") renderJsonTree();
    else byId("json-result-tree")?.replaceChildren();
    byId("json-result-panel")?.classList.toggle("is-empty", descriptor?.id === "json.format");
    if (descriptor?.id === "json.format" && byId("json-copy-root")) byId("json-copy-root").hidden = true;
    byId("diff-result-list")?.replaceChildren();
    byId("tool-metadata").replaceChildren();
    byId("json-tool-summary").hidden = true;
    configView?.clear();
  }

  function applyResult(result, automatic = false) {
    state.output = String(result.output ?? "");
    state.lastResult = result;
    if (configView) {
      configView.applyResult(result);
      setStatus(message(result.output ? "toolConfigConverted" : "toolReady"));
      return;
    }
    if (descriptor.id === "json.format") {
      state.jsonRoot = cloneJsonNode(result.root);
      byId("tool-output").textContent = state.output;
      state.jsonCollapsed.clear();
      renderJsonTree();
    } else if (descriptor.id === "text.diff") {
      byId("tool-output").textContent = state.output;
      renderDiff(result);
    } else {
      byId("tool-output").textContent = state.output;
    }
    renderMetadata(result.metadata);
    updateJsonSummary(result.metadata);
    setStatus(message(automatic ? "toolAutoParsed" : "toolReady"));
  }

  function scheduleAutoRun() {
    if (!state || (state.tokenInvalid && descriptor.id !== "codec.transform")) return;
    if (state.autoRunTimer) globalThis.clearTimeout(state.autoRunTimer);
    state.autoRunTimer = globalThis.setTimeout(() => {
      state.autoRunTimer = null;
      run(true);
    }, 220);
  }

  async function run(automatic = false) {
    if (state?.running) {
      if (automatic) state.autoRunPending = true;
      return;
    }
    state.running = true;
    if (state.autoRunTimer) {
      globalThis.clearTimeout(state.autoRunTimer);
      state.autoRunTimer = null;
    }
    const runRevision = state.inputRevision;
    const checkRevision = descriptor.id === "codec.transform" || descriptor.id === "config.convert";
    byId("tool-run").disabled = true;
    try {
      if (descriptor.id === "codec.transform") {
        await runCodec(runRevision);
        return;
      }
      if (descriptor.id === "json.format" && !currentInput().trim()) {
        clearResult();
        setStatus(message("toolReady"));
        return;
      }
      if (configView && runtime.byteLength(currentInput()) > descriptor.maxInputBytes) {
        throw new Error(message("toolConfigLimit"));
      }
      const input = descriptor.inputMode === "none" ? "" : runtime.assertInput(currentInput(), descriptor);
      const options = currentOptions();
      const rightInput = descriptor.inputMode === "dual"
        ? runtime.assertInput(byId("tool-input-right").value, descriptor)
        : "";
      const result = await implementation.run({
        input,
        rightInput,
        options,
        state,
        confirm: globalThis.confirm,
        confirmMessage: message("toolRepairConfirm"),
      });
      if (!checkRevision || runRevision === state.inputRevision) applyResult(result, automatic);
    } catch (error) {
      if (!checkRevision || runRevision === state.inputRevision) {
        clearResult();
        let detail = error.messageKey ? message(error.messageKey) : error.message || message("toolInvalid");
        if (configView && error.line) detail = message("toolConfigErrorLocation")
          .replace("{line}", error.line).replace("{column}", error.column || 1).replace("{message}", detail);
        setStatus(detail, true);
      }
    } finally {
      state.running = false;
      byId("tool-run").disabled = false;
      if (state.autoRunPending || runRevision !== state.inputRevision) {
        state.autoRunPending = false;
        scheduleAutoRun();
      }
    }
  }

  async function copy() {
    if (configView && !state.lastResult?.output) return;
    const success = await runtime.copyText(state.output);
    setStatus(success ? message("toolCopied") : message("toolCopyUnavailable"));
  }

  function download() {
    if (configView) {
      if (!state.lastResult?.output) return;
      const extension = state.lastResult.extension;
      const base = state.originalFilename.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_") || "application";
      runtime.downloadText(state.output, `${base}.${extension}`, extension === "yaml"
        ? "application/yaml;charset=utf-8" : "text/plain;charset=utf-8");
      setStatus(message("toolDownloaded"));
      return;
    }
    const isJson = descriptor.id === "json.format";
    const filename = isJson
      ? `browser-toolbox-${Date.now()}.json`
      : `browser-toolbox-${descriptor.id.replace(".", "-")}.txt`;
    runtime.downloadText(state.output, filename, isJson ? "application/json;charset=utf-8" : undefined);
    setStatus(message("toolDownloaded"));
  }

  async function restoreInput() {
    const isCodec = descriptor.id === "codec.transform";
    const useExample = isCodec && !state.originalInput && !state.originalFilename;
    const input = useExample
      ? JSON.stringify(
        {
          app: message("browserToolbox"),
          mode: "Base64 · UTF-8",
          url: `/search?q=${message("toolCodecTransform")}&lang=${document.documentElement.lang}`,
          emoji: "⚡",
        },
        null,
        2,
      )
      : state.originalInput;
    byId("tool-input").value = input;
    byId("tool-input-right").value = state.originalRightInput;
    state.workingInput = input;
    state.repairApplied = false;
    state.inputRevision++;
    if (isCodec) {
      state.codecFile = state.originalCodecFile;
      if (state.codecFile) {
        state.codecType = ADVANCED_CODEC_TYPES.find((type) => type.id === "dataUrl");
      } else if (useExample) {
        state.codecType = CODEC_TYPES[0];
      }
      updateFileName(state.originalFilename);
      markCodecSelection();
      clearResult();
      await run(true);
      return;
    }
    updateJsonInputLineNumbers();
    await run();
    setStatus(message("toolRestored"));
  }

  async function loadToken() {
    const params = new URLSearchParams(location.search);
    const token = params.get("inputToken");
    if (!token) return;
    const consumed = await chrome.runtime.sendMessage({
      handler: "browserToolbox.consumeToolInput",
      token,
      toolId: descriptor.id,
      source: params.get("source") || "action",
    });
    if (!consumed || consumed.toolId !== descriptor.id) {
      state.tokenInvalid = true;
      setStatus(message("toolTokenInvalid"));
      return;
    }
    const input = descriptor.id === "time.convert" ? byId("time-unix-input") : byId("tool-input");
    if (!input) return;
    input.value = consumed.input ?? "";
    state.originalInput = consumed.input ?? "";
    state.workingInput = state.originalInput;
    updateJsonInputLineNumbers();
    configView?.updateInput();
  }

  async function loadFile(file) {
    if (!file) return;
    const isCodec = descriptor.id === "codec.transform";
    const asDataUrl = isCodec && state.codecType.id === "dataUrl";
    const fileRevision = ++state.fileLoadRevision;
    const inputRevision = state.inputRevision;
    const fileLimit = asDataUrl
      ? runtime.MAX_RENDER_BYTES
      : Math.min(descriptor.maxInputBytes, runtime.MAX_RENDER_BYTES);
    if (file.size > fileLimit) {
      setStatus(message("toolFileTooLarge"), true);
      return;
    }
    let bytes;
    let input;
    try {
      bytes = asDataUrl ? new Uint8Array(await file.arrayBuffer()) : null;
      input = asDataUrl
        ? ""
        : configView
        ? new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())
        : await file.text();
    } catch (error) {
      if (fileRevision !== state.fileLoadRevision || inputRevision !== state.inputRevision) return;
      if (configView) throw new Error(message("toolConfigEncoding"));
      throw error;
    }
    if (fileRevision !== state.fileLoadRevision || inputRevision !== state.inputRevision) return;
    byId("tool-input").value = input;
    state.originalInput = input;
    state.workingInput = input;
    state.originalFilename = file.name;
    state.inputRevision++;
    state.repairApplied = false;
    updateFileName(file.name);
    configView?.selectFile(file.name);
    configView?.updateInput();
    if (isCodec) {
      let text = null;
      if (bytes) {
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch (_) {
          // 二进制文件仍可编码，解码栏只接收 Data URL 文本。
        }
      }
      state.codecFile = bytes ? { bytes, text, mime: file.type, name: file.name } : null;
      state.originalCodecFile = state.codecFile;
      updateCodecFileSource();
      updateCodecRestoreLabel();
    }
    if (configView || isCodec) clearResult();
    updateJsonInputLineNumbers();
    setStatus(`${message("toolFileLoaded")}: ${file.name}`);
    await run(true);
  }

  function updateFileName(name = "") {
    const label = byId("tool-file-name");
    if (!label) return;
    label.textContent = name || message("toolFileNone");
    if (configView || descriptor.id === "codec.transform") label.hidden = !name;
  }

  function setupHeader() {
    setIcon("tool-copy-icon", "copy");
    setIcon("tool-download-icon", "download");
    setIcon("tool-restore-icon", "restore");
    setIcon("json-copy-root-icon", "copy");
    setIcon("json-collapse-all-icon", "chevron");
    setIcon("json-expand-all-icon", "chevron");
    const toolIcon = byId("tool-icon");
    toolIcon?.replaceChildren(icon(["json.format", "config.convert"].includes(descriptor.id) ? "braces" : "toolbox"));
    byId("tool-title").textContent = message(descriptor.titleKey);
    const titleIcon = byId("tool-title-icon");
    if (descriptor.id === "json.format") titleIcon?.replaceChildren(icon("document"));
    else titleIcon?.replaceChildren();
    byId("tool-description").textContent = message(descriptor.descriptionKey);
    document.title = message(descriptor.titleKey);
  }

  async function init() {
    await globalThis.BrowserToolboxI18n?.applyStoredLocale?.(document);
    await globalThis.BrowserToolboxTheme?.applyStoredTheme?.(document);
    globalThis.BrowserToolboxTheme?.watchTheme?.(document);
    const params = new URLSearchParams(location.search);
    const toolId = params.get("tool") || registry.TOOL_IDS[0];
    descriptor = registry.get(toolId) || registry.get(registry.TOOL_IDS[0]);
    implementation = loader.load(descriptor.id);
    state = {
      originalInput: "",
      workingInput: "",
      originalRightInput: "",
      output: "",
      lastResult: null,
      jsonRoot: null,
      jsonCollapsed: new Set(),
      codecType: CODEC_TYPES[0],
      codecResults: { encode: null, decode: null },
      codecFile: null,
      originalCodecFile: null,
      fileLoadRevision: 0,
      repairApplied: false,
      originalFilename: "",
      tokenInvalid: false,
      running: false,
      autoRunTimer: null,
      autoRunPending: false,
      inputRevision: 0,
    };
    setupHeader();
    applyLayout();
    if (descriptor.id === "config.convert") {
      configView = globalThis.BrowserToolboxPropertiesYamlView.create({
        message, icon,
        onDirectionChange() { state.inputRevision++; clearResult(); scheduleAutoRun(); },
        onIndentChange() { state.inputRevision++; clearResult(); scheduleAutoRun(); },
        onSwap() {
          if (!state.lastResult?.output) return;
          byId("tool-input").value = state.output;
          configView.setDirection(configView.options().direction === "propertiesToYaml" ? "yamlToProperties" : "propertiesToYaml");
          state.inputRevision++;
          updateFileName();
          clearResult();
          run(true);
        },
      });
    }
    if (descriptor.id === "codec.transform") buildCodecLayout();
    if (descriptor.id === "time.convert") {
      buildTimeLayout();
      await loadToken();
      setupTimeControls();
      return;
    }
    if (descriptor.id === "json.format") buildJsonControls();
    else if (!configView) buildControls();
    await loadToken();
    if (descriptor.id === "codec.transform") updateCodecRestoreLabel();
    byId("tool-run").addEventListener("click", () => {
      if (descriptor.id === "json.format") {
        const operation = byId("tool-controls")?.querySelector('[data-tool-option="operation"]');
        const compact = byId("tool-controls")?.querySelector('[data-tool-option="compact"]');
        if (operation) operation.value = "format";
        if (compact) compact.checked = false;
        syncJsonToolbarState();
      }
      run();
    });
    byId("tool-copy").addEventListener("click", copy);
    byId("tool-download").addEventListener("click", download);
    byId("tool-restore").addEventListener("click", () => restoreInput());
    byId("json-copy-root")?.addEventListener("click", copy);
    byId("json-collapse-all")?.addEventListener("click", () => {
      if (!state.jsonRoot) return;
      state.jsonCollapsed = new Set(collectJsonContainerPaths(state.jsonRoot));
      renderJsonTree();
    });
    byId("json-expand-all")?.addEventListener("click", () => {
      state.jsonCollapsed.clear();
      renderJsonTree();
    });
    byId("tool-file-trigger")?.addEventListener("click", () => {
      byId("tool-file")?.click();
    });
    byId("tool-file")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      loadFile(file).catch((error) => setStatus(error.message, true));
      event.target.value = "";
    });
    byId("tool-controls")?.addEventListener("change", () => {
      syncJsonToolbarState();
      scheduleAutoRun();
    });
    for (const input of document.querySelectorAll("#tool-input, #tool-input-right")) {
      input.addEventListener("input", () => {
        state.repairApplied = false;
        state.workingInput = byId("tool-input").value;
        state.inputRevision++;
        if (configView) { configView.updateInput(); clearResult(); updateFileName(); }
        if (descriptor.id === "codec.transform") {
          state.codecFile = null;
          updateFileName();
          updateCodecFileSource();
          clearResult();
        }
        updateJsonInputLineNumbers();
        updateJsonSummary(state.lastResult?.metadata);
        scheduleAutoRun();
      });
      input.addEventListener("scroll", () => updateJsonInputLineNumbers());
      input.addEventListener("click", () => updateJsonSummary(state.lastResult?.metadata));
      input.addEventListener("keyup", () => updateJsonSummary(state.lastResult?.metadata));
    }
    updateJsonInputLineNumbers();
    await run(true);
    if (state.tokenInvalid) setStatus(message("toolTokenInvalid"));
    const notice = params.get("notice");
    if (notice === "empty-selection") setStatus(message("toolEmptySelection"));
    if (notice === "selection-too-large") setStatus(message("toolSelectionTooLarge"));
  }

  document.addEventListener("DOMContentLoaded", () => init().catch((error) => setStatus(error.message)));
})();

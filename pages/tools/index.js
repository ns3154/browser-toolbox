// 独立工具页控制器：每个页面只负责当前工具，工具选择交给弹窗、右键菜单和设置页入口。
(function () {
  const registry = globalThis.BrowserToolboxToolRegistry;
  const loader = globalThis.BrowserToolboxToolLoader;
  const runtime = globalThis.BrowserToolboxToolRuntime;
  const formatter = globalThis.BrowserToolboxDocumentFormatters;
  let descriptor;
  let implementation;
  let state;

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
    Object.freeze({ id: "unicode", labelKey: "toolCodecUnicode", encode: "unicodeEncode", decode: "unicodeDecode" }),
    Object.freeze({ id: "url", labelKey: "toolCodecUrl", encode: "urlEncode", decode: "urlDecode" }),
    Object.freeze({ id: "utf8", labelKey: "toolCodecUtf8", encode: "utf8Encode", decode: "utf8Decode" }),
    Object.freeze({ id: "base64", labelKey: "toolCodecBase64", encode: "base64Encode", decode: "base64Decode" }),
    Object.freeze({ id: "hex", labelKey: "toolCodecHex", encode: "hexEncode", decode: "hexDecode" }),
    Object.freeze({ id: "utf16", labelKey: "toolCodecUtf16", encode: "utf16Encode", decode: "utf16Decode" }),
    Object.freeze({ id: "html", labelKey: "toolCodecHtml", encode: "htmlEncode", decode: "htmlDecode" }),
  ]);
  const ADVANCED_CODEC_TYPES = Object.freeze([
    Object.freeze({ id: "jwt", labelKey: "toolJwtDecode", mode: "jwtDecode" }),
    Object.freeze({ id: "cookie", labelKey: "toolCookieParse", mode: "cookieParse" }),
    Object.freeze({ id: "gzip", labelKey: "toolGzipCompress", encode: "gzipCompress", decode: "gzipDecompress" }),
    Object.freeze({ id: "md5", labelKey: "toolMd5", mode: "md5" }),
    Object.freeze({ id: "sha1", labelKey: "toolSha1", mode: "sha1" }),
  ]);

  function icon(name) {
    return globalThis.BrowserToolboxToolIcons?.createIcon(name, {
      className: "browser-toolbox-tool-icon",
    }) || document.createElement("span");
  }

  function setIcon(slotId, name) {
    const slot = byId(slotId);
    if (slot) slot.replaceChildren(icon(name));
  }

  function setStatus(value) {
    const status = byId("tool-status");
    if (status) status.textContent = value;
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
    if (descriptor.id === "codec.transform") return { mode: state.codecMode };
    const options = {};
    for (const input of byId("tool-controls")?.querySelectorAll("[data-tool-option]") || []) {
      const key = input.dataset.toolOption;
      options[key] = input.type === "checkbox" ? input.checked : input.value;
    }
    return options;
  }

  function addControl(control, key) {
    control.input.dataset.toolOption = key;
    byId("tool-controls")?.append(control.label);
  }

  function codecModeForType(type) {
    if (type.mode) return type.mode;
    return type[state.codecOperation] || type.encode;
  }

  function markCodecSelection() {
    for (const button of document.querySelectorAll("[data-codec-mode]")) {
      const selected = button.dataset.codecMode === state.codecMode;
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("is-selected", selected);
    }
    for (const button of document.querySelectorAll("[data-codec-operation]")) {
      const selected = button.dataset.codecOperation === state.codecOperation;
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("is-selected", selected);
    }
  }

  function selectCodecType(type) {
    state.codecType = type.id;
    state.codecMode = codecModeForType(type);
    markCodecSelection();
  }

  function createCodecTypeButton(type) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "browser-toolbox-codec-type-card";
    button.dataset.codecMode = codecModeForType(type);
    button.dataset.codecType = type.id;
    button.setAttribute("aria-pressed", "false");
    const title = document.createElement("strong");
    title.textContent = message(type.labelKey);
    button.append(title);
    button.addEventListener("click", () => selectCodecType(type));
    return button;
  }

  function buildCodecControls() {
    const controls = byId("tool-controls");
    controls.replaceChildren();
    controls.classList.add("browser-toolbox-codec-controls");

    const operationGroup = document.createElement("div");
    operationGroup.className = "browser-toolbox-codec-operation";
    const operationLabel = document.createElement("span");
    operationLabel.className = "browser-toolbox-control-heading";
    operationLabel.textContent = message("toolCodecOperation");
    const operationButtons = document.createElement("div");
    operationButtons.className = "browser-toolbox-segmented-control";
    for (const [operation, key] of [["encode", "toolEncode"], ["decode", "toolDecode"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.codecOperation = operation;
      button.textContent = message(key);
      button.addEventListener("click", () => {
        state.codecOperation = operation;
        const type = CODEC_TYPES.find((candidate) => candidate.id === state.codecType) ||
          ADVANCED_CODEC_TYPES.find((candidate) => candidate.id === state.codecType);
        if (type && !type.mode) state.codecMode = codecModeForType(type);
        markCodecSelection();
      });
      operationButtons.append(button);
    }
    operationGroup.append(operationLabel, operationButtons);

    const typeGroup = document.createElement("div");
    typeGroup.className = "browser-toolbox-codec-type-group";
    const typeLabel = document.createElement("span");
    typeLabel.className = "browser-toolbox-control-heading";
    typeLabel.textContent = message("toolCodecType");
    const typeGrid = document.createElement("div");
    typeGrid.id = "codec-type-grid";
    typeGrid.className = "browser-toolbox-codec-type-grid";
    CODEC_TYPES.forEach((type) => typeGrid.append(createCodecTypeButton(type)));

    const advanced = document.createElement("details");
    advanced.className = "browser-toolbox-codec-advanced";
    const summary = document.createElement("summary");
    summary.textContent = message("toolCodecAdvanced");
    const advancedGrid = document.createElement("div");
    advancedGrid.id = "codec-advanced-grid";
    advancedGrid.className = "browser-toolbox-codec-type-grid browser-toolbox-codec-type-grid-advanced";
    ADVANCED_CODEC_TYPES.forEach((type) => advancedGrid.append(createCodecTypeButton(type)));
    advanced.append(summary, advancedGrid);
    typeGroup.append(typeLabel, typeGrid, advanced);
    controls.append(operationGroup, typeGroup);
    markCodecSelection();
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

  function renderJsonNode(node, path = [], parent = null, index = -1) {
    const container = document.createElement("div");
    container.className = `browser-toolbox-json-node browser-toolbox-json-node-${node.kind}`;
    const row = document.createElement("div");
    row.className = "browser-toolbox-json-row";

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
        node.entries.forEach((entry, childIndex) => {
          children.append(renderJsonNode(entry.value, [...path, `key-${childIndex}`], node, childIndex));
        });
      } else {
        node.items.forEach((item, childIndex) => {
          children.append(renderJsonNode(item, [...path, `item-${childIndex}`], node, childIndex));
        });
      }
      const closing = document.createElement("div");
      closing.className = "browser-toolbox-json-closing";
      closing.textContent = node.kind === "object" ? "}" : "]";
      children.append(closing);
      container.append(children);
    }
    return container;
  }

  function renderJsonTree() {
    const tree = byId("json-result-tree");
    if (!tree) return;
    tree.replaceChildren();
    if (!state.jsonRoot) {
      const empty = document.createElement("p");
      empty.className = "browser-toolbox-json-empty";
      empty.textContent = message("toolJsonNoResult");
      tree.append(empty);
      return;
    }
    tree.append(renderJsonNode(state.jsonRoot));
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
    const inputLabel = byId("tool-input-label");
    const outputTitle = byId("tool-output-title");
    if (descriptor.id === "codec.transform") {
      inputLabel.dataset.i18n = "toolRawInput";
      inputLabel.textContent = message("toolRawInput");
      outputTitle.dataset.i18n = "toolParsedOutput";
      outputTitle.textContent = message("toolParsedOutput");
      byId("tool-run").textContent = message("toolConvert");
    } else {
      inputLabel.dataset.i18n = descriptor.inputMode === "dual" ? "toolInputLeft" : "toolInput";
      inputLabel.textContent = message(inputLabel.dataset.i18n);
      outputTitle.dataset.i18n = "toolOutput";
      outputTitle.textContent = message("toolOutput");
      byId("tool-run").textContent = message("toolRun");
    }
    byId("json-result-panel").hidden = descriptor.id !== "json.format";
    byId("diff-result-panel").hidden = descriptor.id !== "text.diff";
    byId("codec-output").hidden = descriptor.id !== "codec.transform";
    byId("tool-output").hidden = ["json.format", "text.diff", "codec.transform"].includes(descriptor.id);
    byId("json-copy-root").hidden = descriptor.id !== "json.format";
  }

  function clearResult() {
    state.output = "";
    state.jsonRoot = null;
    byId("tool-output").textContent = "";
    byId("codec-output").textContent = "";
    byId("json-result-tree")?.replaceChildren();
    byId("diff-result-list")?.replaceChildren();
    byId("tool-metadata").replaceChildren();
  }

  function applyResult(result) {
    state.output = String(result.output ?? "");
    state.lastResult = result;
    if (descriptor.id === "json.format") {
      state.jsonRoot = cloneJsonNode(result.root);
      byId("tool-output").textContent = state.output;
      state.jsonCollapsed.clear();
      renderJsonTree();
    } else if (descriptor.id === "text.diff") {
      byId("tool-output").textContent = state.output;
      renderDiff(result);
    } else if (descriptor.id === "codec.transform") {
      byId("codec-output").textContent = state.output;
    } else {
      byId("tool-output").textContent = state.output;
    }
    renderMetadata(result.metadata);
    setStatus(message("toolReady"));
  }

  async function run() {
    if (state?.running) return;
    state.running = true;
    byId("tool-run").disabled = true;
    try {
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
      applyResult(result);
    } catch (error) {
      clearResult();
      setStatus(error.message || message("toolInvalid"));
    } finally {
      state.running = false;
      byId("tool-run").disabled = false;
    }
  }

  async function copy() {
    const success = await runtime.copyText(state.output);
    setStatus(success ? message("toolCopied") : message("toolCopyUnavailable"));
  }

  function download() {
    runtime.downloadText(state.output, `browser-toolbox-${descriptor.id.replace(".", "-")}.txt`);
    setStatus(message("toolDownloaded"));
  }

  async function restore() {
    byId("tool-input").value = state.originalInput;
    byId("tool-input-right").value = state.originalRightInput;
    state.workingInput = state.originalInput;
    state.repairApplied = false;
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
    byId("tool-input").value = consumed.input ?? "";
    state.originalInput = consumed.input ?? "";
    state.workingInput = state.originalInput;
  }

  async function loadFile(file) {
    if (!file) return;
    if (file.size > Math.min(descriptor.maxInputBytes, runtime.MAX_RENDER_BYTES)) {
      setStatus(message("toolFileTooLarge"));
      return;
    }
    const input = await file.text();
    byId("tool-input").value = input;
    state.originalInput = input;
    state.workingInput = input;
    state.originalFilename = file.name;
    state.repairApplied = false;
    setStatus(`${message("toolFileLoaded")}: ${file.name}`);
    await run();
  }

  function setupHeader() {
    const settingsUrl = chrome.runtime.getURL("pages/mouse_options.html#toolsOverview");
    const back = byId("tool-back");
    const settings = byId("tool-settings");
    if (back) back.href = settingsUrl;
    if (settings) {
      settings.href = settingsUrl;
      settings.target = "_blank";
      settings.rel = "noopener";
    }
    setIcon("tool-back-icon", "arrowLeft");
    setIcon("tool-settings-icon", "settings");
    setIcon("tool-copy-icon", "copy");
    setIcon("tool-download-icon", "download");
    setIcon("tool-restore-icon", "restore");
    setIcon("json-copy-root-icon", "copy");
    setIcon("json-collapse-all-icon", "chevron");
    setIcon("json-expand-all-icon", "chevron");
    const toolIcon = byId("tool-icon");
    toolIcon?.replaceChildren(icon(descriptor.icon));
    byId("tool-title").textContent = message(descriptor.titleKey);
    byId("tool-description").textContent = message(descriptor.descriptionKey);
    document.title = message(descriptor.titleKey);
  }

  async function init() {
    await globalThis.BrowserToolboxI18n?.applyStoredLocale?.(document);
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
      codecOperation: "encode",
      codecType: "base64",
      codecMode: "base64Encode",
      repairApplied: false,
      originalFilename: "",
      tokenInvalid: false,
      running: false,
    };
    setupHeader();
    applyLayout();
    buildControls();
    await loadToken();
    byId("tool-run").addEventListener("click", () => run());
    byId("tool-copy").addEventListener("click", copy);
    byId("tool-download").addEventListener("click", download);
    byId("tool-restore").addEventListener("click", () => restore());
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
    byId("tool-file")?.addEventListener("change", (event) => {
      loadFile(event.target.files?.[0]).catch((error) => setStatus(error.message));
      event.target.value = "";
    });
    byId("tool-input").addEventListener("input", () => {
      state.repairApplied = false;
      state.workingInput = byId("tool-input").value;
    });
    await run();
    if (state.tokenInvalid) setStatus(message("toolTokenInvalid"));
    const notice = params.get("notice");
    if (notice === "empty-selection") setStatus(message("toolEmptySelection"));
    if (notice === "selection-too-large") setStatus(message("toolSelectionTooLarge"));
  }

  document.addEventListener("DOMContentLoaded", () => init().catch((error) => setStatus(error.message)));
})();

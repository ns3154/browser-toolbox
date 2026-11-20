// SPDX-License-Identifier: GPL-3.0-or-later
import { mountWorkbench } from "./workbench.js";

// 七个工作台与编码转换沿用同一条注册表路由。
const registry = globalThis.BrowserToolboxToolRegistry;
const runtime = globalThis.BrowserToolboxToolRuntime;
const message = (key) => globalThis.BrowserToolboxI18n.message(key);
const byId = (id) => document.getElementById(id);

function consumeInput(params, toolId) {
  return chrome.runtime.sendMessage({
    handler: "browserToolbox.consumeToolInput",
    token: params.get("inputToken"),
    toolId,
    source: params.get("source") || "action",
  });
}

function mountCodec(descriptor, implementation, params) {
  const header = byId("tool-title");
  header.textContent = document.title = message(descriptor.titleKey);
  byId("tool-description").textContent = message(descriptor.descriptionKey);
  document.body.dataset.toolId = descriptor.id;
  document.body.classList.add("browser-toolbox-tool-is-codec");
  byId("tool-input-label").textContent = message("toolCodecInputLabel");
  const CODEC_TYPES = Object.freeze([
    {
      id: "base64",
      labelKey: "toolCodecBase64",
      hintKey: "toolCodecBase64Hint",
      encode: "base64Encode",
      decode: "base64Decode",
    },
    {
      id: "url",
      labelKey: "toolCodecUrl",
      hintKey: "toolCodecUrlHint",
      encode: "urlEncode",
      decode: "urlDecode",
    },
    {
      id: "uri",
      labelKey: "toolCodecUri",
      hintKey: "toolCodecUriHint",
      encode: "uriEncode",
      decode: "uriDecode",
    },
    {
      id: "unicode",
      labelKey: "toolCodecUnicode",
      hintKey: "toolCodecUnicodeHint",
      encode: "unicodeEncode",
      decode: "unicodeDecode",
    },
    {
      id: "unicodeEscape",
      labelKey: "toolCodecUnicodeEscape",
      hintKey: "toolCodecUnicodeEscapeHint",
      encode: "unicodeEscapeEncode",
      decode: "unicodeEscapeDecode",
    },
    {
      id: "jsonString",
      labelKey: "toolCodecJsonString",
      hintKey: "toolCodecJsonStringHint",
      encode: "jsonStringEncode",
      decode: "jsonStringDecode",
    },
    {
      id: "xml",
      labelKey: "toolCodecXml",
      hintKey: "toolCodecXmlHint",
      encode: "xmlEncode",
      decode: "xmlDecode",
    },
    {
      id: "ascii",
      labelKey: "toolCodecAscii",
      hintKey: "toolCodecAsciiHint",
      encode: "asciiEncode",
      decode: "asciiDecode",
    },
  ]);
  const ADVANCED_CODEC_TYPES = Object.freeze([
    {
      id: "binary",
      labelKey: "toolCodecBinary",
      hintKey: "toolCodecBytesHint",
      encode: "binaryEncode",
      decode: "binaryDecode",
    },
    {
      id: "octal",
      labelKey: "toolCodecOctal",
      hintKey: "toolCodecBytesHint",
      encode: "octalEncode",
      decode: "octalDecode",
    },
    {
      id: "decimal",
      labelKey: "toolCodecDecimal",
      hintKey: "toolCodecBytesHint",
      encode: "decimalEncode",
      decode: "decimalDecode",
    },
    {
      id: "dataUrl",
      labelKey: "toolCodecDataUrl",
      hintKey: "toolCodecDataUrlHint",
      encode: "dataUrlEncode",
      decode: "dataUrlDecode",
    },
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

  function currentInput() {
    return byId("tool-input").value;
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

  const state = {
    originalInput: "",
    originalFilename: "",
    codecType: CODEC_TYPES[0],
    codecResults: { encode: null, decode: null },
    codecFile: null,
    originalCodecFile: null,
    fileLoadRevision: 0,
    running: false,
    autoRunTimer: null,
    autoRunPending: false,
    inputRevision: 0,
  };

  function clearResult() {
    renderCodecResult("encode");
    renderCodecResult("decode", {
      note: state.codecType.decode ? "" : message("toolCodecMd5Hint"),
    });
    setStatus(message("toolReady"));
  }

  function scheduleAutoRun() {
    if (state.autoRunTimer) globalThis.clearTimeout(state.autoRunTimer);
    state.autoRunTimer = globalThis.setTimeout(() => {
      state.autoRunTimer = null;
      run(true);
    }, 220);
  }

  async function run(automatic = false) {
    if (state.running) {
      if (automatic) state.autoRunPending = true;
      return;
    }
    state.running = true;
    if (state.autoRunTimer) {
      globalThis.clearTimeout(state.autoRunTimer);
      state.autoRunTimer = null;
    }
    const revision = state.inputRevision;
    byId("tool-run").disabled = true;
    try {
      await runCodec(revision);
    } catch (error) {
      if (revision === state.inputRevision) {
        clearResult();
        setStatus(error.message || message("toolInvalid"), true);
      }
    } finally {
      state.running = false;
      byId("tool-run").disabled = false;
      if (state.autoRunPending || revision !== state.inputRevision) {
        state.autoRunPending = false;
        scheduleAutoRun();
      }
    }
  }

  async function restoreInput() {
    const useExample = !state.originalInput && !state.originalFilename;
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
    state.inputRevision++;
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
  }

  async function loadFile(file) {
    if (!file) return;
    const asDataUrl = state.codecType.id === "dataUrl";
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
      input = asDataUrl ? "" : await file.text();
    } catch (error) {
      if (fileRevision !== state.fileLoadRevision || inputRevision !== state.inputRevision) return;
      throw error;
    }
    if (fileRevision !== state.fileLoadRevision || inputRevision !== state.inputRevision) return;
    byId("tool-input").value = input;
    state.originalInput = input;
    state.originalFilename = file.name;
    state.inputRevision++;
    updateFileName(file.name);
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
    clearResult();
    setStatus(`${message("toolFileLoaded")}: ${file.name}`);
    await run(true);
  }

  function updateFileName(name = "") {
    const label = byId("tool-file-name");
    if (!label) return;
    label.textContent = name || message("toolFileNone");
    label.hidden = !name;
  }

  async function setup() {
    setIcon("tool-restore-icon", "restore");
    buildCodecLayout();
    buildCodecControls();
    let tokenInvalid = false;
    if (params.has("inputToken") && params.get("inputToken")) {
      const consumed = await consumeInput(params, descriptor.id);
      tokenInvalid = !consumed || consumed.toolId !== descriptor.id;
      if (!tokenInvalid) {
        state.originalInput = consumed.input ?? "";
        byId("tool-input").value = state.originalInput;
      }
    }
    updateCodecRestoreLabel();
    byId("tool-run").addEventListener("click", () => run());
    byId("tool-restore").addEventListener("click", restoreInput);
    byId("tool-file-trigger").addEventListener("click", () => byId("tool-file").click());
    byId("tool-file").addEventListener("change", (event) => {
      loadFile(event.target.files?.[0]).catch((error) => setStatus(error.message, true));
      event.target.value = "";
    });
    byId("tool-input").addEventListener("input", () => {
      state.inputRevision++;
      state.codecFile = null;
      updateFileName();
      updateCodecFileSource();
      clearResult();
      scheduleAutoRun();
    });
    await run(true);
    if (tokenInvalid) setStatus(message("toolTokenInvalid"));
    const notice = params.get("notice");
    if (notice === "empty-selection") setStatus(message("toolEmptySelection"));
    if (notice === "selection-too-large") setStatus(message("toolSelectionTooLarge"));
  }

  return setup();
}

async function init() {
  await globalThis.BrowserToolboxI18n.applyStoredLocale(document);
  await globalThis.BrowserToolboxTheme.applyStoredTheme(document);
  globalThis.BrowserToolboxTheme.watchTheme(document);
  const params = new URLSearchParams(location.search);
  const descriptor = registry.get(params.get("tool")) || registry.get(registry.TOOL_IDS[0]);
  const implementation = globalThis.BrowserToolboxToolLoader.load(descriptor.id);
  if (descriptor.id === "codec.transform") {
    await mountCodec(descriptor, implementation, params);
  } else {
    await mountWorkbench(
      descriptor,
      implementation,
      params,
      () => consumeInput(params, descriptor.id),
    );
  }
  document.body.dataset.toolReady = "true";
}

document.addEventListener("DOMContentLoaded", () =>
  init().catch((error) => {
    byId("tool-status").textContent = error.message;
    console.error(error);
  }));
